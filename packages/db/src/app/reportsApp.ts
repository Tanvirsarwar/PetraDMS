import { formatBoxPcs, PetraError, STAFF_REPORTS, addDays, computeDueAging, type DashboardDto, type ReportCell, type ReportCol, type ReportParams, type ReportResult, type Role } from '@petra/core';
import { all, get, scalar } from '../sql';
import type { Ctx } from '../ctx';
import { partyLedger } from './catalog';
import { cashBook, dayHistory } from './moneyApp';
import { listExpenses } from './moneyApp';
import { stockMovements } from './inbound';
import { listPurchases } from './inbound';

const monthStartOf = (d: string) => `${d.slice(0, 7)}-01`;

// ===== One definition of profit for every report (plan 5.11) =====
export interface Period {
  invoices: number;
  salesTotal: number;
  tax: number;
  roundOff: number;
  paidAtSale: number;
  dueCreated: number;
  returnsCount: number;
  returnsNet: number;
  /** Invoice totals before tax. */
  sales: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  purchases: number;
  expenses: number;
  salary: number;
  stockLoss: number;
  netProfit: number;
  collected: number;
}

/**
 * Net sales = invoice totals before tax, minus returns (by the date of each document).
 * COGS includes bonus goods and is reduced by the cost of returned goods. Purchases are not an expense.
 * Salary is taken from posted salary sheets whose month touches the range. Stock loss is damage, expiry and own use.
 */
