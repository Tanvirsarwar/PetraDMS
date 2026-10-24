import { describe, it, expect } from 'vitest';
import { PetraError } from '@petra/core';
import { createTestWorld, setSetting } from './testkit';
import { buildSimWorld } from './sim';
import { checkIntegrity, formatViolations } from './integrity';
import {
  postPurchase, postSale, postSaleReturn, voidSale, voidPurchase, editSale, postPayment, postExpense,
  closeDay, reopenDay, postStockAdjustment, generateSalarySheet, postPurchaseReturn, voidSaleReturn, postPartyAdjustment
} from './index';
import { get, scalar } from './sql';

function expectSound(db: Parameters<typeof checkIntegrity>[0]): void {
  const v = checkIntegrity(db);
  expect(formatViolations(v)).toBe('');
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof PetraError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

function setup() {
  const world = createTestWorld();
  const w = buildSimWorld(world.ctx, world.managerId);
  return { world, w, ctx: world.ctx };
}

describe('weighted-average costing and the core money flow', () => {
  it('purchase -> sale -> COGS -> profit works end to end with exact integers', () => {
    const { w, ctx } = setup();
    const tea = w.products[1] as number; // plain product, Carton = 20
    const carton = (w.packs.get(tea) as number[])[1] as number;
    // 2 cartons @ 8,000.00 (=800000 poisha each) then 1 carton @ 9,100.00
    postPurchase(ctx, { supplierId: w.suppliers[0], date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 2, unitCost: 800_000 }], paid: 1_600_000 });
    postPurchase(ctx, { supplierId: w.suppliers[0], date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 1, unitCost: 910_000 }], paid: 0 });
    const p = get<{ stock_qty: number; stock_value: number }>(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', tea) as { stock_qty: number; stock_value: number };
    expect(p).toEqual({ stock_qty: 60, stock_value: 2_510_000 });

    // sell 10 base units: cogs = round(2,510,000 * 10 / 60) = 418,333
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: tea, qty: 10, price: 45_000 }], paid: 450_000 });
    expect(s.total).toBe(450_000);
    expect(s.cogs).toBe(418_333);
    expect(get(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', tea)).toEqual({ stock_qty: 50, stock_value: 2_091_667 });
    expectSound(ctx.db);
  });

  it('selling everything takes the exact remaining value, leaving none stranded', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 3, unitCost: 3_333 }], paid: 9_999 });
    postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 1, price: 9_600 }], paid: 9_600 });
    postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 1, price: 9_600 }], paid: 9_600 });
    postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 1, price: 9_600 }], paid: 9_600 });
    expect(get(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', noodles)).toEqual({ stock_qty: 0, stock_value: 0 });
    expect(scalar(ctx.db, "SELECT SUM(cogs) FROM sale_items WHERE product_id = ?", [noodles])).toBe(9_999);
    expectSound(ctx.db);
  });

  it('bonus goods carry no price and their cost goes to COGS', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 10_000 });
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 4, price: 2_000 }, { kind: 'bonus', productId: noodles, qty: 2, price: 999 }], paid: 8_000 });
    expect(s.total).toBe(8_000);
    expect(s.cogs).toBe(6_000);
    expect(scalar(ctx.db, "SELECT COUNT(*) FROM stock_movements WHERE kind = 'bonus'")).toBe(1);
    expectSound(ctx.db);
  });

  it('blocks negative stock by default and allows it when the owner says so', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    expect(codeOf(() => postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 1, price: 100 }], paid: 100 }))).toBe('NEGATIVE_STOCK');
    expect(scalar(ctx.db, 'SELECT COUNT(*) FROM sales')).toBe(0);
    setSetting(ctx, 'allow_negative_stock', '1');
    postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 5, price: 100 }], paid: 0 });
    expect(scalar(ctx.db, 'SELECT stock_qty FROM products WHERE id = ?', [noodles])).toBe(-5);
    // restocking into negative stock does not double count the units that were already sold
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 50 }], paid: 0 });
    expect(get(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', noodles)).toEqual({ stock_qty: 5, stock_value: 250 });
    expectSound(ctx.db);
  });
});

