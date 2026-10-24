import fs from 'node:fs';
import path from 'node:path';
import {
  IMPORT_FIELDS, IMPORT_LIMITS, PetraError, autoMap, checkRow, mappingProblems, mulDiv, openingBase, parseCsv, templateRows, writeCsv, inertText,
  type CustomerRow, type DueRow, type ImportKind, type ImportPreview, type ImportResult, type ImportRowReport, type Mapping, type ProductRow, type PurchaseImportRow, type RowIssue
} from '@petra/core';
import { all, get, scalar } from '../sql';
import { type Ctx, tx } from '../ctx';
import { audit } from '../audit';
import { createArea, createBrand, createCategory, createCustomer, createProduct, createSupplier } from '../masters';
import { findDuplicateInvoice, postPurchase } from '../purchases';
import { linkProducts } from '../supplierProducts';
import { postLedger } from '../ledger';
import { postStockAdjustment } from '../adjustments';
import type { Host } from './dispatcher';

interface Parsed {
  headers: string[];
  delimiter: string;
  mapping: Mapping;
  mappingIssues: { field: string; code: string }[];
  /** Data rows with their line numbers (the header is line 1). */
  rows: { line: number; cells: string[] }[];
}

function parseInput(kind: ImportKind, text: string, given: Mapping | undefined): Parsed {
  const csv = parseCsv(text);
  const [headers, ...data] = csv.rows;
  if (!headers) throw new PetraError('IMPORT_INVALID', 'the file is empty', { reason: 'empty' });
  if (data.length > IMPORT_LIMITS.maxRows) throw new PetraError('IMPORT_INVALID', 'too many rows', { reason: 'tooMany', max: IMPORT_LIMITS.maxRows });
  const mapping: Mapping = {};
  const auto = autoMap(kind, headers);
  for (const f of IMPORT_FIELDS[kind]) mapping[f.key] = given ? (given[f.key] ?? null) : (auto[f.key] ?? null);
  return {
    headers, delimiter: csv.delimiter, mapping, mappingIssues: mappingProblems(kind, mapping, headers.length),
    rows: data.map((cells, i) => ({ line: i + 2, cells }))
  };
}

const key = (s: string): string => s.trim().toLowerCase();

interface PartyIndex { byPhone: Map<string, number[]>; byName: Map<string, number[]> }

function partyIndex(ctx: Ctx, table: 'customers' | 'suppliers'): PartyIndex {
  const idx: PartyIndex = { byPhone: new Map(), byName: new Map() };
  const push = (m: Map<string, number[]>, k: string, id: number) => m.set(k, [...(m.get(k) ?? []), id]);
  for (const r of all<{ id: number; name: string; phone: string }>(ctx.db, `SELECT id, name, phone FROM ${table} WHERE status = 'active'`)) {
    if (r.phone) push(idx.byPhone, r.phone, r.id);
    push(idx.byName, key(r.name), r.id);
  }
  return idx;
}

function resolveParty(idx: PartyIndex, name: string, phone: string): { id: number } | { issue: string } {
  if (phone) {
    const ids = idx.byPhone.get(phone) ?? [];
    if (ids.length === 1) return { id: ids[0] as number };
    if (ids.length > 1) return { issue: 'partyAmbiguous' };
  }
  if (name) {
    const ids = idx.byName.get(key(name)) ?? [];
    if (ids.length === 1) return { id: ids[0] as number };
    if (ids.length > 1) return { issue: 'partyAmbiguous' };
  }
  return { issue: 'partyNotFound' };
}

