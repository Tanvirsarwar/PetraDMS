import { addDays, computePurchase, isPetraError } from '@petra/core';
import { type Ctx, tx } from './ctx';
import { all, get } from './sql';
import {
  createCustomer, createEmployee, createProduct, createSupplier, createArea
} from './masters';
import { postSale, editSale, voidSale, postSaleReturn, voidSaleReturn } from './sales';
import { postPurchase, voidPurchase, postPurchaseReturn, voidPurchaseReturn } from './purchases';
import { postPayment, voidPayment, postExpense, voidExpense, generateSalarySheet, voidSalarySheet, postPartyAdjustment } from './money';
import { postStockAdjustment, voidStockAdjustment, type AdjustKind } from './adjustments';
import { closeDay, reopenDay } from './dayclose';
import { setRaw } from './settings';
import { listAccounts } from './masters';

/**
 * A tiny deterministic "shop" plus an interpreter for random operations. The property tests feed it
 * thousands of random sequences and then assert invariants I1-I12. Engine rejections (PetraError) are
 * expected and must leave no trace; anything else - a SQL error, a crash - fails the run.
 */
export interface SimConfig {
  allowNegativeStock: boolean;
  roundOff: boolean;
  taxBp: number;
  creditLimitMode: 'off' | 'warn' | 'approval' | 'block';
  minPriceMode: 'off' | 'approval';
}

export const DEFAULT_SIM_CONFIG: SimConfig = { allowNegativeStock: false, roundOff: false, taxBp: 0, creditLimitMode: 'warn', minPriceMode: 'approval' };

export type Op =
  | {
      t: 'purchase'; sup: number;
      lines: { p: number; pack: number; qty: number; cost: number; batch: number; expiryDays: number; loose?: number; free?: boolean; discKind?: 'pct' | 'fixed' | null; discValue?: number }[];
      discount: number; paidPct: number; dayOff: number;
      /** v1.1: percent bill discount instead of the fixed one, VAT / other charge and freight. */
      billPct?: number; tax?: number; freight?: number;
    }
  | { t: 'sale'; cust: number; lines: { p: number; pack: number; qty: number; priceMul: number; bonus: boolean; discKind: 'pct' | 'fixed' | null; discValue: number }[]; discKind: 'pct' | 'fixed' | null; discValue: number; paidPct: number; tier: 'retail' | 'wholesale' | 'dealer' | null; approved: boolean; dayOff: number }
  | { t: 'editSale'; i: number; qtyDelta: number; paidPct: number; approved: boolean }
  | { t: 'saleReturn'; i: number; item: number; qty: number; mode: 'due' | 'cash'; dayOff: number }
  | { t: 'purchaseReturn'; sup: number; p: number; qty: number; creditPct: number; mode: 'due' | 'cash'; dayOff: number }
  /** v1.1: return box + pcs against a recorded purchase (capped at what it brought in). */
  | { t: 'purchaseReturnOf'; i: number; line: number; box: number; pcs: number; creditPct: number; mode: 'due' | 'cash'; dayOff: number }
  | { t: 'void'; what: 'sale' | 'purchase' | 'payment' | 'expense' | 'saleReturn' | 'purchaseReturn' | 'adjustment' | 'salary'; i: number }
  | { t: 'receive'; cust: number; amount: number; dayOff: number }
  | { t: 'paySupplier'; sup: number; amount: number; dayOff: number }
  | { t: 'expense'; cat: number; amount: number; account: number; dayOff: number }
  | { t: 'adjust'; p: number; kind: AdjustKind; qty: number; value: number; dayOff: number }
  | { t: 'salary'; month: number; bonus: number; deduction: number }
  | { t: 'payEmployee'; emp: number; amount: number; advance: boolean }
  | { t: 'ledgerAdjust'; cust: number; amount: number }
  | { t: 'close'; actualDelta: number }
  | { t: 'reopen' }
  | { t: 'nextDay' };

export interface SimWorld {
  ctx: Ctx;
  products: number[];
  packs: Map<number, number[]>;
  customers: number[];
  suppliers: number[];
  employees: number[];
  categories: number[];
  accounts: number[];
  managerId: number;
  day: string;
  docs: {
    sales: number[]; purchases: number[]; payments: number[]; expenses: number[];
    saleReturns: number[]; purchaseReturns: number[]; adjustments: number[]; sheets: number[];
  };
  stats: { ok: number; rejected: number; byCode: Record<string, number> };
}