describe('batches and expiry (FEFO)', () => {
  it('sells the earliest-expiring batch first and restocks returns into the same batch', () => {
    const { w, ctx } = setup();
    const milk = w.products[0] as number;
    postPurchase(ctx, { supplierId: w.suppliers[0], date: '2026-03-01', lines: [
      { productId: milk, qty: 10, unitCost: 40_000, batchNo: 'LATE', expiry: '2027-06-01' },
      { productId: milk, qty: 10, unitCost: 40_000, batchNo: 'SOON', expiry: '2026-09-01' }
    ], paid: 0 });
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: milk, qty: 12, price: 52_000 }], paid: 0 });
    const batches = (b: string) => scalar(ctx.db, 'SELECT qty_remaining FROM stock_batches WHERE batch_no = ?', [b]);
    expect(batches('SOON')).toBe(0);
    expect(batches('LATE')).toBe(8);
    const item = get<{ id: number }>(ctx.db, 'SELECT id FROM sale_items WHERE sale_id = ?', s.id) as { id: number };
    postSaleReturn(ctx, { saleId: s.id, date: '2026-03-02', items: [{ saleItemId: item.id, baseQty: 12 }], refundMode: 'due' });
    expect(batches('SOON')).toBe(10);
    expect(batches('LATE')).toBe(10);
    expectSound(ctx.db);
  });

  it('lets the cashier override the batch', () => {
    const { w, ctx } = setup();
    const milk = w.products[0] as number;
    postPurchase(ctx, { supplierId: w.suppliers[0], date: '2026-03-01', lines: [
      { productId: milk, qty: 5, unitCost: 100, batchNo: 'A', expiry: '2027-01-01' },
      { productId: milk, qty: 5, unitCost: 100, batchNo: 'B', expiry: '2026-06-01' }
    ], paid: 0 });
    const a = get<{ id: number }>(ctx.db, "SELECT id FROM stock_batches WHERE batch_no = 'A'") as { id: number };
    postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: milk, qty: 3, price: 60_000, batchId: a.id }], paid: 0 });
    expect(scalar(ctx.db, "SELECT qty_remaining FROM stock_batches WHERE batch_no = 'A'")).toBe(2);
    expect(scalar(ctx.db, "SELECT qty_remaining FROM stock_batches WHERE batch_no = 'B'")).toBe(5);
    expectSound(ctx.db);
  });
});