export function periodFigures(ctx: Ctx, from: string, to: string): Period {
  const s = get<{ n: number; total: number; tax: number; ro: number; paid: number; due: number; cogs: number }>(
    ctx.db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(round_off),0) AS ro, COALESCE(SUM(paid),0) AS paid, COALESCE(SUM(due),0) AS due,
            COALESCE(SUM((SELECT COALESCE(SUM(i.cogs),0) FROM sale_items i WHERE i.sale_id = s.id AND i.revision = s.revision)),0) AS cogs
       FROM sales s WHERE s.status = 'posted' AND s.business_date BETWEEN ? AND ?`, from, to
  )!;
  const r = get<{ n: number; net: number; cogs: number }>(
    ctx.db, "SELECT COUNT(*) AS n, COALESCE(SUM(net_amount),0) AS net, COALESCE(SUM(cogs_restored),0) AS cogs FROM sale_returns WHERE status = 'posted' AND business_date BETWEEN ? AND ?", from, to
  )!;
  const purchases = scalar(ctx.db, "SELECT COALESCE(SUM(total),0) FROM purchases WHERE status = 'posted' AND business_date BETWEEN ? AND ?", [from, to]);
  const expenses = scalar(ctx.db, "SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status = 'posted' AND business_date BETWEEN ? AND ?", [from, to]);
  const salary = scalar(ctx.db, "SELECT COALESCE(SUM(total),0) FROM salary_sheets WHERE status = 'posted' AND month BETWEEN ? AND ?", [from.slice(0, 7), to.slice(0, 7)]);
  const stockLoss = scalar(ctx.db, "SELECT COALESCE(SUM(value),0) FROM stock_adjustments WHERE status = 'posted' AND kind IN ('damage','expired','internal_use') AND business_date BETWEEN ? AND ?", [from, to]);
  const received = scalar(ctx.db, "SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'posted' AND direction = 'received' AND business_date BETWEEN ? AND ?", [from, to]);
  const sales = s.total - s.tax;
  const netSales = sales - r.net;
  const cogs = s.cogs - r.cogs;
  const grossProfit = netSales - cogs;
  return {
    invoices: s.n, salesTotal: s.total, tax: s.tax, roundOff: s.ro, paidAtSale: s.paid, dueCreated: s.due, returnsCount: r.n, returnsNet: r.net, sales, netSales, cogs, grossProfit,
    purchases, expenses, salary, stockLoss, netProfit: grossProfit - expenses - salary - stockLoss, collected: s.paid + received
  };
}

interface RC { ctx: Ctx; role: Role; today: string }

const col = (key: string, kind: ReportCol['kind'], labelKey = `rep.col.${key}`): ReportCol => ({ key, labelKey, kind });

/** "12 Box 5 pcs" for each product, in its biggest pack (v1.1: stock is read in boxes and pieces). */
function boxPcsOf(rc: RC): (productId: number, qty: number) => string {
  const big = new Map<number, { factor: number; name: string; unit: string }>();
  for (const r of all<{ product_id: number; factor: number; name: string; unit: string }>(rc.ctx.db, `SELECT k.product_id, k.factor, k.name, p.base_unit AS unit FROM product_packs k JOIN products p ON p.id = k.product_id
      WHERE k.factor = (SELECT MAX(factor) FROM product_packs x WHERE x.product_id = k.product_id)`)) big.set(r.product_id, { factor: r.factor, name: r.name, unit: r.unit });
  return (id, qty) => {
    const b = big.get(id);
    return formatBoxPcs(qty, b?.factor ?? 1, { boxName: b?.name ?? '', pcsName: b?.unit ?? '' }, { sep: ' ' });
  };
}
const sum = (rows: ReportCell[][], i: number): number => rows.reduce((a, r) => a + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0);

function result(id: ReportResult['id'], columns: ReportCol[], rows: ReportCell[][], totals: ReportCell[] | null = null, summary: ReportResult['summary'] = []): ReportResult {
  return { id, titleKey: `rep.title.${id}`, columns, rows, totals, summary };
}

function range(rc: RC, p: ReportParams): { from: string; to: string } {
  // Staff only ever see today (plan 13.1), whatever range they ask for.
  if (rc.role === 'staff') return { from: rc.today, to: rc.today };
  const to = p.to ?? rc.today;
  const from = p.from ?? monthStartOf(to);
  if (from > to) throw new PetraError('INVALID_INPUT', 'the start date is after the end date', { field: 'from' });
  return { from, to };
}

// ===== Sales =====
interface ProductAgg { id: number; sku: string; name: string; nameBn: string; qty: number; bonus: number; net: number; cogs: number }

/** Per product: lines of posted invoices minus returned lines, each by its own document date. */
export function productAgg(ctx: Ctx, from: string, to: string): ProductAgg[] {
  const sold = all<{ id: number; sku: string; name: string; name_bn: string; qty: number; bonus: number; net: number; cogs: number }>(
    ctx.db,
    `SELECT p.id, p.sku, p.name, p.name_bn,
            COALESCE(SUM(CASE WHEN i.line_kind = 'normal' THEN i.base_qty ELSE 0 END),0) AS qty,
            COALESCE(SUM(CASE WHEN i.line_kind = 'bonus' THEN i.base_qty ELSE 0 END),0) AS bonus,
            COALESCE(SUM(i.amount - i.alloc_discount),0) AS net, COALESCE(SUM(i.cogs),0) AS cogs
       FROM sale_items i JOIN sales s ON s.id = i.sale_id AND i.revision = s.revision JOIN products p ON p.id = i.product_id
      WHERE s.status = 'posted' AND s.business_date BETWEEN ? AND ? GROUP BY p.id`, from, to
  );
  const back = new Map(all<{ id: number; qty: number; net: number; cogs: number }>(
    ctx.db,
    `SELECT ri.product_id AS id, SUM(ri.base_qty) AS qty, SUM(ri.net_amount) AS net, SUM(ri.cogs) AS cogs
       FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id WHERE r.status = 'posted' AND r.business_date BETWEEN ? AND ? GROUP BY ri.product_id`, from, to
  ).map((r) => [r.id, r]));
  const out = new Map<number, ProductAgg>(sold.map((s) => [s.id, { id: s.id, sku: s.sku, name: s.name, nameBn: s.name_bn, qty: s.qty, bonus: s.bonus, net: s.net, cogs: s.cogs }]));
  for (const [id, b] of back) {
    let row = out.get(id);
    if (!row) {
      const p = get<{ sku: string; name: string; name_bn: string }>(ctx.db, 'SELECT sku, name, name_bn FROM products WHERE id = ?', id)!;
      row = { id, sku: p.sku, name: p.name, nameBn: p.name_bn, qty: 0, bonus: 0, net: 0, cogs: 0 };
      out.set(id, row);
    }
    row.qty -= b.qty;
    row.net -= b.net;
    row.cogs -= b.cogs;
  }
  return [...out.values()];
}

function salesByProduct(rc: RC, p: ReportParams, id: 'sales' | 'profitProduct'): ReportResult {
  const { from, to } = range(rc, p);
  const cost = rc.role !== 'staff';
  const rows = productAgg(rc.ctx, from, to);
  const profit = id === 'profitProduct';
  rows.sort((a, b) => (profit ? b.net - b.cogs - (a.net - a.cogs) : a.name.localeCompare(b.name)));
  const roundOff = scalar(rc.ctx.db, "SELECT COALESCE(SUM(round_off),0) FROM sales WHERE status = 'posted' AND business_date BETWEEN ? AND ?", [from, to]);
  const cols: ReportCol[] = [col('sku', 'text'), col('product', 'text'), col('qty', 'qty'), col('bonus', 'qty'), col('net', 'money')];
  if (cost) cols.push(col('cogs', 'money'), col('profit', 'money'));
  if (profit) cols.push(col('margin', 'pct'));
  const cells: ReportCell[][] = rows.map((r) => {
    const row: ReportCell[] = [r.sku, r.name, r.qty, r.bonus, r.net];
    if (cost) row.push(r.cogs, r.net - r.cogs);
    if (profit) row.push(r.net === 0 ? 0 : Math.round(((r.net - r.cogs) * 10000) / r.net));
    return row;
  });
  if (roundOff !== 0) {
    const row: ReportCell[] = ['', '@rep.rounding', null, null, roundOff];
    if (cost) row.push(0, roundOff);
    if (profit) row.push(null);
    cells.push(row);
  }
  const net = sum(cells, 4);
  const totals: ReportCell[] = ['', '', null, null, net];
  if (cost) totals.push(sum(cells, 5), sum(cells, 6));
  if (profit) totals.push(net === 0 ? 0 : Math.round((sum(cells, 6) * 10000) / net));
  return result(id, cols, cells, totals);
}

type GroupBy = 'customer' | 'area' | 'date';
function salesByGroup(rc: RC, p: ReportParams, by: GroupBy, id: 'sales' | 'profitCustomer'): ReportResult {
  const { from, to } = range(rc, p);
  const cost = rc.role !== 'staff';
  const sKey = by === 'date' ? 's.business_date' : by === 'customer' ? 'COALESCE(s.customer_id,0)' : 'COALESCE(c.area_id,0)';
  const rKey = by === 'date' ? 'r.business_date' : sKey;
  const label = by === 'date' ? 's.business_date' : by === 'customer' ? "COALESCE(c.name,'')" : "COALESCE(a.name,'')";
  const joins = 'LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN areas a ON a.id = c.area_id';
  const sold = all<{ k: string | number; label: string; n: number; sales: number; cogs: number }>(
    ctx_(rc),
    `SELECT ${sKey} AS k, ${label} AS label, COUNT(*) AS n, SUM(s.total - s.tax) AS sales,
            SUM((SELECT COALESCE(SUM(i.cogs),0) FROM sale_items i WHERE i.sale_id = s.id AND i.revision = s.revision)) AS cogs
       FROM sales s ${joins} WHERE s.status = 'posted' AND s.business_date BETWEEN ? AND ? GROUP BY k`, from, to
  );
  const back = all<{ k: string | number; label: string; net: number; cogs: number }>(
    ctx_(rc),
    `SELECT ${rKey} AS k, ${by === 'date' ? 'r.business_date' : label} AS label, SUM(r.net_amount) AS net, SUM(r.cogs_restored) AS cogs
       FROM sale_returns r JOIN sales s ON s.id = r.sale_id ${joins} WHERE r.status = 'posted' AND r.business_date BETWEEN ? AND ? GROUP BY k`, from, to
  );
  interface G { label: string; n: number; sales: number; ret: number; cogs: number }
  const groups = new Map<string | number, G>();
  const named = (k: string | number, l: string): string => (by === 'date' ? String(k) : k === 0 ? (by === 'customer' ? '@rep.walkIn' : '@rep.noArea') : l);
  for (const s of sold) groups.set(s.k, { label: named(s.k, s.label), n: s.n, sales: s.sales, ret: 0, cogs: s.cogs });
  for (const b of back) {
    const g = groups.get(b.k) ?? { label: named(b.k, b.label), n: 0, sales: 0, ret: 0, cogs: 0 };
    g.ret += b.net;
    g.cogs -= b.cogs;
    groups.set(b.k, g);
  }
  const list = [...groups.entries()].map(([k, g]) => ({ k, ...g }));
  const profit = id === 'profitCustomer';
  if (by === 'date') list.sort((a, b) => String(a.k).localeCompare(String(b.k)));
  else list.sort((a, b) => (profit ? b.sales - b.ret - b.cogs - (a.sales - a.ret - a.cogs) : b.sales - b.ret - (a.sales - a.ret)));
  const cols: ReportCol[] = [col(by === 'date' ? 'date' : by, by === 'date' ? 'date' : 'text'), col('invoices', 'int'), col('sales', 'money'), col('returns', 'money'), col('net', 'money')];
  if (cost) cols.push(col('cogs', 'money'), col('profit', 'money'));
  if (profit) cols.push(col('margin', 'pct'));
  const cells: ReportCell[][] = list.map((g) => {
    const net = g.sales - g.ret;
    const row: ReportCell[] = [g.label, g.n, g.sales, g.ret, net];
    if (cost) row.push(g.cogs, net - g.cogs);
    if (profit) row.push(net === 0 ? 0 : Math.round(((net - g.cogs) * 10000) / net));
    return row;
  });
  const net = sum(cells, 4);
  const totals: ReportCell[] = ['', sum(cells, 1), sum(cells, 2), sum(cells, 3), net];
  if (cost) totals.push(sum(cells, 5), sum(cells, 6));
  if (profit) totals.push(net === 0 ? 0 : Math.round((sum(cells, 6) * 10000) / net));
  return result(id, cols, cells, totals);
}

const ctx_ = (rc: RC) => rc.ctx.db;

// ===== Summary =====
function summaryReport(rc: RC, p: ReportParams): ReportResult {
  const { from, to } = range(rc, p);
  const f = periodFigures(rc.ctx, from, to);
  const cost = rc.role !== 'staff';
  const rows: ReportCell[][] = [['@rep.row.sales', f.sales], ['@rep.row.returns', -f.returnsNet], ['@rep.row.netSales', f.netSales]];
  if (cost) rows.push(['@rep.row.cogs', f.cogs], ['@rep.row.grossProfit', f.grossProfit], ['@rep.row.expenses', f.expenses], ['@rep.row.salary', f.salary], ['@rep.row.stockLoss', f.stockLoss], ['@rep.row.netProfit', f.netProfit]);
  const summary: ReportResult['summary'] = [
    { labelKey: 'rep.row.invoices', value: f.invoices, kind: 'int' },
    { labelKey: 'rep.row.collected', value: f.collected, kind: 'money' },
    { labelKey: 'rep.row.dueCreated', value: f.dueCreated, kind: 'money' }
  ];
  if (cost) summary.push({ labelKey: 'rep.row.purchases', value: f.purchases, kind: 'money' });
  return result('summary', [col('item', 'key'), col('amount', 'money')], rows, null, summary);
}

// ===== Dues =====
function agingReport(rc: RC, p: ReportParams): ReportResult {
  const asOf = p.asOf ?? rc.today;
  const people = all<{ id: number; name: string; phone: string; area: string | null }>(
    rc.ctx.db,
    `SELECT c.id, c.name, c.phone, a.name AS area FROM customers c LEFT JOIN areas a ON a.id = c.area_id WHERE (? IS NULL OR c.area_id = ?) AND c.balance <> 0 ORDER BY c.name COLLATE NOCASE`,
    p.areaId ?? null, p.areaId ?? null
  );
  const rows: ReportCell[][] = [];
  for (const c of people) {
    const led = all<{ id: number; business_date: string; amount: number }>(rc.ctx.db, "SELECT id, business_date, amount FROM party_ledger WHERE party_kind = 'customer' AND party_id = ? AND business_date <= ? ORDER BY id", c.id, asOf);
    const debits = led.filter((l) => l.amount > 0).map((l) => ({ ref: String(l.id).padStart(10, '0'), date: l.business_date, amount: l.amount }));
    const credits = -led.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0);
    const a = computeDueAging(debits, credits, asOf);
    if (a.total > 0) rows.push([c.name, c.area ?? '', c.phone, a.buckets['0-30'], a.buckets['31-60'], a.buckets['61-90'], a.buckets['90+'], a.total]);
  }
  rows.sort((x, y) => (y[7] as number) - (x[7] as number));
  const totals: ReportCell[] = ['', '', '', sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), sum(rows, 7)];
  return result('aging', [col('customer', 'text'), col('area', 'text'), col('phone', 'text'), col('b0', 'money'), col('b31', 'money'), col('b61', 'money'), col('b90', 'money'), col('totalDue', 'money')], rows, totals, [{ labelKey: 'rep.asOf', value: asOf, kind: 'date' }]);
}

function collectionReport(rc: RC, p: ReportParams): ReportResult {
  const rows = all<{ area: string | null; name: string; phone: string; address: string; last: string | null; balance: number }>(
    rc.ctx.db,
    `SELECT a.name AS area, c.name, c.phone, c.address, c.balance,
            (SELECT MAX(pm.business_date) FROM payments pm WHERE pm.party_kind = 'customer' AND pm.party_id = c.id AND pm.status = 'posted') AS last
       FROM customers c LEFT JOIN areas a ON a.id = c.area_id
      WHERE c.balance > 0 AND c.status = 'active' AND (? IS NULL OR c.area_id = ?)
      ORDER BY (a.name IS NULL), a.name COLLATE NOCASE, c.balance DESC`, p.areaId ?? null, p.areaId ?? null
  ).map((r): ReportCell[] => [r.area ?? '@rep.noArea', r.name, r.phone, r.address, r.last, r.balance]);
  return result('collection', [col('area', 'text'), col('customer', 'text'), col('phone', 'text'), col('address', 'text'), col('lastPayment', 'date'), col('due', 'money')], rows, ['', '', '', '', null, sum(rows, 5)]);
}

function supplierDueReport(rc: RC): ReportResult {
  const rows = all<{ name: string; phone: string; last: string | null; balance: number }>(
    rc.ctx.db,
    `SELECT s.name, s.phone, s.balance, (SELECT MAX(pm.business_date) FROM payments pm WHERE pm.party_kind = 'supplier' AND pm.party_id = s.id AND pm.status = 'posted') AS last
       FROM suppliers s WHERE s.balance > 0 ORDER BY s.balance DESC`
  ).map((r): ReportCell[] => [r.name, r.phone, r.last, r.balance]);
  return result('supplierDue', [col('supplier', 'text'), col('phone', 'text'), col('lastPayment', 'date'), col('weOwe', 'money')], rows, ['', '', null, sum(rows, 3)]);
}

function statementReport(rc: RC, p: ReportParams): ReportResult {
  const kind = p.customerId ? 'customer' : p.supplierId ? 'supplier' : null;
  if (!kind) throw new PetraError('INVALID_INPUT', 'choose a customer or supplier', { field: 'customerId' });
  if (kind === 'supplier' && rc.role === 'staff') throw new PetraError('PERMISSION', 'manager role required');
  const view = partyLedger(rc.ctx, kind, (p.customerId ?? p.supplierId) as number, p.from, p.to);
  const rows: ReportCell[][] = view.rows.map((r) => [r.date, `@ledger.kind.${r.kind}`, r.refNo, r.amount > 0 ? r.amount : null, r.amount < 0 ? -r.amount : null, r.balanceAfter]);
  return result('statement', [col('date', 'date'), col('type', 'key'), col('ref', 'text'), col('billed', 'money'), col('credited', 'money'), col('balance', 'money')], rows, ['', '', '', sum(rows, 3), sum(rows, 4), view.party.balance], [{ labelKey: kind === 'customer' ? 'rep.col.customer' : 'rep.col.supplier', value: view.party.name, kind: 'text' }]);
}

function purchasesReport(rc: RC, p: ReportParams): ReportResult {
  const { from, to } = range(rc, p);
  const rows = listPurchases(rc.ctx, { from, to, ...(p.supplierId ? { supplierId: p.supplierId } : {}) }).filter((x) => x.status === 'posted').reverse()
    .map((x): ReportCell[] => [x.date, x.docNo, x.supplierName || '@rep.noSupplier', x.total, x.paid, x.due]);
  return result('purchases', [col('date', 'date'), col('docNo', 'text'), col('supplier', 'text'), col('total', 'money'), col('paid', 'money'), col('due', 'money')], rows, ['', '', '', sum(rows, 3), sum(rows, 4), sum(rows, 5)]);
}

// ===== Stock =====
function stockValueReport(rc: RC, p: ReportParams): ReportResult {
  const bp = boxPcsOf(rc);
  const rows = all<{ id: number; sku: string; name: string; cat: string | null; qty: number; value: number; retail: number }>(
    rc.ctx.db,
    `SELECT p.id, p.sku, p.name, c.name AS cat, p.stock_qty AS qty, p.stock_value AS value, p.stock_qty * p.price_retail AS retail
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE (p.stock_qty <> 0 OR p.stock_value <> 0) AND (? IS NULL OR p.category_id = ?) ORDER BY p.stock_value DESC, p.name COLLATE NOCASE`, p.categoryId ?? null, p.categoryId ?? null
  ).map((r): ReportCell[] => [r.sku, r.name, r.cat ?? '', bp(r.id, r.qty), r.qty, r.qty === 0 ? 0 : Math.round(r.value / r.qty), r.value, r.retail]);
  return result('stockValue', [col('sku', 'text'), col('product', 'text'), col('category', 'text'), col('boxPcs', 'stock'), col('qty', 'qty'), col('avgCost', 'money'), col('value', 'money'), col('retailValue', 'money')], rows, ['', '', '', '', null, null, sum(rows, 6), sum(rows, 7)]);
}

function lowStockReport(rc: RC): ReportResult {
  const bp = boxPcsOf(rc);
  const rows = all<{ id: number; sku: string; name: string; qty: number; level: number }>(
    rc.ctx.db, "SELECT id, sku, name, stock_qty AS qty, reorder_level AS level FROM products WHERE status = 'active' AND reorder_level > 0 AND stock_qty <= reorder_level ORDER BY (stock_qty * 1.0 / reorder_level), name COLLATE NOCASE"
  ).map((r): ReportCell[] => [r.sku, r.name, bp(r.id, r.qty), r.qty, bp(r.id, r.level), r.level, Math.max(0, r.level - r.qty)]);
  return result('lowStock', [col('sku', 'text'), col('product', 'text'), col('boxPcs', 'stock'), col('qty', 'qty'), col('reorderBoxPcs', 'stock'), col('reorderLevel', 'qty'), col('short', 'qty')], rows);
}

function expiringReport(rc: RC, p: ReportParams): ReportResult {
  const soon = p.soonDays ?? 60;
  const cost = rc.role !== 'staff';
  const limit = addDays(rc.today, soon);
  const bp = boxPcsOf(rc);
  const rows = all<{ id: number; sku: string; name: string; batch: string; expiry: string; qty: number; avg: number }>(
    rc.ctx.db,
    `SELECT p.id, p.sku, p.name, b.batch_no AS batch, b.expiry_date AS expiry, b.qty_remaining AS qty, CASE WHEN p.stock_qty > 0 THEN p.stock_value * 1.0 / p.stock_qty ELSE 0 END AS avg
       FROM stock_batches b JOIN products p ON p.id = b.product_id WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ? ORDER BY b.expiry_date, p.name COLLATE NOCASE`, limit
  ).map((r) => {
    const days = Math.round((Date.UTC(+r.expiry.slice(0, 4), +r.expiry.slice(5, 7) - 1, +r.expiry.slice(8, 10)) - Date.UTC(+rc.today.slice(0, 4), +rc.today.slice(5, 7) - 1, +rc.today.slice(8, 10))) / 86_400_000);
    const row: ReportCell[] = [r.sku, r.name, r.batch, r.expiry, days, bp(r.id, r.qty), r.qty];
    if (cost) row.push(Math.round(r.qty * r.avg));
    return row;
  });
  const cols = [col('sku', 'text'), col('product', 'text'), col('batch', 'text'), col('expiry', 'date'), col('daysLeft', 'days'), col('boxPcs', 'stock'), col('qty', 'qty')];
  if (cost) cols.push(col('value', 'money'));
  return result('expiring', cols, rows, cost ? ['', '', '', null, null, '', null, sum(rows, 7)] : null, [{ labelKey: 'rep.within', value: soon, kind: 'days' }]);
}

function stockLedgerReport(rc: RC, p: ReportParams): ReportResult {
  if (!p.productId) throw new PetraError('INVALID_INPUT', 'choose a product', { field: 'productId' });
  const { from, to } = range(rc, p);
  const rows = stockMovements(rc.ctx, rc.role, { productId: p.productId, from, to, limit: 5000 }).reverse().map((m): ReportCell[] => [m.date, `@mv.${m.kind}`, m.refNo, m.baseQty > 0 ? m.baseQty : null, m.baseQty < 0 ? -m.baseQty : null, m.balanceQty, m.value]);
  return result('stockLedger', [col('date', 'date'), col('type', 'key'), col('ref', 'text'), col('in', 'qty'), col('out', 'qty'), col('balance', 'qty'), col('value', 'money')], rows, ['', '', '', sum(rows, 3), sum(rows, 4), null, null]);
}

// ===== Money =====
function cashbookReport(rc: RC, p: ReportParams): ReportResult {
  const { from, to } = range(rc, p);
  const b = cashBook(rc.ctx, { from, to, ...(p.accountId ? { accountId: p.accountId } : {}) });
  const rows = b.rows.map((r): ReportCell[] => [r.date, `@cash.source.${r.source}`, r.accountName, r.refNo, r.amount > 0 ? r.amount : null, r.amount < 0 ? -r.amount : null, r.balanceAfter]);
  return result('cashbook', [col('date', 'date'), col('type', 'key'), col('account', 'text'), col('ref', 'text'), col('in', 'money'), col('out', 'money'), col('balance', 'money')], rows, ['', '', '', '', b.totalIn, b.totalOut, b.closing], [{ labelKey: 'cash.opening', value: b.opening, kind: 'money' }]);
}

function daycloseReport(rc: RC, p: ReportParams): ReportResult {
  const { from, to } = range(rc, p);
  const rows = dayHistory(rc.ctx, 366).filter((d) => d.date >= from && d.date <= to).reverse().map((d): ReportCell[] => [d.date, d.opening, d.collections, d.expenses, d.expected, d.actual, d.difference, d.closedBy]);
  return result('dayclose', [col('date', 'date'), col('opening', 'money'), col('collections', 'money'), col('expenses', 'money'), col('expected', 'money'), col('counted', 'money'), col('difference', 'money'), col('closedBy', 'text')], rows, ['', null, sum(rows, 2), sum(rows, 3), null, null, sum(rows, 6), '']);
}

function expensesReport(rc: RC, p: ReportParams): ReportResult {
  const { from, to } = range(rc, p);
  const list = listExpenses(rc.ctx, { from, to, ...(p.categoryId ? { categoryId: p.categoryId } : {}), ...(p.accountId ? { accountId: p.accountId } : {}), includeVoid: false });
  const rows = list.rows.slice().reverse().map((e): ReportCell[] => [e.date, e.docNo, e.categoryName, e.payee, e.accountName, e.amount]);
  return result('expenses', [col('date', 'date'), col('docNo', 'text'), col('category', 'text'), col('payee', 'text'), col('account', 'text'), col('amount', 'money')], rows, ['', '', '', '', '', list.total]);
}

function salaryReport(rc: RC, p: ReportParams): ReportResult {
  const { from, to } = range(rc, p);
  const rows = all<{ month: string; name: string; base: number; bonus: number; deduction: number; net: number }>(
    rc.ctx.db,
    `SELECT s.month, e.name, l.base, l.bonus, l.deduction, l.net FROM salary_lines l JOIN salary_sheets s ON s.id = l.sheet_id JOIN employees e ON e.id = l.employee_id
      WHERE s.status = 'posted' AND s.month BETWEEN ? AND ? ORDER BY s.month, e.name COLLATE NOCASE`, from.slice(0, 7), to.slice(0, 7)
  ).map((r): ReportCell[] => [r.month, r.name, r.base, r.bonus, r.deduction, r.net]);
  return result('salary', [col('month', 'text'), col('employee', 'text'), col('base', 'money'), col('bonusPay', 'money'), col('deduction', 'money'), col('net', 'money')], rows, ['', '', sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5)]);
}

export function runReport(ctx: Ctx, role: Role, today: string, p: ReportParams): ReportResult {
  if (role === 'staff' && !STAFF_REPORTS.includes(p.id)) throw new PetraError('PERMISSION', 'manager role required');
  const rc: RC = { ctx, role, today };
  switch (p.id) {
    case 'summary': return summaryReport(rc, p);
    case 'sales': {
      const by = p.groupBy ?? 'date';
      return by === 'product' ? salesByProduct(rc, p, 'sales') : salesByGroup(rc, p, by, 'sales');
    }
    case 'profitProduct': return salesByProduct(rc, p, 'profitProduct');
    case 'profitCustomer': return salesByGroup(rc, p, 'customer', 'profitCustomer');
    case 'purchases': return purchasesReport(rc, p);
    case 'aging': return agingReport(rc, p);
    case 'collection': return collectionReport(rc, p);
    case 'statement': return statementReport(rc, p);
    case 'supplierDue': return supplierDueReport(rc);
    case 'stockValue': return stockValueReport(rc, p);
    case 'lowStock': return lowStockReport(rc);
    case 'expiring': return expiringReport(rc, p);
    case 'stockLedger': return stockLedgerReport(rc, p);
    case 'cashbook': return cashbookReport(rc, p);
    case 'dayclose': return daycloseReport(rc, p);
    case 'expenses': return expensesReport(rc, p);
    case 'salary': return salaryReport(rc, p);
  }
}

// ===== Dashboard =====
export function dashboard(ctx: Ctx, today: string): DashboardDto {
  const t = periodFigures(ctx, today, today);
  const mStart = monthStartOf(today);
  const m = periodFigures(ctx, mStart, today);
  const trendFrom = addDays(today, -13);
  const daily = new Map(all<{ d: string; v: number }>(
    ctx.db, "SELECT business_date AS d, SUM(total - tax) AS v FROM sales WHERE status = 'posted' AND business_date BETWEEN ? AND ? GROUP BY business_date", trendFrom, today
  ).map((r) => [r.d, r.v]));
  const returns = new Map(all<{ d: string; v: number }>(
    ctx.db, "SELECT business_date AS d, SUM(net_amount) AS v FROM sale_returns WHERE status = 'posted' AND business_date BETWEEN ? AND ? GROUP BY business_date", trendFrom, today
  ).map((r) => [r.d, r.v]));
  const trend = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(trendFrom, i);
    return { date, sales: (daily.get(date) ?? 0) - (returns.get(date) ?? 0) };
  });
  const top = productAgg(ctx, mStart, today).sort((a, b) => b.net - a.net).slice(0, 5).filter((r) => r.net > 0).map((r) => ({ productId: r.id, name: r.name, nameBn: r.nameBn, net: r.net }));
  const recent = all<{ id: number; doc_no: string; cname: string | null; total: number; due: number; status: 'posted' | 'void' }>(
    ctx.db, 'SELECT s.id, s.doc_no, c.name AS cname, s.total, s.due, s.status FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id DESC LIMIT 6'
  ).map((r) => ({ id: r.id, docNo: r.doc_no, customer: r.cname ?? '', total: r.total, due: r.due, status: r.status }));
  const topDue = all<{ id: number; name: string; balance: number }>(ctx.db, "SELECT id, name, balance FROM customers WHERE balance > 0 AND status = 'active' ORDER BY balance DESC LIMIT 5").map((r) => ({ customerId: r.id, name: r.name, due: r.balance }));
  const last = scalar<string | null>(ctx.db, "SELECT MAX(business_date) FROM day_closings WHERE status = 'closed'", [], null);
  const expiry = all<{ qty: number; expiry: string }>(ctx.db, 'SELECT qty_remaining AS qty, expiry_date AS expiry FROM stock_batches WHERE qty_remaining > 0 AND expiry_date IS NOT NULL AND expiry_date <= ?', addDays(today, 30));
  return {
    date: today,
    today: { invoices: t.invoices, sales: t.netSales, returns: t.returnsNet, collected: t.collected, due: t.dueCreated, profit: t.grossProfit },
    month: { sales: m.netSales, profit: m.grossProfit, expenses: m.expenses, salary: m.salary, stockLoss: m.stockLoss, netProfit: m.netProfit, purchases: m.purchases },
    receivables: scalar(ctx.db, 'SELECT COALESCE(SUM(balance),0) FROM customers WHERE balance > 0'),
    payables: scalar(ctx.db, 'SELECT COALESCE(SUM(balance),0) FROM suppliers WHERE balance > 0'),
    stockValue: scalar(ctx.db, 'SELECT COALESCE(SUM(stock_value),0) FROM products'),
    cash: scalar(ctx.db, "SELECT COALESCE(SUM(balance),0) FROM money_accounts WHERE kind = 'cash' AND active = 1"),
    accountsTotal: scalar(ctx.db, 'SELECT COALESCE(SUM(balance),0) FROM money_accounts WHERE active = 1'),
    lowStock: scalar(ctx.db, "SELECT COUNT(*) FROM products WHERE status = 'active' AND reorder_level > 0 AND stock_qty <= reorder_level"),
    expiring: expiry.filter((e) => e.expiry >= today).length,
    expired: expiry.filter((e) => e.expiry < today).length,
    unclosedDays: scalar(ctx.db, "SELECT COUNT(DISTINCT business_date) FROM cash_transactions WHERE business_date < ? AND business_date > COALESCE(?, '') AND source != 'opening'", [today, last]),
    lastClosed: last,
    trend, topProducts: top, recent, topDue
  };
}
