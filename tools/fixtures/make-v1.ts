/**
 * Builds packages/db/fixtures/petra-v1.db: a real, small shop on schema version 1. It is committed and never regenerated
 * once released, so every later migration is tested against the database an early customer actually has.
 * Run only when deliberately creating a new fixture:  pnpm tsx tools/fixtures/make-v1.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, ok, setupWithUsers } from '../../packages/db/src/testApp';
import { all } from '../../packages/db/src/sql';

const out = path.resolve('packages/db/fixtures/petra-v1.db');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-fixture-'));
const app = makeApp(undefined, { dataDir: dir });
await setupWithUsers(app.d);
const area = await ok(app.d, 'area:save', { name: 'Zindabazar' });
const cust = await ok(app.d, 'customer:save', { name: 'Karim Store', phone: '01711111111', areaId: area.id, type: 'wholesale', creditLimit: 0, openingBalance: 245000 });
await ok(app.d, 'customer:save', { name: 'Rahim Mart', phone: '01722222222', type: 'retail', creditLimit: 0, openingBalance: 0 });
const sup = await ok(app.d, 'catalog:supplierSave', { name: 'Marks Ltd' });
const milk = await ok(app.d, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk 500g', nameBn: 'মার্কস দুধ', baseUnit: 'pcs', priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, minPrice: 48000, barcodes: ['8901111111111'] });
const tea = await ok(app.d, 'catalog:productSave', { sku: 'TEA', name: 'Sylon Tea 400g', baseUnit: 'pcs', priceRetail: 45000, priceWholesale: 42000, priceDealer: 40000, trackExpiry: false });
const today = (await ok(app.d, 'app:status')).businessDate;
await ok(app.d, 'purchase:save', { supplierId: sup.id, date: today, lines: [{ productId: milk.id, qty: 100, unitCost: 40000 }, { productId: tea.id, qty: 50, unitCost: 33000 }], paid: 1500000 });
await ok(app.d, 'sale:save', { customerId: cust.id, date: today, lines: [{ productId: milk.id, qty: 10 }, { productId: tea.id, qty: 5 }], paid: 200000 });
await ok(app.d, 'sale:save', { customerId: null, date: today, lines: [{ productId: tea.id, qty: 2 }], paid: 90000 });
const cat = (await ok(app.d, 'exp:categories', { includeArchived: false }))[0]!;
await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 150000, date: today, payee: 'Shop rent', note: '' });

fs.rmSync(out, { force: true });
app.d.db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
const n = (t: string) => (all<{ n: number }>(app.d.db, `SELECT COUNT(*) AS n FROM ${t}`)[0] as { n: number }).n;
const meta = {
  schema: 1,
  counts: { products: n('products'), customers: n('customers'), suppliers: n('suppliers'), sales: n('sales'), purchases: n('purchases'), expenses: n('expenses'), users: n('users') },
  customerBalances: all<{ name: string; balance: number }>(app.d.db, 'SELECT name, balance FROM customers ORDER BY name'),
  stock: all<{ sku: string; stock_qty: number }>(app.d.db, 'SELECT sku, stock_qty FROM products ORDER BY sku')
};
fs.writeFileSync(out.replace(/\.db$/, '.json'), JSON.stringify(meta, null, 2) + '\n');
app.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('wrote', out, meta.counts);