/** Reads every row, applies the field rules and then the checks that need the database: duplicates (in the file and in the shop) and unknown parties. */
function evaluate(ctx: Ctx, kind: ImportKind, p: Parsed): { reports: ImportRowReport[]; parsed: Map<number, unknown> } {
  const reports: ImportRowReport[] = [];
  const parsed = new Map<number, unknown>();
  const skus = kind === 'products' ? new Set(all<{ sku: string }>(ctx.db, 'SELECT sku FROM products').map((r) => key(r.sku))) : new Set<string>();
  const codes = kind === 'products' ? new Set(all<{ barcode: string }>(ctx.db, 'SELECT barcode FROM product_barcodes').map((r) => r.barcode)) : new Set<string>();
  const phones = kind === 'customers' ? new Set(all<{ phone: string }>(ctx.db, "SELECT phone FROM customers WHERE phone <> ''").map((r) => r.phone)) : new Set<string>();
  const cust = kind === 'dues' ? partyIndex(ctx, 'customers') : null;
  const supp = kind === 'dues' || kind === 'purchases' ? partyIndex(ctx, 'suppliers') : null;
  const prodBySku = kind === 'purchases' ? new Map(all<{ id: number; sku: string; status: string; box: number | null; factor: number | null }>(ctx.db,
    `SELECT p.id, p.sku, p.status, COALESCE(p.default_purchase_pack_id, (SELECT k.id FROM product_packs k WHERE k.product_id = p.id AND k.factor > 1 ORDER BY k.factor DESC LIMIT 1)) AS box,
            (SELECT k.factor FROM product_packs k WHERE k.id = COALESCE(p.default_purchase_pack_id, (SELECT k2.id FROM product_packs k2 WHERE k2.product_id = p.id AND k2.factor > 1 ORDER BY k2.factor DESC LIMIT 1))) AS factor
       FROM products p`).map((r) => [key(r.sku), r])) : new Map<string, { id: number; status: string; box: number | null; factor: number | null }>();
  const seenSku = new Set<string>();
  const seenCode = new Set<string>();
  const seenPhone = new Set<string>();
  const seenParty = new Set<string>();
  for (const r of p.rows) {
    const { value, issues } = checkRow(kind, r.cells, p.mapping);
    const extra: RowIssue[] = [...issues];
    if (value) {
      if (kind === 'products') {
        const v = value as ProductRow;
        const k = key(v.sku);
        if (skus.has(k)) extra.push({ field: 'sku', code: 'skuExists' });
        else if (seenSku.has(k)) extra.push({ field: 'sku', code: 'dupInFile' });
        if (v.barcode) {
          if (codes.has(v.barcode)) extra.push({ field: 'barcode', code: 'barcodeExists' });
          else if (seenCode.has(v.barcode)) extra.push({ field: 'barcode', code: 'dupInFile' });
        }
        seenSku.add(k);
        if (v.barcode) seenCode.add(v.barcode);
      } else if (kind === 'customers') {
        const v = value as CustomerRow;
        if (v.phone) {
          if (phones.has(v.phone)) extra.push({ field: 'phone', code: 'phoneExists' });
          else if (seenPhone.has(v.phone)) extra.push({ field: 'phone', code: 'dupInFile' });
          seenPhone.add(v.phone);
        }
      } else if (kind === 'purchases') {
        const v = value as PurchaseImportRow;
        const sup = resolveParty(supp as PartyIndex, v.supplier, '');
        const prod = prodBySku.get(key(v.sku));
        if ('issue' in sup) extra.push({ field: 'supplier', code: sup.issue });
        if (!prod || prod.status !== 'active') extra.push({ field: 'sku', code: 'productNotFound' });
        else if (v.box > 0 && !prod.box) extra.push({ field: 'box', code: 'noBox' });
        if ('id' in sup && findDuplicateInvoice(ctx, sup.id, v.invoiceNo)) extra.push({ field: 'invoiceNo', code: 'invoiceExists' });
        if (extra.length === 0 && 'id' in sup && prod) parsed.set(r.line, { ...v, supplierId: sup.id, productId: prod.id, packId: prod.box, factor: prod.factor ?? 1 });
      } else {
        const v = value as DueRow;
        const res = resolveParty(v.party === 'customer' ? (cust as PartyIndex) : (supp as PartyIndex), v.name, v.phone);
        if ('issue' in res) extra.push({ field: 'name', code: res.issue });
        else {
          const pk = `${v.party}:${res.id}`;
          if (seenParty.has(pk)) extra.push({ field: 'name', code: 'dupInFile' });
          seenParty.add(pk);
          if (extra.length === 0) parsed.set(r.line, { ...v, id: res.id });
        }
      }
    }
    if (extra.length === 0 && value && !parsed.has(r.line)) parsed.set(r.line, value);
    reports.push({ line: r.line, ok: extra.length === 0, cells: r.cells, issues: extra });
  }
  return { reports, parsed };
}

