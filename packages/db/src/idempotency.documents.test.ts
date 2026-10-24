import { afterEach, describe, expect, it } from 'vitest';
import { scalar } from './sql';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, type App } from './testApp';

let app: App;
afterEach(() => app?.close());

const DATE = '2026-10-01';
const count = (sql: string, ...p: (string | number)[]) => scalar(app.d.db, sql, p);

async function seed() {
  app = makeApp();
  await setupWithUsers(app.d);
  const cust = await ok(app.d, 'customer:save', { name: 'Karim Store', phone: '', type: 'wholesale', creditLimit: 0, openingBalance: 0, openingDate: DATE });
  const sup = await ok(app.d, 'catalog:supplierSave', { name: 'Marks Ltd', nameBn: '', phone: '', address: '', notes: '', openingBalance: 0 });
  const milk = await ok(app.d, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk', nameBn: '', baseUnit: 'pcs', trackExpiry: false, priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, minPrice: 0, reorderLevel: 0, favourite: false, notes: '', barcodes: [], packs: [] });
  await ok(app.d, 'purchase:save', { supplierId: sup.id, date: DATE, lines: [{ productId: milk.id, qty: 100, unitCost: 40000 }], discount: 0, paid: 0, note: '' });
  return { cust, sup, milk };
}

describe('Stage 3: sales, purchases, returns and stock adjustments post exactly once per request id', () => {
  it('a sale sent twice with one request id is one invoice: stock, dues and cash move once', async () => {
    const { cust, milk } = await seed();
    const input = { date: DATE, customerId: cust.id, lines: [{ productId: milk.id, qty: 10, price: 52000 }], paid: 100000, note: '', requestId: 'sale-req-0001' };
    const a = await ok(app.d, 'sale:save', input);
    const b = await ok(app.d, 'sale:save', input);
    expect(b).toEqual(a);
    expect(count('SELECT COUNT(*) FROM sales')).toBe(1);
    expect(count('SELECT stock_qty FROM products WHERE id = ?', milk.id)).toBe(90);
    expect(count('SELECT balance FROM customers WHERE id = ?', cust.id)).toBe(520000 - 100000);
    expect(count("SELECT COUNT(*) FROM cash_transactions WHERE source = 'sale'")).toBe(1);
    expectIntegrity(app);
  });

  it('the same request id with a different cart is refused, never merged; a new id is a new invoice', async () => {
    const { cust, milk } = await seed();
    await ok(app.d, 'sale:save', { date: DATE, customerId: cust.id, lines: [{ productId: milk.id, qty: 1, price: 52000 }], paid: 0, note: '', requestId: 'sale-req-0002' });
    expect(await fail(app.d, 'sale:save', { date: DATE, customerId: cust.id, lines: [{ productId: milk.id, qty: 2, price: 52000 }], paid: 0, note: '', requestId: 'sale-req-0002' })).toBe('INVALID_INPUT');
    await ok(app.d, 'sale:save', { date: DATE, customerId: cust.id, lines: [{ productId: milk.id, qty: 2, price: 52000 }], paid: 0, note: '', requestId: 'sale-req-0003' });
    expect(count('SELECT COUNT(*) FROM sales')).toBe(2);
  });

  it('a failed sale leaves no request id behind, so the corrected retry posts', async () => {
    const { cust, milk } = await seed();
    const bad = { date: DATE, customerId: cust.id, lines: [{ productId: milk.id, qty: 1000, price: 52000 }], paid: 0, note: '', requestId: 'sale-req-0004' };
    expect(await fail(app.d, 'sale:save', bad)).toBe('NEGATIVE_STOCK');
    expect(count('SELECT COUNT(*) FROM idempotency_keys')).toBe(0);
    await ok(app.d, 'sale:save', { ...bad, lines: [{ productId: milk.id, qty: 5, price: 52000 }] });
    expect(count('SELECT COUNT(*) FROM sales')).toBe(1);
  });

  it('a partial sale return sent twice returns the goods once, not twice', async () => {
    const { cust, milk } = await seed();
    const sale = await ok(app.d, 'sale:save', { date: DATE, customerId: cust.id, lines: [{ productId: milk.id, qty: 10, price: 52000 }], paid: 0, note: '' });
    const detail = await ok(app.d, 'sale:get', { id: sale.id });
    const input = { saleId: sale.id, date: DATE, items: [{ saleItemId: detail.items[0]!.id, baseQty: 2 }], refundMode: 'due' as const, reason: '', requestId: 'ret-req-0001' };
    const a = await ok(app.d, 'sale:return', input);
    const b = await ok(app.d, 'sale:return', input);
    expect(b).toEqual(a);
    expect(count('SELECT COUNT(*) FROM sale_returns')).toBe(1);
    expect(count('SELECT stock_qty FROM products WHERE id = ?', milk.id)).toBe(100 - 10 + 2);
    expect(count('SELECT balance FROM customers WHERE id = ?', cust.id)).toBe(520000 - 2 * 52000);
    expectIntegrity(app);
  });

  it('a purchase sent twice with one request id adds the stock and the payable once, even without a company invoice number', async () => {
    const { sup, milk } = await seed();
    const input = { supplierId: sup.id, date: DATE, lines: [{ productId: milk.id, qty: 10, unitCost: 41000 }], discount: 0, paid: 0, note: '', requestId: 'pur-req-0001' };
    const a = await ok(app.d, 'purchase:save', input);
    const b = await ok(app.d, 'purchase:save', input);
    expect(b).toEqual(a);
    expect(count('SELECT COUNT(*) FROM purchases')).toBe(2); // the seed purchase + this one
    expect(count('SELECT stock_qty FROM products WHERE id = ?', milk.id)).toBe(110);
    expect(count('SELECT balance FROM suppliers WHERE id = ?', sup.id)).toBe(100 * 40000 + 10 * 41000);
    expectIntegrity(app);
  });

  it('a purchase return sent twice returns the goods and takes the credit once', async () => {
    const { sup, milk } = await seed();
    const input = { supplierId: sup.id, purchaseId: null, date: DATE, lines: [{ productId: milk.id, baseQty: 5, credit: 200000 }], refundMode: 'due' as const, reason: 'damaged', requestId: 'pret-req-0001' };
    const a = await ok(app.d, 'purchase:return', input);
    const b = await ok(app.d, 'purchase:return', input);
    expect(b).toEqual(a);
    expect(count('SELECT stock_qty FROM products WHERE id = ?', milk.id)).toBe(95);
    expect(count('SELECT balance FROM suppliers WHERE id = ?', sup.id)).toBe(100 * 40000 - 200000);
    expectIntegrity(app);
  });

  it('a stock adjustment sent twice with one request id changes stock once', async () => {
    const { milk } = await seed();
    const input = { productId: milk.id, kind: 'damage' as const, baseQty: 3, date: DATE, reason: 'broken', requestId: 'adj-req-0001' };
    const a = await ok(app.d, 'stock:adjust', input);
    const b = await ok(app.d, 'stock:adjust', input);
    expect(b).toEqual(a);
    expect(count('SELECT stock_qty FROM products WHERE id = ?', milk.id)).toBe(97);
    expect(count("SELECT COUNT(*) FROM stock_adjustments")).toBe(1);
    expectIntegrity(app);
  });

  it('without a request id nothing changes: two sales are two sales', async () => {
    const { cust, milk } = await seed();
    const input = { date: DATE, customerId: cust.id, lines: [{ productId: milk.id, qty: 1, price: 52000 }], paid: 0, note: '' };
    await ok(app.d, 'sale:save', input);
    await ok(app.d, 'sale:save', input);
    expect(count('SELECT COUNT(*) FROM sales')).toBe(2);
  });
});