export function applyConfig(ctx: Ctx, c: SimConfig): void {
  setRaw(ctx, 'allow_negative_stock', c.allowNegativeStock ? '1' : '0');
  setRaw(ctx, 'round_off', c.roundOff ? '1' : '0');
  setRaw(ctx, 'tax_bp', String(c.taxBp));
  setRaw(ctx, 'credit_limit_mode', c.creditLimitMode);
  setRaw(ctx, 'min_price_mode', c.minPriceMode);
}

/** Five products (two with expiry tracking and multi-level packs), four customers, three suppliers, three employees. */
export function buildSimWorld(ctx: Ctx, managerId: number, config: SimConfig = DEFAULT_SIM_CONFIG, startDay = '2026-03-01'): SimWorld {
  applyConfig(ctx, config);
  const area = createArea(ctx, 'Zindabazar');
  const mk = (sku: string, name: string, price: number, track: boolean, packs: { name: string; factor: number }[], min = 0): number =>
    createProduct(ctx, { sku, name, baseUnit: 'pcs', trackExpiry: track, priceRetail: price, priceWholesale: Math.round(price * 0.95), priceDealer: Math.round(price * 0.9), minPrice: min, packs });
  const products = [
    mk('MARKS-PM-500G', 'Marks Powder Milk 500 G', 52_000, true, [{ name: 'Box', factor: 24 }, { name: 'Small Box', factor: 12 }], 40_000),
    mk('TEA-500G', 'Tea 500 G', 45_000, false, [{ name: 'Carton', factor: 20 }]),
    mk('SHAH-NOODLES-12PK', 'Shah Noodles 12 PK', 9_600, false, [{ name: 'Carton', factor: 12 }]),
    mk('AMA-MILK-200G', 'Ama Milk 200 G', 21_000, true, [{ name: 'Box', factor: 36 }]),
    mk('SS-MILK-1KG', 'SS Milk 1 KG', 95_000, false, [], 80_000)
  ];
  const packs = new Map<number, number[]>();
  for (const p of products) packs.set(p, all<{ id: number }>(ctx.db, 'SELECT id FROM product_packs WHERE product_id = ? ORDER BY factor', p).map((r) => r.id));
  const customers = [
    createCustomer(ctx, { name: 'Rahman Store', areaId: area, type: 'retail', creditLimit: 5_000_000 }),
    createCustomer(ctx, { name: 'Karim Traders', areaId: area, type: 'wholesale', creditLimit: 20_000_000, openingBalance: 150_000, openingDate: '2026-02-28' }),
    createCustomer(ctx, { name: 'Nasir Dealer', type: 'dealer', creditLimit: 0 }),
    createCustomer(ctx, { name: 'Small Shop', creditLimit: 100_000 })
  ];
  const suppliers = [createSupplier(ctx, { name: 'Marks Ltd' }), createSupplier(ctx, { name: 'Tea Estate', openingBalance: 500_000, openingDate: '2026-02-28' }), createSupplier(ctx, { name: 'Noodle Co' })];
  const employees = [
    createEmployee(ctx, { name: 'Salim', baseSalary: 1_500_000 }),
    createEmployee(ctx, { name: 'Jamal', baseSalary: 1_200_000 }),
    createEmployee(ctx, { name: 'Ruma', baseSalary: 0 })
  ];
  const categories = all<{ id: number }>(ctx.db, 'SELECT id FROM expense_categories ORDER BY id LIMIT 2').map((r) => r.id);
  const accounts = listAccounts(ctx).map((a) => a.id);
  return {
    ctx, products, packs, customers, suppliers, employees, categories, accounts, managerId, day: startDay,
    docs: { sales: [], purchases: [], payments: [], expenses: [], saleReturns: [], purchaseReturns: [], adjustments: [], sheets: [] },
    stats: { ok: 0, rejected: 0, byCode: {} }
  };
}

const pick = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length] as T;

function dateFor(w: SimWorld, dayOff: number): string {
  return addDays(w.day, dayOff);
}

function expiryFor(w: SimWorld, days: number): string | null {
  return days < 0 ? null : addDays(w.day, days);
}

function run(w: SimWorld, fn: () => number | void, onOk?: (id: number) => void): void {
  try {
    const r = fn();
    if (typeof r === 'number' && onOk) onOk(r);
    w.stats.ok++;
  } catch (e) {
    if (!isPetraError(e)) throw e;
    w.stats.rejected++;
    w.stats.byCode[e.code] = (w.stats.byCode[e.code] ?? 0) + 1;
  }
}