describe('ledger, payments, returns and voids', () => {
  it('keeps the khata balance and the invoice footer figures consistent', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    const karim = w.customers[1] as number; // opening due 1,500.00
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 100, unitCost: 5_000 }], paid: 0 });
    postSale(ctx, { customerId: karim, date: '2026-03-02', lines: [{ productId: noodles, qty: 10, price: 9_600 }], paid: 50_000 });
    expect(scalar(ctx.db, 'SELECT balance FROM customers WHERE id = ?', [karim])).toBe(150_000 + 96_000 - 50_000);
    postPayment(ctx, { partyKind: 'customer', partyId: karim, amount: 100_000, date: '2026-03-03' });
    expect(scalar(ctx.db, 'SELECT balance FROM customers WHERE id = ?', [karim])).toBe(96_000);
    expectSound(ctx.db);
  });

  it('partial sales return restocks at the original COGS and refunds net of the discount', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 10_000 });
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: noodles, qty: 10, price: 2_000 }], discKind: 'fixed', discValue: 2_000, paid: 18_000 });
    const item = get<{ id: number }>(ctx.db, 'SELECT id FROM sale_items WHERE sale_id = ?', s.id) as { id: number };
    const r1 = postSaleReturn(ctx, { saleId: s.id, date: '2026-03-03', items: [{ saleItemId: item.id, baseQty: 5 }], refundMode: 'cash' });
    expect(r1.netAmount).toBe(9_000);
    expect(r1.cogsRestored).toBe(5_000);
    const r2 = postSaleReturn(ctx, { saleId: s.id, date: '2026-03-03', items: [{ saleItemId: item.id, baseQty: 5 }], refundMode: 'due' });
    expect(r1.netAmount + r2.netAmount).toBe(18_000);
    expect(codeOf(() => postSaleReturn(ctx, { saleId: s.id, date: '2026-03-03', items: [{ saleItemId: item.id, baseQty: 1 }], refundMode: 'due' }))).toBe('OVER_RETURN');
    expect(get(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', noodles)).toEqual({ stock_qty: 10, stock_value: 10_000 });
    expectSound(ctx.db);
  });

  it('void reverses everything and nets to zero; a second void and a missing reason are rejected', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 10_000 });
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: noodles, qty: 4, price: 2_000 }], paid: 3_000 });
    const before = get(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', noodles);
    expect(codeOf(() => voidSale(ctx, s.id, ' '))).toBe('REASON_REQUIRED');
    voidSale(ctx, s.id, 'customer cancelled');
    expect(codeOf(() => voidSale(ctx, s.id, 'again'))).toBe('ALREADY_VOID');
    expect(get(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', noodles)).toEqual({ stock_qty: 10, stock_value: 10_000 });
    expect(before).toEqual({ stock_qty: 6, stock_value: 6_000 });
    expect(scalar(ctx.db, 'SELECT balance FROM customers WHERE id = ?', [w.customers[0]])).toBe(0);
    expectSound(ctx.db);
  });

  it('cannot void a sale that has a live return, but can after the return is voided', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 10_000 });
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: noodles, qty: 4, price: 2_000 }], paid: 0 });
    const item = get<{ id: number }>(ctx.db, 'SELECT id FROM sale_items WHERE sale_id = ?', s.id) as { id: number };
    const r = postSaleReturn(ctx, { saleId: s.id, date: '2026-03-02', items: [{ saleItemId: item.id, baseQty: 1 }], refundMode: 'due' });
    expect(codeOf(() => voidSale(ctx, s.id, 'x'))).toBe('HAS_RETURNS');
    voidSaleReturn(ctx, r.id, 'mistake');
    voidSale(ctx, s.id, 'ok now');
    expectSound(ctx.db);
  });

  it('cannot void a purchase whose stock has already been sold', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    const p = postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 0 });
    postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: noodles, qty: 4, price: 2_000 }], paid: 0 });
    expect(codeOf(() => voidPurchase(ctx, p.id, 'oops'))).toBe('NEGATIVE_STOCK');
    expectSound(ctx.db);
  });

  it('edit invoice keeps the number, bumps the revision and snapshots the old one in the audit log', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 10_000 });
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: noodles, qty: 4, price: 2_000 }], paid: 8_000 });
    const e = editSale(ctx, s.id, { customerId: w.customers[0], lines: [{ productId: noodles, qty: 6, price: 2_000 }], paid: 5_000 }, 'customer took 2 more');
    expect(e.docNo).toBe(s.docNo);
    expect(e.revision).toBe(2);
    expect(e.total).toBe(12_000);
    expect(scalar(ctx.db, 'SELECT stock_qty FROM products WHERE id = ?', [noodles])).toBe(4);
    expect(scalar(ctx.db, 'SELECT balance FROM customers WHERE id = ?', [w.customers[0]])).toBe(7_000);
    const snap = get<{ before_json: string }>(ctx.db, "SELECT before_json FROM audit_log WHERE action = 'sale.edit'") as { before_json: string };
    expect(JSON.parse(snap.before_json).sale.total).toBe(8_000);
    // and the edited invoice can still be voided cleanly
    voidSale(ctx, s.id, 'cancel after edit');
    expect(scalar(ctx.db, 'SELECT stock_qty FROM products WHERE id = ?', [noodles])).toBe(10);
    expectSound(ctx.db);
  });

  it('a failed posting leaves nothing behind (atomic)', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 2, unitCost: 1_000 }], paid: 0 });
    const counts = () => [scalar(ctx.db, 'SELECT COUNT(*) FROM sales'), scalar(ctx.db, 'SELECT COUNT(*) FROM stock_movements'), scalar(ctx.db, 'SELECT COUNT(*) FROM party_ledger'), scalar(ctx.db, 'SELECT COUNT(*) FROM counters WHERE key = ?', ['INV'])];
    const before = counts();
    // second line fails after the first has already been processed
    expect(codeOf(() => postSale(ctx, { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: noodles, qty: 1, price: 2_000 }, { productId: noodles, qty: 5, price: 2_000 }], paid: 0 }))).toBe('NEGATIVE_STOCK');
    expect(counts()).toEqual(before);
    expect(scalar(ctx.db, 'SELECT stock_qty FROM products WHERE id = ?', [noodles])).toBe(2);
    expectSound(ctx.db);
  });
});

