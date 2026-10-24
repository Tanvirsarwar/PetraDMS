import { afterEach, describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { reportParams, type ReportParams, type ReportResult } from '@petra/core';
import { createTestWorld, type TestWorld } from './testkit';
import { buildSimWorld, runSeededScenario, type SimWorld } from './sim';
import { all, scalar } from './sql';
import { crc32, makeZip, reportCsv, reportXlsx, safeText } from './app/exportFiles';
import { dashboard, periodFigures, runReport } from './app/reportsApp';
import { checkIntegrity, formatViolations } from './integrity';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs, type App } from './testApp';

let world: TestWorld | undefined;
let app: App | undefined;
afterEach(() => {
  world?.close();
  app?.close();
  world = undefined;
  app = undefined;
});

const ALL = { from: '2000-01-01', to: '2099-12-31' };

function build(seed: number, ops = 450): { w: SimWorld; today: string; ctx: TestWorld['ctx'] } {
  world = createTestWorld();
  const w = buildSimWorld(world.ctx, world.managerId);
  runSeededScenario(w, seed, ops);
  return { w, today: w.day, ctx: world.ctx };
}

const run = (ctx: TestWorld['ctx'], today: string, p: Partial<ReportParams> & { id: ReportParams['id'] }, role: 'owner' | 'staff' = 'owner'): ReportResult => runReport(ctx, role, today, reportParams.parse(p));
const total = (r: ReportResult, key: string): number => {
  const i = r.columns.findIndex((c) => c.key === key);
  if (i < 0 || !r.totals) throw new Error(`no total for ${key}`);
  return r.totals[i] as number;
};

/** Everything below is recomputed from raw rows with plain loops, a different path from the report SQL. */
function oracle(ctx: TestWorld['ctx']) {
  const sales = all<{ id: number; total: number; tax: number; due: number }>(ctx.db, "SELECT id, total, tax, due FROM sales WHERE status = 'posted'");
  const returns = all<{ net_amount: number }>(ctx.db, "SELECT net_amount FROM sale_returns WHERE status = 'posted'");
  const netSales = sales.reduce((a, s) => a + s.total - s.tax, 0) - returns.reduce((a, r) => a + r.net_amount, 0);
  const moves = all<{ id: number; kind: string; value: number; reverses_id: number | null }>(ctx.db, 'SELECT id, kind, value, reverses_id FROM stock_movements');
  const kindOf = new Map(moves.map((m) => [m.id, m.kind]));
  const isCogs = (k: string | undefined) => k === 'sale' || k === 'bonus' || k === 'sales_return';
  const cogs = -moves.filter((m) => isCogs(m.kind) || (m.kind === 'void_reversal' && m.reverses_id !== null && isCogs(kindOf.get(m.reverses_id)))).reduce((a, m) => a + m.value, 0);
  const loss = -moves.filter((m) => ['damage', 'expired', 'internal_use'].includes(m.kind) || (m.kind === 'void_reversal' && m.reverses_id !== null && ['damage', 'expired', 'internal_use'].includes(kindOf.get(m.reverses_id) ?? ''))).reduce((a, m) => a + m.value, 0);
  const expenses = all<{ amount: number }>(ctx.db, "SELECT amount FROM expenses WHERE status = 'posted'").reduce((a, e) => a + e.amount, 0);
  const salary = all<{ total: number }>(ctx.db, "SELECT total FROM salary_sheets WHERE status = 'posted'").reduce((a, e) => a + e.total, 0);
  const purchases = all<{ total: number }>(ctx.db, "SELECT total FROM purchases WHERE status = 'posted'").reduce((a, e) => a + e.total, 0);
  const owed = all<{ balance: number }>(ctx.db, 'SELECT balance FROM customers').reduce((a, c) => a + Math.max(0, c.balance), 0);
  const owedActive = all<{ balance: number }>(ctx.db, "SELECT balance FROM customers WHERE status = 'active'").reduce((a, c) => a + Math.max(0, c.balance), 0);
  const weOwe = all<{ balance: number }>(ctx.db, 'SELECT balance FROM suppliers').reduce((a, c) => a + Math.max(0, c.balance), 0);
  const stock = moves.reduce((a, m) => a + m.value, 0);
  const cash = all<{ amount: number }>(ctx.db, 'SELECT amount FROM cash_transactions').reduce((a, c) => a + c.amount, 0);
  return { netSales, cogs, loss, expenses, salary, purchases, owed, owedActive, weOwe, stock, cash, invoices: sales.length };
}

