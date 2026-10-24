import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, openDatabase } from './index';
import { currentVersion, loadMigrations, migrate, schemaHistory, type Migration } from './migrate';
import { REPO_MIGRATIONS_DIR } from './migrationsDir';
import { checkIntegrity, formatViolations } from './integrity';
import { all, scalar } from './sql';
import { createBackup } from './app/backup';
import { makeCtx } from './ctx';
import { postPurchase } from './purchases';
import { postSaleReturn } from './sales';

/** Every money and stock figure a v1 shop can see, read straight from its tables. */
function figures(db: ReturnType<typeof openDatabase>) {
  return {
    purchases: all(db, 'SELECT id, subtotal, discount, total, paid, due, status FROM purchases ORDER BY id'),
    purchaseItems: all(db, 'SELECT id, qty, base_qty, unit_cost, amount, alloc_discount FROM purchase_items ORDER BY id'),
    sales: all(db, 'SELECT id, subtotal, discount, tax, total, paid, due, status FROM sales ORDER BY id'),
    stock: all(db, 'SELECT id, sku, stock_qty, stock_value, last_cost FROM products ORDER BY id'),
    customers: all(db, 'SELECT id, balance FROM customers ORDER BY id'),
    suppliers: all(db, 'SELECT id, balance FROM suppliers ORDER BY id'),
    accounts: all(db, 'SELECT id, balance FROM money_accounts ORDER BY id'),
    ledger: all(db, 'SELECT party_kind, party_id, SUM(amount) AS s, COUNT(*) AS n FROM party_ledger GROUP BY party_kind, party_id ORDER BY party_kind, party_id'),
    movements: all(db, 'SELECT COUNT(*) AS n, SUM(base_qty) AS q, SUM(value) AS v FROM stock_movements'),
    cash: all(db, 'SELECT COUNT(*) AS n, SUM(amount) AS s FROM cash_transactions')
  };
}

const FIXTURE = fileURLToPath(new URL('../fixtures/petra-v1.db', import.meta.url));
const META = JSON.parse(fs.readFileSync(FIXTURE.replace(/\.db$/, '.json'), 'utf8')) as {
  schema: number;
  counts: Record<string, number>;
  customerBalances: { name: string; balance: number }[];
  stock: { sku: string; stock_qty: number }[];
};

const dirs: string[] = [];
const open: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const d of open.splice(0)) try { closeDatabase(d); } catch { /* closed */ }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A private copy of the released v1 database, opened the way the app opens it. */
function fixtureCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-mig-'));
  dirs.push(dir);
  const file = path.join(dir, 'petra.db');
  fs.copyFileSync(FIXTURE, file);
  const db = openDatabase(file);
  open.push(db);
  return { dir, file, db };
}

const real = loadMigrations(REPO_MIGRATIONS_DIR);
const next: Migration = {
  version: real.length + 1,
  name: 'fixture_next',
  sql: `ALTER TABLE products ADD COLUMN shelf TEXT NOT NULL DEFAULT '';
        CREATE TABLE shelf_notes (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), note TEXT NOT NULL);
        INSERT INTO shelf_notes(product_id, note) SELECT id, 'migrated' FROM products;`
};

