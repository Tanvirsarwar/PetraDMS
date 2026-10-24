import { PetraError, mulDiv, type LedgerView, type LookupDto, type MoneyAccountDto, type ProductDto, type Role, type SupplierDto } from '@petra/core';
import type { z } from 'zod';
import type { productSaveInput, lookupSaveInput, supplierSaveInput } from '@petra/core';
import { all, get, run } from '../sql';
import { type Ctx, requireRow, tx } from '../ctx';
import { audit } from '../audit';
import { createProduct, createSupplier, setProductDefaults } from '../masters';
import { docKey, docNumbers } from './docref';

type ProductSave = z.output<typeof productSaveInput>;
type LookupSave = z.output<typeof lookupSaveInput>;
type SupplierSave = z.output<typeof supplierSaveInput>;

interface ProductRowDb {
  id: number; sku: string; name: string; name_bn: string; category_id: number | null; category_name: string | null; brand_id: number | null; brand_name: string | null;
  base_unit: string; track_expiry: number; price_retail: number; price_wholesale: number; price_dealer: number; min_price: number; stock_qty: number; stock_value: number;
  last_cost: number; reorder_level: number; default_sale_pack_id: number | null; default_purchase_pack_id: number | null; favourite: number; status: 'active' | 'archived'; notes: string; has_history: number; nearest_expiry: string | null;
}

/** Product list with packs and barcodes. Staff never receive cost fields (plan 13.1). */
export function listProducts(ctx: Ctx, role: Role, includeArchived: boolean, onlyId?: number): ProductDto[] {
  const rows = all<ProductRowDb>(
    ctx.db,
    `SELECT p.*, c.name AS category_name, b.name AS brand_name,
            EXISTS(SELECT 1 FROM stock_movements m WHERE m.product_id = p.id) AS has_history,
            (SELECT MIN(expiry_date) FROM stock_batches sb WHERE sb.product_id = p.id AND sb.qty_remaining > 0 AND sb.expiry_date IS NOT NULL) AS nearest_expiry
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE (? OR p.status = 'active') AND (? IS NULL OR p.id = ?)
      ORDER BY p.name COLLATE NOCASE`,
    includeArchived ? 1 : 0, onlyId ?? null, onlyId ?? null
  );
  const packCode = new Map<number, string>();
  for (const b of all<{ pack_id: number; barcode: string }>(ctx.db, 'SELECT pack_id, barcode FROM product_barcodes WHERE pack_id IS NOT NULL ORDER BY id')) if (!packCode.has(b.pack_id)) packCode.set(b.pack_id, b.barcode);
  const packs = new Map<number, ProductDto['packs']>();
  for (const k of all<{ id: number; product_id: number; name: string; name_bn: string; factor: number; price_retail: number | null; price_wholesale: number | null; price_dealer: number | null }>(ctx.db, 'SELECT * FROM product_packs ORDER BY product_id, factor')) {
    if (!packs.has(k.product_id)) packs.set(k.product_id, []);
    packs.get(k.product_id)!.push({ id: k.id, name: k.name, nameBn: k.name_bn, factor: k.factor, priceRetail: k.price_retail, priceWholesale: k.price_wholesale, priceDealer: k.price_dealer, barcode: packCode.get(k.id) ?? null });
  }
  const codes = new Map<number, string[]>();
  for (const b of all<{ product_id: number; barcode: string }>(ctx.db, 'SELECT product_id, barcode FROM product_barcodes WHERE pack_id IS NULL ORDER BY id')) {
    if (!codes.has(b.product_id)) codes.set(b.product_id, []);
    codes.get(b.product_id)!.push(b.barcode);
  }
  const hideCost = role === 'staff';
  return rows.map((p) => ({
    id: p.id, sku: p.sku, name: p.name, nameBn: p.name_bn,
    categoryId: p.category_id, categoryName: p.category_name ?? '', brandId: p.brand_id, brandName: p.brand_name ?? '',
    baseUnit: p.base_unit, trackExpiry: p.track_expiry === 1,
    defaultSalePackId: p.default_sale_pack_id, defaultPurchasePackId: p.default_purchase_pack_id,
    priceRetail: p.price_retail, priceWholesale: p.price_wholesale, priceDealer: p.price_dealer, minPrice: p.min_price,
    stockQty: p.stock_qty,
    stockValue: hideCost ? null : p.stock_value,
    avgCost: hideCost ? null : p.stock_qty > 0 ? mulDiv(p.stock_value, 1, p.stock_qty) : p.last_cost,
    lastCost: hideCost ? null : p.last_cost,
    reorderLevel: p.reorder_level, favourite: p.favourite === 1, status: p.status, notes: p.notes,
    packs: packs.get(p.id) ?? [], barcodes: codes.get(p.id) ?? [],
    hasHistory: p.has_history === 1, nearestExpiry: p.nearest_expiry
  }));
}