export function previewImport(ctx: Ctx, kind: ImportKind, text: string, given: Mapping | undefined): ImportPreview {
  const p = parseInput(kind, text, given);
  const base = { headers: p.headers, delimiter: p.delimiter, mapping: p.mapping, mappingIssues: p.mappingIssues };
  if (p.mappingIssues.length) return { ...base, total: p.rows.length, good: 0, bad: 0, rows: [], truncated: false };
  const { reports } = evaluate(ctx, kind, p);
  const bad = reports.filter((r) => !r.ok);
  const good = reports.filter((r) => r.ok);
  const rows = [...bad.slice(0, 500), ...good.slice(0, 20)];
  return { ...base, total: reports.length, good: good.length, bad: bad.length, rows, truncated: bad.length > 500 || good.length > 20 };
}

class DryRunDone extends Error {}

/** A company found by exact name (any case), or created for the import. */
function supplierId(ctx: Ctx, name: string, cache: Map<string, number>): number {
  const k = `suppliers:${key(name)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const found = get<{ id: number }>(ctx.db, "SELECT id FROM suppliers WHERE lower(name) = ? AND status = 'active' ORDER BY id LIMIT 1", key(name));
  const id = found?.id ?? createSupplier(ctx, { name });
  cache.set(k, id);
  return id;
}

type ParsedPurchaseRow = PurchaseImportRow & { supplierId: number; productId: number; packId: number | null; factor: number };

/**
 * Company invoices: rows with the same company and invoice number are one purchase, saved on credit. An invoice is
 * all or nothing: if any of its rows has a problem, the whole invoice is skipped and every one of its rows says why.
 */
function importPurchases(ctx: Ctx, today: string, p: Parsed, reports: ImportRowReport[], parsed: Map<number, unknown>, failed: ImportRowReport[], out: ImportResult): void {
  const col = (cells: string[], f: string): string => { const c = p.mapping[f]; return c === null || c === undefined ? '' : (cells[c] ?? '').trim(); };
  const groupKey = (cells: string[]) => `${key(col(cells, 'supplier'))}|${key(col(cells, 'invoiceNo'))}`;
  const groups = new Map<string, ImportRowReport[]>();
  for (const r of reports) {
    const g = groupKey(r.cells);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  for (const rows of groups.values()) {
    if (rows.some((r) => !r.ok)) {
      for (const r of rows) if (r.ok) failed.push({ ...r, ok: false, issues: [{ field: 'invoiceNo', code: 'invoiceHasErrors' }] });
      continue;
    }
    const lines = rows.map((r) => parsed.get(r.line) as ParsedPurchaseRow);
    const first = lines[0]!;
    try {
      tx(ctx, () => {
        postPurchase(ctx, {
          supplierId: first.supplierId, supplierRef: first.invoiceNo, date: first.date ?? today, invoiceDate: first.date ?? today, paid: 0,
          note: 'Imported company invoice',
          lines: lines.map((l) => ({ productId: l.productId, packId: l.packId, qty: l.box, looseQty: l.pcs, unitCost: l.cost, discKind: l.discount > 0 ? 'fixed' as const : null, discValue: l.discount }))
        });
      });
      out.created += rows.length;
      out.purchasesPosted++;
    } catch (e) {
      if (!(e instanceof PetraError)) throw e;
      for (const r of rows) failed.push({ ...r, ok: false, issues: [{ field: null, code: `db.${e.code}` }] });
    }
  }
}

function lookupId(ctx: Ctx, table: 'categories' | 'brands', name: string, cache: Map<string, number>): number | null {
  if (!name) return null;
  const k = `${table}:${key(name)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const found = get<{ id: number }>(ctx.db, `SELECT id FROM ${table} WHERE lower(name) = ?`, key(name));
  const id = found?.id ?? (table === 'categories' ? createCategory(ctx, name) : createBrand(ctx, name));
  cache.set(k, id);
  return id;
}

/**
 * Imports the good rows in one transaction, each row in its own savepoint so a conflict skips only that row. A dry run
 * does exactly the same work and then rolls everything back, so what it reports is what the real run would do.
 */
export function runImport(ctx: Ctx, today: string, i: { kind: ImportKind; text: string; mapping: Mapping; dryRun: boolean; skipBad: boolean }): ImportResult {
  const p = parseInput(i.kind, i.text, i.mapping);
  if (p.mappingIssues.length) throw new PetraError('IMPORT_INVALID', 'the columns are not matched', { reason: 'mapping' });
  const { reports, parsed } = evaluate(ctx, i.kind, p);
  const refused = reports.filter((r) => !r.ok);
  if (!i.skipBad && refused.length > 0) throw new PetraError('IMPORT_HAS_ERRORS', 'some rows have problems', { bad: refused.length });
  const failed: ImportRowReport[] = [...refused];
  const out: ImportResult = { dryRun: i.dryRun, created: 0, skipped: 0, failed, newCategories: 0, newBrands: 0, newAreas: 0, newSuppliers: 0, stockLines: 0, duesPosted: 0, purchasesPosted: 0 };
  const count = (t: string) => scalar<number>(ctx.db, `SELECT COUNT(*) FROM ${t}`);
  try {
    tx(ctx, () => {
      const before = { c: count('categories'), b: count('brands'), a: count('areas') };
      let cache = new Map<string, number>();
      if (i.kind === 'purchases') {
        importPurchases(ctx, today, p, reports, parsed, failed, out);
        out.newCategories = 0;
        out.newBrands = 0;
        out.newAreas = 0;
        out.skipped = failed.length;
        failed.sort((a, b) => a.line - b.line);
        if (i.dryRun) throw new DryRunDone();
        audit(ctx, { action: 'import.purchases', entity: 'import', after: { invoices: out.purchasesPosted, rows: reports.length, skipped: out.skipped } });
        return;
      }
      const suppliersBefore = count('suppliers');
      for (const r of reports) {
        if (!r.ok) continue;
        const v = parsed.get(r.line);
        try {
          tx(ctx, () => {
            if (i.kind === 'products') {
              const x = v as ProductRow;
              const boxed = x.pcsPerBox >= 2;
              const id = createProduct(ctx, {
                sku: x.sku, name: x.name, nameBn: x.nameBn, categoryId: lookupId(ctx, 'categories', x.category, cache), brandId: lookupId(ctx, 'brands', x.brand, cache), baseUnit: x.unit,
                trackExpiry: x.trackExpiry, priceRetail: x.priceRetail, priceWholesale: x.priceWholesale ?? undefined, priceDealer: x.priceDealer ?? undefined,
                minPrice: x.minPrice, reorderLevel: x.reorderLevel, barcodes: x.barcode ? [x.barcode] : [],
                packs: boxed ? [{ name: x.boxName, factor: x.pcsPerBox, priceRetail: x.boxRetail, priceWholesale: x.boxWholesale, priceDealer: x.boxDealer }] : [],
                defaultSaleFactor: boxed && x.defaultSaleUnit === 'box' ? x.pcsPerBox : null,
                defaultPurchaseFactor: boxed && x.defaultPurchaseUnit === 'box' ? x.pcsPerBox : null
              });
              if (x.supplier) {
                const sid = supplierId(ctx, x.supplier, cache);
                linkProducts(ctx, sid, [id]);
              }
              const qty = openingBase(x);
              if (qty > 0) {
                // a cost per box prices whole boxes exactly and the loose pieces at box cost / box size (rounded once)
                const value = x.openingCostPerBox !== null && boxed
                  ? x.openingBox * x.openingCostPerBox + mulDiv(x.openingCostPerBox, x.openingPcs + x.openingQty, x.pcsPerBox)
                  : qty * (x.openingCost ?? 0);
                postStockAdjustment(ctx, { productId: id, kind: 'opening', baseQty: qty, value, date: today, reason: 'Imported opening stock' });
                out.stockLines++;
              }
            } else if (i.kind === 'customers') {
              const x = v as CustomerRow;
              const areaId = x.area ? (cache.get(`areas:${key(x.area)}`) ?? createArea(ctx, x.area)) : null;
              if (areaId) cache.set(`areas:${key(x.area)}`, areaId);
              createCustomer(ctx, {
                name: x.name, nameBn: x.nameBn, phone: x.phone, address: x.address, areaId, type: x.type, creditLimit: x.creditLimit,
                openingBalance: x.openingDue || undefined, openingDate: x.openingDate ?? today
              });
              if (x.openingDue) out.duesPosted++;
            } else {
              const x = v as DueRow & { id: number };
              postLedger(ctx, { partyKind: x.party, partyId: x.id, kind: 'opening', amount: x.amount, date: x.date ?? today, note: 'Imported opening due' });
              out.duesPosted++;
            }
            out.created++;
          });
        } catch (e) {
          if (!(e instanceof PetraError)) throw e;
          cache = new Map();
          failed.push({ ...r, ok: false, issues: [{ field: e.code === 'DUPLICATE' ? (e.params.what === 'barcode' ? 'barcode' : 'sku') : null, code: `db.${e.code}` }] });
        }
      }
      out.newCategories = count('categories') - before.c;
      out.newBrands = count('brands') - before.b;
      out.newAreas = count('areas') - before.a;
      out.newSuppliers = count('suppliers') - suppliersBefore;
      out.skipped = failed.length;
      failed.sort((a, b) => a.line - b.line);
      if (i.dryRun) throw new DryRunDone();
      audit(ctx, { action: `import.${i.kind}`, entity: 'import', after: { created: out.created, skipped: out.skipped, rows: reports.length } });
    });
  } catch (e) {
    if (!(e instanceof DryRunDone)) throw e;
  }
  return out;
}

/** The refused rows as a CSV the owner can fix and load again: the original columns plus one column saying what is wrong. */
export function rejectsFile(ctx: Ctx, host: Host, i: { kind: ImportKind; text: string; mapping?: Mapping; problemHeader: string; messages: Record<string, string> }): { path: string } {
  const p = parseInput(i.kind, i.text, i.mapping);
  const { reports } = evaluate(ctx, i.kind, p);
  const bad = reports.filter((r) => !r.ok);
  const width = p.headers.length;
  const rows = [[...p.headers, i.problemHeader], ...bad.map((r) => [
    ...Array.from({ length: width }, (_, c) => inertText(r.cells[c] ?? '')),
    r.issues.map((x) => `${x.field ? `${x.field}: ` : ''}${i.messages[x.code] ?? x.code}`).join('; ')
  ])];
  const file = path.join(host.dataDir, 'exports', `import-${i.kind}-rejected-${ctx.now().slice(0, 10)}.csv`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, writeCsv(rows));
  host.reveal(file);
  return { path: file };
}

export function templateFile(ctx: Ctx, host: Host, kind: ImportKind): { path: string } {
  const file = path.join(host.dataDir, 'exports', `import-template-${kind}.csv`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, writeCsv(templateRows(kind)));
  host.reveal(file);
  void ctx;
  return { path: file };
}