export function applyOp(w: SimWorld, op: Op): void {
  const { ctx } = w;
  switch (op.t) {
    case 'purchase': {
      const sup = op.sup < 0 ? null : pick(w.suppliers, op.sup);
      run(w, () => {
        const lines = op.lines.map((l) => {
          const p = pick(w.products, l.p);
          const packs = w.packs.get(p) as number[];
          return {
            productId: p, packId: pick(packs, l.pack), qty: l.qty, looseQty: l.loose ?? 0, unitCost: l.cost, kind: l.free ? ('free' as const) : ('normal' as const),
            discKind: l.discKind ?? null, discValue: l.discKind === 'pct' ? Math.min(l.discValue ?? 0, 10_000) : l.discValue ?? 0,
            batchNo: `B${l.batch}`, expiry: expiryFor(w, l.expiryDays)
          };
        });
        const extras = { tax: op.tax ?? 0, freight: op.freight ?? 0 };
        // the shared purchase arithmetic gives the exact total (pieces, discounts, charges); pay a share of it
        const factorOf = (packId: number): number => (get<{ factor: number }>(ctx.db, 'SELECT factor FROM product_packs WHERE id = ?', packId) as { factor: number }).factor;
        const calc = computePurchase({
          lines: lines.map((l) => ({ kind: l.kind, factor: factorOf(l.packId), boxes: l.qty, pcs: l.looseQty, costPerBox: l.unitCost, discKind: l.discKind, discValue: l.discValue })),
          billDiscKind: op.billPct !== undefined ? 'pct' : null,
          billDiscValue: op.billPct !== undefined ? Math.min(op.billPct, 10_000) : 0,
          ...extras
        });
        const bill = op.billPct !== undefined ? { discKind: 'pct' as const, discValue: Math.min(op.billPct, 10_000) } : { discount: Math.min(op.discount, calc.subtotal) };
        const total = op.billPct !== undefined ? calc.total : calc.total - bill.discount!;
        const paid = sup === null ? total : Math.floor((total * op.paidPct) / 100);
        return postPurchase(ctx, { supplierId: sup, date: dateFor(w, op.dayOff), lines, ...bill, ...extras, paid, accountId: pick(w.accounts, op.dayOff + 1) }).id;
      }, (id) => w.docs.purchases.push(id));
      break;
    }
    case 'purchaseReturnOf': {
      if (w.docs.purchases.length === 0) break;
      const purchaseId = pick(w.docs.purchases, op.i);
      run(w, () => {
        const items = all<{ product_id: number; factor: number; supplier_id: number | null }>(ctx.db, 'SELECT i.product_id, k.factor, p.supplier_id FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id JOIN product_packs k ON k.product_id = i.product_id WHERE i.purchase_id = ? AND k.factor = (SELECT MAX(factor) FROM product_packs WHERE product_id = i.product_id) ORDER BY i.line_no', purchaseId);
        if (items.length === 0) return;
        const it = pick(items, op.line);
        const baseQty = op.box * it.factor + op.pcs;
        if (baseQty === 0) return;
        const avg = get<{ stock_qty: number; stock_value: number }>(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', it.product_id) as { stock_qty: number; stock_value: number };
        const est = avg.stock_qty > 0 ? Math.floor((avg.stock_value * Math.min(baseQty, avg.stock_qty)) / avg.stock_qty) : 0;
        return postPurchaseReturn(ctx, { supplierId: it.supplier_id, purchaseId, date: dateFor(w, op.dayOff), lines: [{ productId: it.product_id, baseQty, credit: Math.floor((est * op.creditPct) / 100) }], refundMode: it.supplier_id === null ? 'cash' : op.mode, accountId: pick(w.accounts, op.dayOff + 3) }).id;
      }, (id) => w.docs.purchaseReturns.push(id));
      break;
    }
    case 'sale': {
      const cust = op.cust < 0 ? null : pick(w.customers, op.cust);
      run(w, () => {
        const lines = op.lines.map((l) => {
          const p = pick(w.products, l.p);
          const packId = pick(w.packs.get(p) as number[], l.pack);
          const row = get<{ price_retail: number; factor: number }>(ctx.db, 'SELECT p.price_retail, k.factor FROM products p JOIN product_packs k ON k.id = ? WHERE p.id = ?', packId, p) as { price_retail: number; factor: number };
          return {
            kind: l.bonus ? ('bonus' as const) : ('normal' as const), productId: p, packId, qty: l.qty,
            price: Math.max(0, Math.round((row.price_retail * row.factor * l.priceMul) / 100)),
            discKind: l.discKind, discValue: l.discKind === 'pct' ? Math.min(l.discValue, 10_000) : l.discValue
          };
        });
        // Work out the total the same way the engine will, so we can pay a sensible fraction of it.
        const gross = lines.reduce((a, l) => a + (l.kind === 'bonus' ? 0 : l.qty * l.price), 0);
        const approx = Math.max(0, gross);
        const paid = cust === null ? -1 : Math.floor((approx * op.paidPct) / 100);
        const attempt = (paidAmount: number): number =>
          postSale(ctx, {
            customerId: cust, date: dateFor(w, op.dayOff), lines,
            discKind: op.discKind, discValue: op.discKind === 'pct' ? Math.min(op.discValue, 10_000) : op.discValue,
            paid: paidAmount, accountId: pick(w.accounts, op.dayOff + 2), priceTier: op.tier ?? undefined, approvedBy: op.approved ? w.managerId : null
          }).id;
        if (cust === null) {
          // Walk-in: must pay exactly the total, which we only know after pricing; ask the engine via a dry run in a rolled-back tx.
          const total = dryRunTotal(ctx, () => attempt(0));
          return attempt(total);
        }
        return attempt(Math.min(paid, approx));
      }, (id) => w.docs.sales.push(id));
      break;
    }
    case 'editSale': {
      if (w.docs.sales.length === 0) break;
      const id = pick(w.docs.sales, op.i);
      run(w, () => {
        const items = all<{ product_id: number; pack_id: number; qty: number; price: number; line_kind: 'normal' | 'bonus'; disc_kind: 'pct' | 'fixed' | null; disc_value: number }>(
          ctx.db, 'SELECT i.product_id, i.pack_id, i.qty, i.price, i.line_kind, i.disc_kind, i.disc_value FROM sale_items i JOIN sales s ON s.id = i.sale_id AND s.revision = i.revision WHERE s.id = ? ORDER BY i.line_no', id);
        const s = get<{ customer_id: number | null; total: number }>(ctx.db, 'SELECT customer_id, total FROM sales WHERE id = ?', id) as { customer_id: number | null; total: number };
        const lines = items.map((i, n) => ({ kind: i.line_kind, productId: i.product_id, packId: i.pack_id, qty: Math.max(1, i.qty + (n === 0 ? op.qtyDelta : 0)), price: i.price, discKind: i.disc_kind, discValue: i.disc_value }));
        const gross = lines.reduce((a, l) => a + (l.kind === 'bonus' ? 0 : l.qty * l.price), 0);
        const paid = s.customer_id === null ? -1 : Math.floor((gross * op.paidPct) / 100);
        const attempt = (p: number): number => editSale(ctx, id, { customerId: s.customer_id, lines, paid: p, approvedBy: op.approved ? w.managerId : null }, 'sim edit').id;
        if (s.customer_id === null) return attempt(dryRunTotal(ctx, () => attempt(0)));
        return attempt(Math.min(paid, gross));
      });
      break;
    }
    case 'saleReturn': {
      if (w.docs.sales.length === 0) break;
      const saleId = pick(w.docs.sales, op.i);
      run(w, () => {
        const items = all<{ id: number; base_qty: number }>(ctx.db, 'SELECT i.id, i.base_qty FROM sale_items i JOIN sales s ON s.id = i.sale_id AND s.revision = i.revision WHERE s.id = ? ORDER BY i.line_no', saleId);
        if (items.length === 0) return;
        const it = pick(items, op.item);
        return postSaleReturn(ctx, { saleId, date: dateFor(w, op.dayOff), items: [{ saleItemId: it.id, baseQty: Math.max(1, Math.min(op.qty, it.base_qty)) }], refundMode: op.mode, accountId: pick(w.accounts, op.dayOff) }).id;
      }, (id) => w.docs.saleReturns.push(id));
      break;
    }
    case 'purchaseReturn': {
      const sup = op.sup < 0 ? null : pick(w.suppliers, op.sup);
      run(w, () => {
        const p = pick(w.products, op.p);
        const avg = get<{ stock_qty: number; stock_value: number }>(ctx.db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', p) as { stock_qty: number; stock_value: number };
        const est = avg.stock_qty > 0 ? Math.floor((avg.stock_value * op.qty) / avg.stock_qty) : 0;
        const credit = Math.floor((est * op.creditPct) / 100);
        return postPurchaseReturn(ctx, { supplierId: sup, date: dateFor(w, op.dayOff), lines: [{ productId: p, baseQty: op.qty, credit }], refundMode: sup === null ? 'cash' : op.mode, accountId: pick(w.accounts, op.dayOff + 3) }).id;
      }, (id) => w.docs.purchaseReturns.push(id));
      break;
    }
    case 'void': {
      const reason = 'sim void';
      switch (op.what) {
        case 'sale': if (w.docs.sales.length) run(w, () => voidSale(ctx, pick(w.docs.sales, op.i), reason)); break;
        case 'purchase': if (w.docs.purchases.length) run(w, () => voidPurchase(ctx, pick(w.docs.purchases, op.i), reason)); break;
        case 'payment': if (w.docs.payments.length) run(w, () => voidPayment(ctx, pick(w.docs.payments, op.i), reason)); break;
        case 'expense': if (w.docs.expenses.length) run(w, () => voidExpense(ctx, pick(w.docs.expenses, op.i), reason)); break;
        case 'saleReturn': if (w.docs.saleReturns.length) run(w, () => voidSaleReturn(ctx, pick(w.docs.saleReturns, op.i), reason)); break;
        case 'purchaseReturn': if (w.docs.purchaseReturns.length) run(w, () => voidPurchaseReturn(ctx, pick(w.docs.purchaseReturns, op.i), reason)); break;
        case 'adjustment': if (w.docs.adjustments.length) run(w, () => voidStockAdjustment(ctx, pick(w.docs.adjustments, op.i), reason)); break;
        case 'salary': if (w.docs.sheets.length) run(w, () => voidSalarySheet(ctx, pick(w.docs.sheets, op.i), reason)); break;
      }
      break;
    }
    case 'receive':
      run(w, () => postPayment(ctx, { partyKind: 'customer', partyId: pick(w.customers, op.cust), amount: op.amount, date: dateFor(w, op.dayOff), accountId: pick(w.accounts, op.dayOff) }).id, (id) => w.docs.payments.push(id));
      break;
    case 'paySupplier':
      run(w, () => postPayment(ctx, { partyKind: 'supplier', partyId: pick(w.suppliers, op.sup), amount: op.amount, date: dateFor(w, op.dayOff), accountId: pick(w.accounts, op.dayOff + 1) }).id, (id) => w.docs.payments.push(id));
      break;
    case 'expense':
      run(w, () => postExpense(ctx, { categoryId: pick(w.categories, op.cat), amount: op.amount, date: dateFor(w, op.dayOff), accountId: pick(w.accounts, op.account) }).id, (id) => w.docs.expenses.push(id));
      break;
    case 'adjust':
      run(w, () => postStockAdjustment(ctx, {
        productId: pick(w.products, op.p), kind: op.kind, baseQty: op.qty, date: dateFor(w, op.dayOff), reason: 'sim',
        value: op.kind === 'opening' || op.kind === 'adjust_in' ? op.value : undefined, batch: { batchNo: 'ADJ', expiry: addDays(w.day, 90) }
      }).id, (id) => w.docs.adjustments.push(id));
      break;
    case 'salary':
      run(w, () => generateSalarySheet(ctx, { month: `2026-${String((op.month % 12) + 1).padStart(2, '0')}`, date: w.day, adjustments: [{ employeeId: pick(w.employees, 0), bonus: op.bonus, deduction: Math.min(op.deduction, 1_500_000) }] }).id, (id) => w.docs.sheets.push(id));
      break;
    case 'payEmployee':
      run(w, () => postPayment(ctx, { partyKind: 'employee', partyId: pick(w.employees, op.emp), amount: op.amount, date: w.day, purpose: op.advance ? 'advance' : 'salary', accountId: pick(w.accounts, 0) }).id, (id) => w.docs.payments.push(id));
      break;
    case 'ledgerAdjust':
      run(w, () => postPartyAdjustment(ctx, { partyKind: 'customer', partyId: pick(w.customers, op.cust), amount: op.amount === 0 ? 1 : op.amount, date: w.day, kind: 'adjustment', note: 'sim' }));
      break;
    case 'close': {
      run(w, () => {
        const cash = all<{ b: number }>(ctx.db, "SELECT COALESCE(SUM(amount),0) AS b FROM cash_transactions WHERE account_id IN (SELECT id FROM money_accounts WHERE kind = 'cash') AND business_date <= ?", w.day)[0]?.b ?? 0;
        closeDay(ctx, { date: w.day, actualCash: Math.max(0, cash + op.actualDelta) });
        w.day = addDays(w.day, 1); // a closed day is over: the shop carries on the next business day
      });
      break;
    }
    case 'reopen':
      run(w, () => {
        const last = get<{ d: string | null }>(ctx.db, "SELECT MAX(business_date) AS d FROM day_closings WHERE status = 'closed'");
        if (last?.d) {
          reopenDay(ctx, last.d, 'sim reopen');
          w.day = last.d; // trade on the reopened day again
        }
      });
      break;
    case 'nextDay':
      w.day = addDays(w.day, 1);
      break;
  }
}

/** Runs `fn` inside a transaction and always rolls it back, returning the total the engine computed. */
function dryRunTotal(ctx: Ctx, fn: () => number): number {
  const ROLLBACK = new Error('rollback');
  let total = 0;
  try {
    tx(ctx, () => {
      try {
        fn();
      } catch (e) {
        // OVER_PAYMENT / INVALID_INPUT carry the total in their params when the walk-in pays 0.
        if (isPetraError(e) && typeof e.params.total === 'number') total = e.params.total;
        else if (isPetraError(e) && e.code === 'INVALID_INPUT') total = -1;
        else throw e;
      }
      if (total === 0) {
        const row = get<{ total: number }>(ctx.db, 'SELECT total FROM sales ORDER BY id DESC LIMIT 1');
        total = row?.total ?? 0;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return Math.max(total, 0);
}

/** A reproducible mixed script (linear congruential generator), used by the integrity self-test and the perf seed. */
export function runSeededScenario(w: SimWorld, seed: number, operations: number): void {
  let state = seed >>> 0;
  const r = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const ri = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1));
  for (let n = 0; n < operations; n++) {
    const k = r();
    let op: Op;
    if (k < 0.2) op = { t: 'purchase', sup: ri(-1, 2), lines: [{ p: ri(0, 4), pack: ri(0, 2), qty: ri(1, 20), cost: ri(100, 60_000), batch: ri(0, 3), expiryDays: ri(-1, 300) }], discount: ri(0, 5000), paidPct: ri(0, 100), dayOff: 0 };
    else if (k < 0.5) op = { t: 'sale', cust: ri(-1, 3), lines: [{ p: ri(0, 4), pack: ri(0, 2), qty: ri(1, 8), priceMul: ri(80, 120), bonus: false, discKind: null, discValue: 0 }, { p: ri(0, 4), pack: 0, qty: ri(1, 3), priceMul: 100, bonus: r() < 0.3, discKind: r() < 0.5 ? 'pct' : null, discValue: ri(0, 1500) }], discKind: r() < 0.3 ? 'fixed' : null, discValue: ri(0, 3000), paidPct: ri(0, 100), tier: null, approved: true, dayOff: 0 };
    else if (k < 0.58) op = { t: 'saleReturn', i: ri(0, 40), item: ri(0, 1), qty: ri(1, 10), mode: r() < 0.5 ? 'due' : 'cash', dayOff: 0 };
    else if (k < 0.64) op = { t: 'void', what: (['sale', 'purchase', 'payment', 'expense', 'saleReturn'] as const)[ri(0, 4)] as 'sale', i: ri(0, 40) };
    else if (k < 0.72) op = { t: 'receive', cust: ri(0, 3), amount: ri(1, 200_000), dayOff: 0 };
    else if (k < 0.77) op = { t: 'expense', cat: 0, amount: ri(1, 5000), account: 0, dayOff: 0 };
    else if (k < 0.8) op = { t: 'editSale', i: ri(0, 40), qtyDelta: ri(-2, 3), paidPct: ri(0, 100), approved: true };
    else if (k < 0.83) op = { t: 'adjust', p: ri(0, 4), kind: (['opening', 'adjust_in', 'damage', 'expired', 'adjust_out'] as const)[ri(0, 4)] as 'opening', qty: ri(1, 10), value: ri(0, 200_000), dayOff: 0 };
    else if (k < 0.86) op = { t: 'close', actualDelta: ri(-100, 100) };
    else op = { t: 'nextDay' };
    applyOp(w, op);
  }
}