describe('policy: minimum price, credit limit, roles', () => {
  it('requires a manager approval below the minimum price', () => {
    const { w, ctx, world } = setup();
    const ss = w.products[4] as number; // min price 800.00 per base unit
    postPurchase(ctx, { supplierId: w.suppliers[0], date: '2026-03-01', lines: [{ productId: ss, qty: 5, unitCost: 70_000 }], paid: 0 });
    const low = { customerId: w.customers[0], date: '2026-03-02', lines: [{ productId: ss, qty: 1, price: 75_000 }], paid: 75_000 };
    expect(codeOf(() => postSale(ctx, low))).toBe('APPROVAL_REQUIRED');
    expect(codeOf(() => postSale(ctx, { ...low, approvedBy: world.staffId }))).toBe('PERMISSION');
    expect(codeOf(() => postSale(ctx, { ...low, approvedBy: world.managerId }))).toBe('NO_ERROR');
  });

  it('credit limit: warn returns a warning, block rejects', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 100, unitCost: 1_000 }], paid: 0 });
    const small = w.customers[3] as number; // limit 1,000.00
    const r = postSale(ctx, { customerId: small, date: '2026-03-02', lines: [{ productId: noodles, qty: 10, price: 20_000 }], paid: 0 });
    expect(r.warnings).toContain('credit_limit');
    setSetting(ctx, 'credit_limit_mode', 'block');
    expect(codeOf(() => postSale(ctx, { customerId: small, date: '2026-03-02', lines: [{ productId: noodles, qty: 1, price: 20_000 }], paid: 0 }))).toBe('CREDIT_LIMIT');
  });

  it('a walk-in sale must be paid in full', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { date: '2026-03-01', lines: [{ productId: noodles, qty: 5, unitCost: 1_000 }], paid: 5_000 });
    expect(codeOf(() => postSale(ctx, { date: '2026-03-02', lines: [{ productId: noodles, qty: 1, price: 2_000 }], paid: 0 }))).toBe('INVALID_INPUT');
    expect(codeOf(() => postSale(ctx, { date: '2026-03-02', lines: [{ productId: noodles, qty: 1, price: 2_000 }], paid: 2_000 }))).toBe('NO_ERROR');
  });
});

describe('stock adjustments, losses and purchase returns', () => {
  it('damage and expiry write-offs reduce stock at average cost', () => {
    const { w, ctx } = setup();
    const tea = w.products[1] as number;
    postStockAdjustment(ctx, { productId: tea, kind: 'opening', baseQty: 100, value: 450_000, date: '2026-03-01' });
    const d = postStockAdjustment(ctx, { productId: tea, kind: 'damage', baseQty: 10, date: '2026-03-02', reason: 'water damage' });
    expect(d.value).toBe(45_000);
    expect(codeOf(() => postStockAdjustment(ctx, { productId: tea, kind: 'damage', baseQty: 1, date: '2026-03-02' }))).toBe('REASON_REQUIRED');
    expectSound(ctx.db);
  });

  it('purchase return books the price difference as variance', () => {
    const { w, ctx } = setup();
    const tea = w.products[1] as number;
    postPurchase(ctx, { supplierId: w.suppliers[0], date: '2026-03-01', lines: [{ productId: tea, qty: 10, unitCost: 1_000 }], paid: 0 });
    const r = postPurchaseReturn(ctx, { supplierId: w.suppliers[0], date: '2026-03-02', lines: [{ productId: tea, baseQty: 4, credit: 3_500 }], refundMode: 'due' });
    expect(r.costValue).toBe(4_000);
    expect(r.variance).toBe(500);
    expect(scalar(ctx.db, 'SELECT balance FROM suppliers WHERE id = ?', [w.suppliers[0]])).toBe(10_000 - 3_500);
    expectSound(ctx.db);
  });
});