describe('the released v1 database', () => {
  it('opens under today\'s migrations with all of its data and a clean integrity check', () => {
    const { db } = fixtureCopy();
    expect(currentVersion(db)).toBe(META.schema);
    const r = migrate(db, real);
    expect(r.applied.length).toBe(real.length - META.schema); // 0 today; any later migration is exercised here
    expect(scalar(db, 'SELECT COUNT(*) FROM products')).toBe(META.counts.products);
    expect(scalar(db, 'SELECT COUNT(*) FROM customers')).toBe(META.counts.customers);
    expect(scalar(db, 'SELECT COUNT(*) FROM sales')).toBe(META.counts.sales);
    expect(scalar(db, 'SELECT COUNT(*) FROM purchases')).toBe(META.counts.purchases);
    expect(scalar(db, 'SELECT COUNT(*) FROM users')).toBe(META.counts.users);
    expect(all<{ name: string; balance: number }>(db, 'SELECT name, balance FROM customers ORDER BY name')).toEqual(META.customerBalances);
    expect(all<{ sku: string; stock_qty: number }>(db, 'SELECT sku, stock_qty FROM products ORDER BY sku')).toEqual(META.stock);
    expect(formatViolations(checkIntegrity(db))).toBe('');
    expect(String(all<{ integrity_check: string }>(db, 'PRAGMA integrity_check')[0]?.integrity_check)).toBe('ok');
  });

  it('v1 -> v2 (box + pcs, company links): every v1 row survives and purchase/sale totals, stock and balances are unchanged', () => {
    const { db } = fixtureCopy();
    const before = figures(db);
    const r = migrate(db, real);
    expect(r.applied).toContain(2);
    expect(figures(db)).toEqual(before);
    // the new columns start neutral on old rows, so old documents read exactly as before
    expect(all(db, "SELECT DISTINCT loose_qty, line_kind, discount, alloc_charge FROM purchase_items")).toEqual(before.purchaseItems.length ? [{ loose_qty: 0, line_kind: 'normal', discount: 0, alloc_charge: 0 }] : []);
    expect(all(db, 'SELECT DISTINCT tax, freight, dup_reason FROM purchases')).toEqual(before.purchases.length ? [{ tax: 0, freight: 0, dup_reason: '' }] : []);
    expect(scalar(db, 'SELECT COUNT(*) FROM supplier_products')).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) FROM purchase_drafts')).toBe(0);
    expect(formatViolations(checkIntegrity(db))).toBe('');

    // and the upgraded shop works with the v1.1 features: a box + pcs purchase with free goods and freight
    const ctx = makeCtx(db, scalar(db, "SELECT id FROM users WHERE role = 'owner' LIMIT 1"));
    const product = all<{ id: number; pack: number | null }>(db, 'SELECT p.id, (SELECT k.id FROM product_packs k WHERE k.product_id = p.id AND k.factor > 1 ORDER BY k.factor DESC LIMIT 1) AS pack FROM products p WHERE p.track_expiry = 0 ORDER BY p.id LIMIT 1')[0]!;
    const supplier = scalar(db, 'SELECT id FROM suppliers ORDER BY id LIMIT 1');
    const today = String(scalar(db, 'SELECT MAX(business_date) FROM stock_movements')) > '2026-10-01' ? String(scalar(db, 'SELECT MAX(business_date) FROM stock_movements')) : '2026-10-01';
    const p = postPurchase(ctx, { supplierId: supplier, date: today, supplierRef: 'V2-1', lines: [{ productId: product.id, packId: product.pack, qty: 2, looseQty: product.pack ? 3 : 0, unitCost: 120_000 }, { productId: product.id, packId: product.pack, qty: 1, unitCost: 0, kind: 'free' }], freight: 5_000, paid: 0 });
    expect(p.total).toBeGreaterThan(0);
    expect(scalar(db, 'SELECT COUNT(*) FROM supplier_products')).toBe(1);
    // an old v1 sale can still be returned after the upgrade
    const sale = all<{ id: number; item: number; base_qty: number }>(db, "SELECT s.id, i.id AS item, i.base_qty FROM sales s JOIN sale_items i ON i.sale_id = s.id AND i.revision = s.revision WHERE s.status = 'posted' ORDER BY s.id LIMIT 1")[0];
    if (sale) postSaleReturn(ctx, { saleId: sale.id, date: today, items: [{ saleItemId: sale.item, baseQty: 1 }], refundMode: 'cash' });
    expect(formatViolations(checkIntegrity(db))).toBe('');
  });

  it('upgrades with a backup taken first, keeps every row, and stays consistent', () => {
    const { dir, db } = fixtureCopy();
    const calls: [number, number][] = [];
    const r = migrate(db, [...real, next], {
      beforeMigrate: (from, to) => {
        calls.push([from, to]);
        // the pre-migration backup is made through the real backup code, before any change
        createBackup(db, path.join(dir, 'backups'), { kind: 'pre-migrate', appVersion: 'test', now: new Date() });
        expect(all(db, "SELECT name FROM pragma_table_info('products') WHERE name = 'shelf'")).toHaveLength(0);
      }
    });
    expect(calls).toEqual([[META.schema, next.version]]);
    expect(r.applied).toEqual([...real.slice(META.schema).map((m) => m.version), next.version]);
    expect(currentVersion(db)).toBe(next.version);
    expect(scalar(db, 'SELECT COUNT(*) FROM products')).toBe(META.counts.products);
    expect(scalar(db, 'SELECT COUNT(*) FROM shelf_notes')).toBe(META.counts.products);
    expect(all<{ sku: string; stock_qty: number }>(db, 'SELECT sku, stock_qty FROM products ORDER BY sku')).toEqual(META.stock);
    expect(schemaHistory(db).at(-1)?.name).toBe('fixture_next');
    expect(formatViolations(checkIntegrity(db))).toBe('');
    expect(fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.endsWith('.petrabak'))).toHaveLength(1);
    // running again changes nothing
    expect(migrate(db, [...real, next]).applied).toEqual([]);
  });

  it('a failing migration rolls back completely and the old data still opens', () => {
    const { db } = fixtureCopy();
    const broken: Migration = { version: next.version, name: 'broken', sql: `${next.sql}\nINSERT INTO no_such_table VALUES (1);` };
    expect(() => migrate(db, [...real, broken])).toThrow();
    // each migration is its own transaction: the released ones that came first stay applied, only the broken one is undone
    expect(currentVersion(db)).toBe(real.length);
    expect(all(db, "SELECT name FROM pragma_table_info('products') WHERE name = 'shelf'")).toHaveLength(0);
    expect(all(db, "SELECT name FROM sqlite_master WHERE name = 'shelf_notes'")).toHaveLength(0);
    expect(scalar(db, 'SELECT COUNT(*) FROM products')).toBe(META.counts.products);
    expect(migrate(db, [...real, next]).applied).toContain(next.version); // and a corrected migration then applies
  });

  it('a failing pre-migration backup stops the upgrade before anything changes', () => {
    const { db } = fixtureCopy();
    expect(() => migrate(db, [...real, next], { beforeMigrate: () => { throw new Error('disk full'); } })).toThrow('disk full');
    expect(currentVersion(db)).toBe(META.schema);
    expect(all(db, "SELECT name FROM pragma_table_info('products') WHERE name = 'shelf'")).toHaveLength(0);
  });

  it('a database from a newer app is refused and left alone', () => {
    const { db } = fixtureCopy();
    db.exec("INSERT INTO schema_version(version, name, applied_at) VALUES (99, 'from_the_future', '2099-01-01T00:00:00.000Z')");
    expect(() => migrate(db, real)).toThrowError(/newer/);
    expect(scalar(db, 'SELECT COUNT(*) FROM products')).toBe(META.counts.products);
  });
});