describe('every report total equals an independent oracle (Phase 8)', () => {
  for (const seed of [11, 2026, 90210]) {
    it(`seed ${seed}: summary, sales, profit, dues, stock, money reports`, () => {
      const { ctx, today } = build(seed);
      const o = oracle(ctx);
      expect(o.invoices).toBeGreaterThan(10);
      expect(o.netSales).toBeGreaterThan(0);
      expect(o.cogs).toBeGreaterThan(0);
      expect(o.owed).toBeGreaterThan(0);
      expect(o.expenses).toBeGreaterThan(0);

      // profit definitions (plan 5.11)
      const f = periodFigures(ctx, ALL.from, ALL.to);
      expect(f.netSales).toBe(o.netSales);
      expect(f.cogs).toBe(o.cogs);
      expect(f.grossProfit).toBe(o.netSales - o.cogs);
      expect(f.stockLoss).toBe(o.loss);
      expect(f.expenses).toBe(o.expenses);
      expect(f.salary).toBe(o.salary);
      expect(f.purchases).toBe(o.purchases);
      expect(f.netProfit).toBe(o.netSales - o.cogs - o.expenses - o.salary - o.loss);

      const summary = run(ctx, today, { id: 'summary', ...ALL });
      const row = (k: string) => summary.rows.find((r) => r[0] === `@rep.row.${k}`)?.[1];
      expect(row('netSales')).toBe(o.netSales);
      expect(row('cogs')).toBe(o.cogs);
      expect(row('netProfit')).toBe(o.netSales - o.cogs - o.expenses - o.salary - o.loss);
      expect(summary.summary.find((s) => s.labelKey === 'rep.row.invoices')?.value).toBe(o.invoices);

      // every sales view ties to the same net sales and profit
      for (const groupBy of ['date', 'customer', 'area', 'product'] as const) {
        const r = run(ctx, today, { id: 'sales', groupBy, ...ALL });
        expect(total(r, 'net'), `sales by ${groupBy}`).toBe(o.netSales);
        expect(total(r, 'profit'), `profit by ${groupBy}`).toBe(o.netSales - o.cogs);
      }
      expect(total(run(ctx, today, { id: 'profitProduct', ...ALL }), 'profit')).toBe(o.netSales - o.cogs);
      expect(total(run(ctx, today, { id: 'profitCustomer', ...ALL }), 'profit')).toBe(o.netSales - o.cogs);

      // money and dues
      expect(total(run(ctx, today, { id: 'expenses', ...ALL }), 'amount')).toBe(o.expenses);
      expect(total(run(ctx, today, { id: 'salary', ...ALL }), 'net')).toBe(o.salary);
      expect(total(run(ctx, today, { id: 'purchases', ...ALL }), 'total')).toBe(o.purchases);
      expect(total(run(ctx, today, { id: 'aging', asOf: today }), 'totalDue')).toBe(o.owed);
      expect(total(run(ctx, today, { id: 'collection' }), 'due')).toBe(o.owedActive);
      expect(total(run(ctx, today, { id: 'supplierDue' }), 'weOwe')).toBe(o.weOwe);
      expect(total(run(ctx, today, { id: 'stockValue' }), 'value')).toBe(o.stock);
      const book = run(ctx, today, { id: 'cashbook', ...ALL });
      expect(total(book, 'in') - total(book, 'out')).toBe(o.cash);
      expect(book.totals?.[book.columns.findIndex((c) => c.key === 'balance')]).toBe(o.cash);

      // aging buckets add up and never show more than the customer owes
      const aging = run(ctx, today, { id: 'aging', asOf: today });
      for (const r of aging.rows) expect((r[3] as number) + (r[4] as number) + (r[5] as number) + (r[6] as number)).toBe(r[7]);
      expect(formatViolations(checkIntegrity(ctx.db))).toBe('');
    });
  }

  it('date ranges: a month slice plus the rest equals the whole', () => {
    const { ctx, today } = build(77, 500);
    const dates = all<{ d: string }>(ctx.db, "SELECT DISTINCT business_date AS d FROM sales WHERE status = 'posted' ORDER BY d").map((r) => r.d);
    expect(dates.length).toBeGreaterThan(3);
    const mid = dates[Math.floor(dates.length / 2)] as string;
    const next = all<{ d: string }>(ctx.db, "SELECT date(?, '+1 day') AS d", mid)[0]?.d as string;
    const a = periodFigures(ctx, ALL.from, mid);
    const b = periodFigures(ctx, next, ALL.to);
    const w = periodFigures(ctx, ALL.from, ALL.to);
    expect(a.netSales + b.netSales).toBe(w.netSales);
    expect(a.cogs + b.cogs).toBe(w.cogs);
    expect(a.invoices + b.invoices).toBe(w.invoices);
    const byDate = run(ctx, today, { id: 'sales', groupBy: 'date', from: ALL.from, to: mid });
    expect(total(byDate, 'net')).toBe(a.netSales);
  });

  it('dashboard figures match the reports', () => {
    const { ctx, today } = build(5150, 400);
    const d = dashboard(ctx, today);
    const t = periodFigures(ctx, today, today);
    const mStart = `${today.slice(0, 7)}-01`;
    const m = periodFigures(ctx, mStart, today);
    expect(d.today.sales).toBe(t.netSales);
    expect(d.today.profit).toBe(t.grossProfit);
    expect(d.month.sales).toBe(m.netSales);
    expect(d.month.netProfit).toBe(m.netProfit);
    expect(d.receivables).toBe(oracle(ctx).owed);
    expect(d.payables).toBe(oracle(ctx).weOwe);
    expect(d.stockValue).toBe(oracle(ctx).stock);
    expect(d.cash).toBe(scalar(ctx.db, "SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE account_id IN (SELECT id FROM money_accounts WHERE kind = 'cash')"));
    expect(d.trend).toHaveLength(14);
    expect(d.trend[13]?.date).toBe(today);
    expect(d.trend[13]?.sales).toBe(t.netSales);
    expect(d.topProducts.length).toBeLessThanOrEqual(5);
    expect(d.recent.length).toBeLessThanOrEqual(6);
  });
});