describe('day closing', () => {
  it('locks the day, books the difference, and the owner can reopen the latest closed day', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 0 });
    postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 5, price: 2_000 }], paid: 10_000 });
    postExpense(ctx, { categoryId: w.categories[0] as number, amount: 2_000, date: '2026-03-01', accountId: w.accounts[0] });
    const c = closeDay(ctx, { date: '2026-03-01', actualCash: 7_500 });
    expect(c.expectedCash).toBe(8_000);
    expect(c.difference).toBe(-500);
    expect(scalar(ctx.db, 'SELECT balance FROM money_accounts WHERE id = ?', [w.accounts[0]])).toBe(7_500);
    expect(codeOf(() => postExpense(ctx, { categoryId: w.categories[0] as number, amount: 1, date: '2026-03-01' }))).toBe('DAY_CLOSED');
    expect(codeOf(() => postExpense(ctx, { categoryId: w.categories[0] as number, amount: 1, date: '2026-02-20' }))).toBe('DAY_CLOSED');
    expect(codeOf(() => postExpense(ctx, { categoryId: w.categories[0] as number, amount: 1, date: '2026-03-02' }))).toBe('NO_ERROR');
    expect(codeOf(() => reopenDay(ctx, '2026-03-01', ''))).toBe('REASON_REQUIRED');
    reopenDay(ctx, '2026-03-01', 'counted wrong');
    expect(scalar(ctx.db, 'SELECT balance FROM money_accounts WHERE id = ?', [w.accounts[0]])).toBe(8_000 - 1);
    expect(codeOf(() => postExpense(ctx, { categoryId: w.categories[0] as number, amount: 1, date: '2026-03-01' }))).toBe('NO_ERROR');
    closeDay(ctx, { date: '2026-03-01', actualCash: 7_998 });
    expectSound(ctx.db);
  });

  it('refuses to void a document from a closed day', () => {
    const { w, ctx } = setup();
    const noodles = w.products[2] as number;
    postPurchase(ctx, { supplierId: w.suppliers[2], date: '2026-03-01', lines: [{ productId: noodles, qty: 10, unitCost: 1_000 }], paid: 0 });
    const s = postSale(ctx, { customerId: w.customers[0], date: '2026-03-01', lines: [{ productId: noodles, qty: 1, price: 2_000 }], paid: 0 });
    closeDay(ctx, { date: '2026-03-01', actualCash: 0 });
    expect(codeOf(() => voidSale(ctx, s.id, 'late'))).toBe('DAY_CLOSED');
  });
});

describe('salary and employee ledger', () => {
  it('generates a sheet once per month and pays against the employee ledger', () => {
    const { w, ctx } = setup();
    const r = generateSalarySheet(ctx, { month: '2026-03', date: '2026-03-31', adjustments: [{ employeeId: w.employees[0] as number, bonus: 100_000, deduction: 50_000 }] });
    expect(r.total).toBe(1_500_000 + 100_000 - 50_000 + 1_200_000);
    expect(codeOf(() => generateSalarySheet(ctx, { month: '2026-03', date: '2026-03-31' }))).toBe('DUPLICATE');
    postPayment(ctx, { partyKind: 'employee', partyId: w.employees[1] as number, amount: 500_000, date: '2026-03-31', purpose: 'advance' });
    expect(scalar(ctx.db, 'SELECT balance FROM employees WHERE id = ?', [w.employees[1]])).toBe(1_200_000 - 500_000);
    expectSound(ctx.db);
  });
});

describe('opening dues and adjustments', () => {
  it('needs a reason for a manual adjustment', () => {
    const { w, ctx } = setup();
    expect(codeOf(() => postPartyAdjustment(ctx, { partyKind: 'customer', partyId: w.customers[0] as number, amount: 100, date: '2026-03-01', kind: 'adjustment', note: '' }))).toBe('REASON_REQUIRED');
  });
});