function unique<T>(fn: () => T, what: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) throw new PetraError('DUPLICATE', `${what} already exists`, { what });
    throw e;
  }
}

function checkPrices(i: ProductSave): void {
  if (i.minPrice > i.priceRetail && i.priceRetail > 0) throw new PetraError('INVALID_INPUT', 'minimum price is above the retail price', { field: 'minPrice' });
}

export function saveProduct(ctx: Ctx, i: ProductSave): number {
  checkPrices(i);
  const names = new Set<string>([i.baseUnit.toLowerCase()]);
  for (const p of i.packs) {
    if (names.has(p.name.toLowerCase())) throw new PetraError('DUPLICATE', 'pack name repeated', { what: 'pack' });
    names.add(p.name.toLowerCase());
  }
  if (new Set(i.packs.map((p) => p.factor)).size !== i.packs.length) throw new PetraError('DUPLICATE', 'pack size repeated', { what: 'pack size' });

  if (!i.id) {
    const id = createProduct(ctx, {
      sku: i.sku, name: i.name, nameBn: i.nameBn, categoryId: i.categoryId, brandId: i.brandId, baseUnit: i.baseUnit, trackExpiry: i.trackExpiry,
      priceRetail: i.priceRetail, priceWholesale: i.priceWholesale, priceDealer: i.priceDealer, minPrice: i.minPrice, reorderLevel: i.reorderLevel, notes: i.notes, defaultSaleFactor: i.defaultSaleFactor, defaultPurchaseFactor: i.defaultPurchaseFactor,
      packs: i.packs.map((p) => ({ name: p.name, nameBn: p.nameBn, factor: p.factor, priceRetail: p.priceRetail ?? null, priceWholesale: p.priceWholesale ?? null, priceDealer: p.priceDealer ?? null, barcode: p.barcode ?? null })),
      barcodes: i.barcodes
    });
    if (i.favourite) run(ctx.db, 'UPDATE products SET favourite = 1 WHERE id = ?', id);
    return id;
  }

  const productId = i.id;
  return tx(ctx, () => {
    const cur = requireRow(get<{ id: number; track_expiry: number; stock_qty: number; base_unit: string }>(ctx.db, 'SELECT id, track_expiry, stock_qty, base_unit FROM products WHERE id = ?', productId), 'product', productId);
    const wantExpiry = i.trackExpiry ? 1 : 0;
    if (wantExpiry !== cur.track_expiry) {
      const history = get(ctx.db, 'SELECT 1 AS x FROM stock_movements WHERE product_id = ? LIMIT 1', productId);
      if (history || cur.stock_qty !== 0) throw new PetraError('INVALID_INPUT', 'expiry tracking cannot change once the product has stock history', { field: 'trackExpiry' });
    }
    unique(
      () => run(
        ctx.db,
        `UPDATE products SET sku=?, name=?, name_bn=?, category_id=?, brand_id=?, base_unit=?, track_expiry=?, price_retail=?, price_wholesale=?, price_dealer=?, min_price=?, reorder_level=?, favourite=?, notes=?, updated_at=? WHERE id=?`,
        i.sku, i.name, i.nameBn, i.categoryId, i.brandId, i.baseUnit, wantExpiry, i.priceRetail, i.priceWholesale, i.priceDealer, i.minPrice, i.reorderLevel, i.favourite ? 1 : 0, i.notes, ctx.now(), productId
      ),
      'SKU'
    );
    // base pack follows the base unit name
    const base = get<{ id: number }>(ctx.db, 'SELECT id FROM product_packs WHERE product_id = ? AND factor = 1', productId);
    if (base) unique(() => run(ctx.db, 'UPDATE product_packs SET name = ? WHERE id = ?', i.baseUnit, base.id), 'pack');
    else run(ctx.db, 'INSERT INTO product_packs(product_id, name, factor, sort) VALUES(?,?,1,0)', productId, i.baseUnit);

    // sync extra packs: update by id, insert new, delete removed ones only when no document used them
    const existing = all<{ id: number }>(ctx.db, 'SELECT id FROM product_packs WHERE product_id = ? AND factor > 1', productId).map((r) => r.id);
    const keep = new Set(i.packs.filter((p) => p.id).map((p) => p.id!));
    for (const pid of existing) {
      if (keep.has(pid)) continue;
      const used = get(ctx.db, 'SELECT 1 AS x FROM purchase_items WHERE pack_id = ? UNION ALL SELECT 1 FROM sale_items WHERE pack_id = ? LIMIT 1', pid, pid);
      if (used) throw new PetraError('IN_USE', 'pack is used on documents', { what: 'pack' });
      run(ctx.db, 'UPDATE products SET default_sale_pack_id = NULL WHERE default_sale_pack_id = ?', pid);
      run(ctx.db, 'UPDATE products SET default_purchase_pack_id = NULL WHERE default_purchase_pack_id = ?', pid);
      run(ctx.db, 'UPDATE supplier_products SET default_pack_id = NULL WHERE default_pack_id = ?', pid);
      run(ctx.db, 'DELETE FROM product_barcodes WHERE pack_id = ?', pid);
      run(ctx.db, 'DELETE FROM product_packs WHERE id = ?', pid);
    }
    // A pack's size cannot change once a sale or purchase used it: editing that invoice, a return or the company's
    // last box cost would silently read the old boxes at the new size. A new box size is a new pack ("Box 24").
    for (const p of i.packs) {
      if (!p.id) continue;
      const cur = get<{ factor: number; name: string }>(ctx.db, 'SELECT factor, name FROM product_packs WHERE id = ? AND product_id = ?', p.id, productId);
      if (!cur || cur.factor === p.factor) continue;
      const used = get(ctx.db, 'SELECT 1 AS x FROM purchase_items WHERE pack_id = ? UNION ALL SELECT 1 FROM sale_items WHERE pack_id = ? LIMIT 1', p.id, p.id);
      if (used) throw new PetraError('PACK_SIZE_LOCKED', 'pack size cannot change after it was used on documents', { pack: cur.name, factor: cur.factor });
    }
    // temporarily shift factors/names of existing packs so swapping values cannot trip the UNIQUE constraints
    run(ctx.db, "UPDATE product_packs SET factor = 1000000 + id, name = '~' || id WHERE product_id = ? AND factor > 1", productId);
    // pack barcodes are replaced with the packs: clear them first so a code can move between packs
    run(ctx.db, 'DELETE FROM product_barcodes WHERE product_id = ? AND pack_id IS NOT NULL', productId);
    i.packs.forEach((p, idx) => {
      let packId = p.id;
      if (packId) {
        const existingId = packId;
        const ok = get(ctx.db, 'SELECT 1 AS x FROM product_packs WHERE id = ? AND product_id = ?', existingId, productId);
        if (!ok) throw new PetraError('NOT_FOUND', 'pack not found', { what: 'pack' });
        unique(() => run(ctx.db, 'UPDATE product_packs SET name=?, name_bn=?, factor=?, price_retail=?, price_wholesale=?, price_dealer=?, sort=? WHERE id=?', p.name, p.nameBn, p.factor, p.priceRetail ?? null, p.priceWholesale ?? null, p.priceDealer ?? null, idx + 1, existingId), 'pack');
      } else {
        packId = unique(() => run(ctx.db, 'INSERT INTO product_packs(product_id, name, name_bn, factor, price_retail, price_wholesale, price_dealer, sort) VALUES(?,?,?,?,?,?,?,?)', productId, p.name, p.nameBn, p.factor, p.priceRetail ?? null, p.priceWholesale ?? null, p.priceDealer ?? null, idx + 1).id, 'pack');
      }
      const code = p.barcode;
      if (code) unique(() => run(ctx.db, 'INSERT INTO product_barcodes(product_id, pack_id, barcode) VALUES(?,?,?)', productId, packId as number, code), 'barcode');
    });
    setProductDefaults(ctx, productId, i.defaultSaleFactor, i.defaultPurchaseFactor);
    // barcodes: replace the product-level set
    run(ctx.db, 'DELETE FROM product_barcodes WHERE product_id = ? AND pack_id IS NULL', productId);
    for (const code of i.barcodes) unique(() => run(ctx.db, 'INSERT INTO product_barcodes(product_id, barcode) VALUES(?,?)', productId, code), 'barcode');
    audit(ctx, { action: 'product.update', entity: 'product', entityId: productId, after: { sku: i.sku, name: i.name, priceRetail: i.priceRetail } });
    return productId;
  });
}