describe('report access and exports', () => {
  it('staff: only safe reports, never cost or profit, only today', async () => {
    app = makeApp();
    const users = await setupWithUsers(app.d);
    await signInAs(app.d, users.staff, 'staff');
    for (const id of ['profitProduct', 'profitCustomer', 'stockValue', 'supplierDue', 'cashbook', 'expenses', 'salary', 'purchases', 'dayclose', 'stockLedger'] as const) {
      expect(await fail(app.d, 'report:run', { id }), id).toBe('PERMISSION');
    }
    const s = await ok(app.d, 'report:run', { id: 'summary', from: '2000-01-01', to: '2099-01-01' });
    expect(s.rows.map((r) => r[0])).toEqual(['@rep.row.sales', '@rep.row.returns', '@rep.row.netSales']);
    const sales = await ok(app.d, 'report:run', { id: 'sales', groupBy: 'product' });
    expect(sales.columns.map((c) => c.key)).not.toContain('cogs');
    expect(sales.columns.map((c) => c.key)).not.toContain('profit');
    const ex = await ok(app.d, 'report:run', { id: 'expiring' });
    expect(ex.columns.map((c) => c.key)).not.toContain('value');
    expect(await fail(app.d, 'report:run', { id: 'statement', supplierId: 1 })).toBe('PERMISSION');
    expect(await fail(app.d, 'dash:get')).toBe('PERMISSION');
    expect(await fail(app.d, 'report:export', { params: { id: 'summary' }, format: 'csv', title: 'x', headers: ['a'], dict: {} })).toBe('PERMISSION');
    await signInAs(app.d, users.owner, 'owner');
    await expectIntegrity(app);
  });

  it('CSV: BOM, CRLF, quoting, taka decimals, formula guard, translated key cells', () => {
    const r: ReportResult = {
      id: 'summary', titleKey: 't',
      columns: [{ key: 'a', labelKey: 'a', kind: 'text' }, { key: 'b', labelKey: 'b', kind: 'money' }, { key: 'c', labelKey: 'c', kind: 'date' }, { key: 'd', labelKey: 'd', kind: 'key' }, { key: 'e', labelKey: 'e', kind: 'pct' }],
      rows: [['=HYPERLINK("x")', 123456, '2026-10-07', 'rep.row.sales', 1250], ['A, "B"', -5, null, '@rep.row.cogs', 0]],
      totals: ['', 123451, null, null, null], summary: []
    };
    const csv = reportCsv(r, ['Name', 'Amount', 'Date', 'Type', 'Margin'], { 'rep.row.sales': 'বিক্রি', 'rep.row.cogs': 'COGS' });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Name,Amount,Date,Type,Margin');
    expect(lines[1]).toBe("'=HYPERLINK(\"\"x\"\")\",1234.56,2026-10-07,বিক্রি,12.50".replace("'=HYPERLINK", '"\'=HYPERLINK'));
    expect(lines[2]).toBe('"A, ""B""",-0.05,,COGS,0.00');
    expect(lines[3]).toBe(',1234.51,,,');
    expect(safeText('-1')).toBe("'-1");
    expect(safeText('Karim')).toBe('Karim');
  });

  it('ZIP and XLSX are valid packages: CRC, names, content, numeric money, escaped text', () => {
    const r: ReportResult = {
      id: 'sales', titleKey: 't',
      columns: [{ key: 'a', labelKey: 'a', kind: 'text' }, { key: 'b', labelKey: 'b', kind: 'money' }, { key: 'c', labelKey: 'c', kind: 'date' }],
      rows: [['A & <B>', 250075, '2026-10-07']], totals: ['', 250075, null], summary: []
    };
    const xlsx = reportXlsx(r, 'Sales: October', ['Name', 'Amount', 'Date'], {});
    const entries = readZip(xlsx);
    expect([...entries.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = entries.get('xl/worksheets/sheet1.xml') as string;
    expect(sheet).toContain('A &amp; &lt;B&gt;');
    expect(sheet).toContain('<v>2500.75</v>'); // poisha become taka
    expect(sheet).toContain('<v>46302</v>'); // 2026-10-07 as an Excel date serial
    expect(entries.get('xl/workbook.xml')).toContain('name="Sales  October"'); // ":" is not allowed in a sheet name
    const z = makeZip([{ name: 'a.txt', data: 'বাংলা' }, { name: 'b/c.csv', data: new Uint8Array([1, 2, 3]) }]);
    const back = readZip(z);
    expect(back.get('a.txt')).toBe('বাংলা');
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

/** Reads our own ZIP output back through the central directory, checking every CRC. */
function readZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(local + 26);
    const data = inflateRawSync(buf.subarray(local + 30 + lnlen, local + 30 + lnlen + csize));
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString('utf8'));
    p += 46 + nlen;
  }
  return out;
}
