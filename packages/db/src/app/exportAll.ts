import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inertText, writeCsv, type ExportAllResult } from '@petra/core';
import { all } from '../sql';
import type { Ctx } from '../ctx';
import { audit } from '../audit';
import { createBackup, stampOf } from './backup';
import { makeZip, type ZipEntry } from './exportFiles';
import type { Host } from './dispatcher';

const taka = (n: unknown): string => (typeof n === 'number' ? (n / 100).toFixed(2) : '');

function table(ctx: Ctx, sql: string, money: string[] = []): string {
  const rows = all<Record<string, unknown>>(ctx.db, sql);
  const first = rows[0];
  const cols = first ? Object.keys(first) : sqlColumns(ctx, sql);
  const m = new Set(money);
  return writeCsv([cols, ...rows.map((r) => cols.map((c) => {
    const v = r[c];
    if (v === null || v === undefined) return '';
    if (m.has(c)) return taka(v);
    return typeof v === 'string' ? inertText(v) : String(v);
  }))]);
}

function sqlColumns(ctx: Ctx, sql: string): string[] {
  const stmt = ctx.db.prepare(`${sql} LIMIT 0`);
  return stmt.columns().map((c) => c.name);
}

const SECRET_OR_NOISE = new Set(['users', 'license_state', 'app_log', 'sqlite_sequence']);
const RAW_MONEY_NOTE = 'Amounts in the raw/ files are in poisha (1 taka = 100 poisha). The spreadsheets/ files show taka.';

/**
 * "Export everything" (plan 11.3): readable spreadsheets, every table as it is stored, and a full database backup, so the
 * shop is never locked in. Passwords and PINs are never included.
 */
export function exportEverything(ctx: Ctx, host: Host): ExportAllResult {
  const now = new Date(ctx.now());
  const entries: ZipEntry[] = [];
  const add = (name: string, data: string | Buffer, store = false) => entries.push({ name, data, store, date: now });
  const stamp = stampOf(now);

  add('README.txt', [
    'PetraDMS: complete export', `Made: ${ctx.now()}`, '',
    'spreadsheets/  Open these in Excel. Amounts are in taka.',
    'raw/           Every table exactly as stored, one CSV each. Amounts are in poisha.',
    'database/      A full PetraDMS backup (.petrabak). Restore it from the Backup page to get everything back.',
    '', RAW_MONEY_NOTE, 'Passwords and PINs are not included.', ''
  ].join('\r\n'));

  add('spreadsheets/products.csv', table(ctx,
    `SELECT p.sku AS SKU, p.name AS Name, p.name_bn AS NameBn, c.name AS Category, b.name AS Brand, p.base_unit AS Unit, p.price_retail AS Retail, p.price_wholesale AS Wholesale, p.price_dealer AS Dealer, p.min_price AS MinPrice,
            p.stock_qty AS Stock,
            (SELECT CASE WHEN k.factor > 1 THEN (p.stock_qty / k.factor) || ' ' || k.name || ' ' || (p.stock_qty % k.factor) || ' ' || p.base_unit ELSE p.stock_qty || ' ' || p.base_unit END
               FROM product_packs k WHERE k.product_id = p.id ORDER BY k.factor DESC LIMIT 1) AS StockInBoxes,
            p.stock_value AS StockValue, p.last_cost AS LastCost, p.reorder_level AS ReorderLevel, p.status AS Status,
            (SELECT group_concat(barcode, ' ') FROM product_barcodes x WHERE x.product_id = p.id) AS Barcodes
     FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id ORDER BY p.name`,
    ['Retail', 'Wholesale', 'Dealer', 'MinPrice', 'StockValue', 'LastCost']));
  add('spreadsheets/customers.csv', table(ctx,
    `SELECT c.name AS Name, c.name_bn AS NameBn, c.phone AS Phone, c.address AS Address, a.name AS Area, c.type AS Type, c.credit_limit AS CreditLimit, c.balance AS Due, c.status AS Status
     FROM customers c LEFT JOIN areas a ON a.id = c.area_id ORDER BY c.name`, ['CreditLimit', 'Due']));
  add('spreadsheets/suppliers.csv', table(ctx,
    'SELECT name AS Name, name_bn AS NameBn, phone AS Phone, address AS Address, balance AS WeOwe, status AS Status FROM suppliers ORDER BY name', ['WeOwe']));
  add('spreadsheets/sales.csv', table(ctx,
    `SELECT s.doc_no AS Invoice, s.business_date AS Date, c.name AS Customer, s.status AS Status, s.subtotal AS Subtotal, s.discount AS Discount, s.tax AS Tax, s.round_off AS RoundOff, s.total AS Total, s.paid AS Paid, s.due AS Due, s.note AS Note
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id`, ['Subtotal', 'Discount', 'Tax', 'RoundOff', 'Total', 'Paid', 'Due']));
  add('spreadsheets/purchases.csv', table(ctx,
    `SELECT p.doc_no AS Bill, p.business_date AS Date, s.name AS Supplier, p.supplier_ref AS SupplierRef, p.status AS Status, p.subtotal AS Subtotal, p.discount AS Discount, p.total AS Total, p.paid AS Paid, p.due AS Due
     FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.id`, ['Subtotal', 'Discount', 'Total', 'Paid', 'Due']));
  add('spreadsheets/party-ledger.csv', table(ctx,
    `SELECT l.business_date AS Date, l.party_kind AS Party, COALESCE(c.name, s.name, e.name) AS Name, l.entry_kind AS Kind, l.amount AS Amount, l.note AS Note
     FROM party_ledger l LEFT JOIN customers c ON l.party_kind = 'customer' AND c.id = l.party_id LEFT JOIN suppliers s ON l.party_kind = 'supplier' AND s.id = l.party_id LEFT JOIN employees e ON l.party_kind = 'employee' AND e.id = l.party_id
     ORDER BY l.id`, ['Amount']));

  for (const t of all<{ name: string }>(ctx.db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")) {
    if (SECRET_OR_NOISE.has(t.name)) continue;
    add(`raw/${t.name}.csv`, table(ctx, `SELECT * FROM "${t.name.replace(/"/g, '""')}"`));
  }
  add('raw/users.csv', table(ctx, 'SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id'));

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-export-'));
  try {
    const made = createBackup(ctx.db, work, { kind: 'manual', appVersion: host.appVersion, now });
    add(`database/${path.basename(made.file)}`, fs.readFileSync(made.file), true);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const zip = makeZip(entries);
  const file = path.join(host.dataDir, 'exports', `PetraDMS-export-${stamp}.zip`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, zip);
  fs.renameSync(`${file}.part`, file);
  audit(ctx, { action: 'export.all', entity: 'export', reason: path.basename(file), after: { files: entries.length, bytes: zip.length } });
  host.reveal(file);
  return { path: file, bytes: zip.length, files: entries.length };
}