export function archiveProduct(ctx: Ctx, id: number, archived: boolean): void {
  requireRow(get(ctx.db, 'SELECT id FROM products WHERE id = ?', id), 'product', id);
  run(ctx.db, 'UPDATE products SET status = ?, updated_at = ? WHERE id = ?', archived ? 'archived' : 'active', ctx.now(), id);
  audit(ctx, { action: archived ? 'product.archive' : 'product.restore', entity: 'product', entityId: id });
}

export function listLookups(ctx: Ctx): { categories: LookupDto[]; brands: LookupDto[] } {
  const q = (t: string) => all<{ id: number; name: string; name_bn: string; status: 'active' | 'archived' }>(ctx.db, `SELECT id, name, name_bn, status FROM ${t} ORDER BY name COLLATE NOCASE`).map((r) => ({ id: r.id, name: r.name, nameBn: r.name_bn, status: r.status }));
  return { categories: q('categories'), brands: q('brands') };
}

export function saveLookup(ctx: Ctx, i: LookupSave): number {
  const table = i.kind === 'category' ? 'categories' : 'brands';
  if (!i.id) return unique(() => run(ctx.db, `INSERT INTO ${table}(name, name_bn, created_at) VALUES(?,?,?)`, i.name, i.nameBn, ctx.now()).id, i.kind);
  const lookupId = i.id;
  requireRow(get(ctx.db, `SELECT id FROM ${table} WHERE id = ?`, lookupId), i.kind, lookupId);
  unique(() => run(ctx.db, `UPDATE ${table} SET name = ?, name_bn = ?, status = COALESCE(?, status) WHERE id = ?`, i.name, i.nameBn, i.archived === undefined ? null : i.archived ? 'archived' : 'active', lookupId), i.kind);
  return lookupId;
}

