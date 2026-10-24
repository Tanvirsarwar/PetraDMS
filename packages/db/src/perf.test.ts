import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPORT_IDS, type ReportParams } from '@petra/core';
import { PERF_FULL, bulkMovements, seedPerf } from './perfSeed';
import { postSale } from './sales';
import { postPurchase } from './purchases';
import { linkProducts } from './supplierProducts';
import { all } from './sql';
import { expectIntegrity, makeApp, ok, setupWithUsers, type App } from './testApp';

/**
 * The performance targets of plan section 14, on the plan's own dataset: 10,000 products, 5,000 customers, a quarter of
 * sales, and a million stock movements. The database is a real file in WAL mode with synchronous=FULL, as in production.
 * Targets are checked on the 95th percentile so one slow disk flush cannot fail a run, and the numbers are printed.
 */
const END = '2026-10-01';
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const ms = (n: number) => `${n.toFixed(1)} ms`;

let app: App | undefined;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-perf-'));
afterAll(() => {
  try { app?.close(); } catch { /* closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('performance targets (plan section 14)', () => {
  let products: number[] = [];
  let customers: number[] = [];

  it('builds the 10,000 product, 5,000 customer dataset', async () => {
    app = makeApp(undefined, { dataDir: dir });
    await setupWithUsers(app.d);
    const t0 = performance.now();
    const made = seedPerf(app.d.ctx(), { ...PERF_FULL, endDate: END });
    products = made.products;
    customers = made.customers;
    console.log(`perf seed: ${products.length} products, ${customers.length} customers in ${Math.round(performance.now() - t0)} ms`);
    expect(products.length).toBe(10_000);
    expect(customers.length).toBe(5_000);
    expectIntegrity(app);
  }, 600_000);

  it('search: keystroke to results is under 50 ms (p95)', async () => {
    const d = app!.d;
    await ok(d, 'search:query', { q: 'marks', limit: 20 }); // first query builds the index
    const queries = ['m', 'ma', 'mar', 'mark', 'marks', 'marks milk', 'tea 400', 'rahim', 'karim sto', 'ricee', 'SKU-01234', '8900000000', 'inv-0000', 'দুধ', 'মার্কস', 'ilk powder', '01711'];
    const times: number[] = [];
    for (let round = 0; round < 6; round++) for (const q of queries) {
      const t = performance.now();
      await ok(d, 'search:query', { q, limit: 20 });
      times.push(performance.now() - t);
    }
    console.log(`search p95 ${ms(p95(times))}`);
    expect(p95(times)).toBeLessThan(50);
  });

  it('save sale: under 150 ms (p95), with an invoice of several lines on a shop this size', () => {
    const ctx = app!.d.ctx();
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const lines = Array.from({ length: 1 + (i % 6) }, (_, k) => ({ productId: products[(i * 37 + k * 101) % products.length] as number, qty: 1 + ((i + k) % 4) }));
      const t = performance.now();
      postSale(ctx, { customerId: customers[i % customers.length] as number, date: END, lines, paid: 1000, approvedBy: ctx.userId });
      times.push(performance.now() - t);
    }
    console.log(`save sale p95 ${ms(p95(times))}, max ${ms(Math.max(...times))}`);
    expect(p95(times)).toBeLessThan(150);
  });

  it('save a 60-line company purchase (box + pcs, free goods, discounts, freight): under 300 ms (p95)', () => {
    const ctx = app!.d.ctx();
    const supplier = all<{ id: number }>(ctx.db, 'SELECT id FROM suppliers ORDER BY id LIMIT 1')[0]!.id;
    const packs = all<{ product_id: number; id: number; factor: number }>(ctx.db, 'SELECT product_id, id, factor FROM product_packs WHERE factor > 1');
    const boxOf = new Map(packs.map((k) => [k.product_id, k]));
    // a company with 500 linked products, as in the bulk grid target
    linkProducts(ctx, supplier, products.slice(0, 500));
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const lines = Array.from({ length: 60 }, (_, k) => {
        const productId = products[(i * 61 + k * 7) % 500] as number;
        const box = boxOf.get(productId);
        return { productId, packId: box?.id ?? null, qty: 1 + ((i + k) % 9), looseQty: box ? (k % 3) : 0, unitCost: 50_000 + k * 101, kind: k % 15 === 14 ? ('free' as const) : ('normal' as const), discKind: k % 4 === 0 ? ('pct' as const) : null, discValue: k % 4 === 0 ? 150 : 0 };
      });
      const t = performance.now();
      postPurchase(ctx, { supplierId: supplier, supplierRef: `PERF-${i}`, date: END, lines, discKind: 'pct', discValue: 50, freight: 12_345, tax: 999, paid: 0 });
      times.push(performance.now() - t);
    }
    console.log(`save 60-line purchase p95 ${ms(p95(times))}, max ${ms(Math.max(...times))}`);
    expect(p95(times)).toBeLessThan(300);
    expectIntegrity(app!);
  }, 600_000);

  it('product list and dashboard open in under a second on this shop', async () => {
    const d = app!.d;
    let t = performance.now();
    const list = await ok(d, 'catalog:products', { includeArchived: false });
    const listMs = performance.now() - t;
    t = performance.now();
    await ok(d, 'dash:get');
    const dashMs = performance.now() - t;
    console.log(`product list (${list.length}) ${ms(listMs)}, dashboard ${ms(dashMs)}`);
    expect(list.length).toBe(10_000);
    expect(listMs).toBeLessThan(1000);
    expect(dashMs).toBeLessThan(1000);
  });

  it('every report over one million stock movements runs in under 2 s', async () => {
    const d = app!.d;
    const t0 = performance.now();
    bulkMovements(d.ctx(), 1_000_000, END, 90);
    console.log(`1,000,000 synthetic movements added in ${Math.round(performance.now() - t0)} ms`);
    const range = { from: '2026-07-01', to: END, asOf: END };
    const cases: ReportParams[] = REPORT_IDS.map((id) => ({ id, ...range }));
    cases.push({ id: 'sales', groupBy: 'product', ...range }, { id: 'sales', groupBy: 'customer', ...range }, { id: 'sales', groupBy: 'date', ...range });
    const slow: string[] = [];
    for (const c of cases) {
      const params: ReportParams = c.id === 'stockLedger' ? { ...c, productId: products[5] as number } : c.id === 'statement' ? { ...c, customerId: customers[3] as number } : c;
      const t = performance.now();
      const r = await d.call('report:run', params);
      const took = performance.now() - t;
      console.log(`report ${c.id}${c.groupBy ? `/${c.groupBy}` : ''}: ${ms(took)}${r.ok ? ` (${(r.data as { rows: unknown[] }).rows.length} rows)` : ` (${r.error.code})`}`);
      if (took >= 2000) slow.push(`${c.id}:${Math.round(took)}`);
      if (!r.ok && !['INVALID_INPUT', 'NOT_FOUND'].includes(r.error.code)) throw new Error(`${c.id} failed: ${r.error.code}`);
    }
    expect(slow).toEqual([]);
    const t = performance.now();
    const list = await ok(d, 'catalog:products', { includeArchived: false });
    console.log(`product list with 1M movements: ${ms(performance.now() - t)}`);
    expect(list.length).toBe(10_000);
    expect(performance.now() - t).toBeLessThan(2000);
  }, 900_000);
});