export function listSuppliers(ctx: Ctx, includeArchived: boolean): SupplierDto[] {
  return all<{ id: number; name: string; name_bn: string; phone: string; address: string; balance: number; status: 'active' | 'archived'; notes: string }>(
    ctx.db, "SELECT * FROM suppliers WHERE (? OR status = 'active') ORDER BY name COLLATE NOCASE", includeArchived ? 1 : 0
  ).map((s) => ({ id: s.id, name: s.name, nameBn: s.name_bn, phone: s.phone, address: s.address, balance: s.balance, status: s.status, notes: s.notes }));
}

export function saveSupplier(ctx: Ctx, i: SupplierSave): number {
  if (!i.id) return createSupplier(ctx, { name: i.name, nameBn: i.nameBn, phone: i.phone, address: i.address, notes: i.notes, openingBalance: i.openingBalance, openingDate: i.openingDate });
  const sid = i.id;
  requireRow(get(ctx.db, 'SELECT id FROM suppliers WHERE id = ?', sid), 'supplier', sid);
  run(ctx.db, 'UPDATE suppliers SET name=?, name_bn=?, phone=?, address=?, notes=?, status=COALESCE(?, status), updated_at=? WHERE id=?', i.name, i.nameBn, i.phone, i.address, i.notes, i.archived === undefined ? null : i.archived ? 'archived' : 'active', ctx.now(), sid);
  audit(ctx, { action: 'supplier.update', entity: 'supplier', entityId: sid });
  return sid;
}

export function listMoneyAccounts(ctx: Ctx): MoneyAccountDto[] {
  return all<{ id: number; name: string; name_bn: string; kind: string; balance: number; is_default: number }>(ctx.db, 'SELECT id, name, name_bn, kind, balance, is_default FROM money_accounts WHERE active = 1 ORDER BY is_default DESC, id').map((a) => ({ id: a.id, name: a.name, nameBn: a.name_bn, kind: a.kind, balance: a.balance, isDefault: a.is_default === 1 }));
}

const PARTY_TABLE = { customer: 'customers', supplier: 'suppliers', employee: 'employees' } as const;

export function partyLedger(ctx: Ctx, kind: 'customer' | 'supplier' | 'employee', id: number, from?: string, to?: string): LedgerView {
  const party = requireRow(get<{ id: number; name: string; balance: number; phone: string }>(ctx.db, `SELECT id, name, balance, phone FROM ${PARTY_TABLE[kind]} WHERE id = ?`, id), kind, id);
  const rows = all<{ id: number; business_date: string; entry_kind: string; amount: number; note: string; ref_type: string | null; ref_id: number | null; reverses_id: number | null }>(
    ctx.db, 'SELECT id, business_date, entry_kind, amount, note, ref_type, ref_id, reverses_id FROM party_ledger WHERE party_kind = ? AND party_id = ? ORDER BY id', kind, id
  );
  const docs = docNumbers(ctx.db, rows.map((r) => ({ refType: r.ref_type, refId: r.ref_id })));
  let running = 0;
  const out = rows.map((r) => {
    running += r.amount;
    return { id: r.id, date: r.business_date, kind: r.entry_kind, amount: r.amount, balanceAfter: running, note: r.note, refType: r.ref_type, refId: r.ref_id, refNo: docs.get(docKey(r.ref_type, r.ref_id)) ?? '', reversal: r.reverses_id !== null };
  });
  return { party: { id: party.id, name: party.name, balance: party.balance, phone: party.phone }, rows: out.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)) };
}
