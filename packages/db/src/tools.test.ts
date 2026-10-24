import { afterEach, describe, expect, it } from 'vitest';
import { PERF_FULL, seedPerf } from './perfSeed';
import { code128Svg } from './app/labels';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs, type App } from './testApp';

let app: App;
afterEach(() => app?.close());

describe('search, compact and labels (Phase 9 services)', () => {
  it('searches live data, rebuilds after a write, hides money documents from staff', async () => {
    app = makeApp();
    const users = await setupWithUsers(app.d);
    const sup = await ok(app.d, 'catalog:supplierSave', { name: 'Marks Ltd' });
    const milk = await ok(app.d, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk 500g', nameBn: 'মার্কস দুধ', baseUnit: 'pcs', priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, barcodes: ['8901111111111'] });
    const cust = await ok(app.d, 'customer:save', { name: 'Karim Store', phone: '01711111111', type: 'wholesale', creditLimit: 0, openingBalance: 0 });
    const today = (await ok(app.d, 'app:status')).businessDate;
    await ok(app.d, 'purchase:save', { supplierId: sup.id, date: today, lines: [{ productId: milk.id, qty: 10, unitCost: 40000 }], paid: 400000 });
    const sale = await ok(app.d, 'sale:save', { customerId: cust.id, date: today, lines: [{ productId: milk.id, qty: 1, price: 52000 }], paid: 52000 });

    let r = await ok(app.d, 'search:query', { q: 'marks', limit: 10 });
    expect(r.hits.map((h) => h.kind).sort()).toEqual(['product', 'purchase', 'supplier']);
    expect((await ok(app.d, 'search:query', { q: '8901111111111', limit: 5 })).hits[0]).toMatchObject({ kind: 'product', id: milk.id });
    expect((await ok(app.d, 'search:query', { q: sale.docNo, limit: 5 })).hits[0]).toMatchObject({ kind: 'sale', id: sale.id });

    // a write is visible to the very next query
    await ok(app.d, 'customer:save', { name: 'Zahir Mart', type: 'retail', creditLimit: 0, openingBalance: 0 });
    r = await ok(app.d, 'search:query', { q: 'zahir', limit: 5 });
    expect(r.hits[0]?.title).toBe('Zahir Mart');

    await signInAs(app.d, users.staff, 'staff');
    r = await ok(app.d, 'search:query', { q: 'marks', limit: 10 });
    expect(r.hits.map((h) => h.kind)).toEqual(['product']);
    expect((await ok(app.d, 'search:query', { q: sale.docNo, limit: 5 })).hits).toHaveLength(0);
    expect(await fail(app.d, 'search:query', { q: 'x'.repeat(101), limit: 5 })).toBe('INVALID_INPUT');
  });

  it('compact figures: staff get no cash; compact toggle reaches the host', async () => {
    app = makeApp();
    const users = await setupWithUsers(app.d);
    const f = await ok(app.d, 'compact:figures');
    expect(f.cash).toBe(0);
    await ok(app.d, 'window:compact', { on: true });
    await ok(app.d, 'window:compact', { on: false });
    expect(app.compact).toEqual([true, false]);
    await signInAs(app.d, users.staff, 'staff');
    expect((await ok(app.d, 'compact:figures')).cash).toBeNull();
  });

  it('prints a barcode label sheet from real products', async () => {
    app = makeApp();
    await setupWithUsers(app.d);
    const p = await ok(app.d, 'catalog:productSave', { sku: 'TEA', name: 'Sylon Tea 400g', nameBn: 'চা', baseUnit: 'pcs', priceRetail: 45000, priceWholesale: 42000, priceDealer: 40000 });
    await ok(app.d, 'print:run', { doc: { type: 'labels', items: [{ productId: p.id, copies: 6 }] }, action: 'print' });
    const html = app.printed.at(-1)!;
    expect((html.match(/class="lb"/g) ?? []).length).toBe(6);
    expect(html).toContain('Sylon Tea 400g');
    expect(html).toContain('<svg');
    expect(html).toContain('TEA');
    expect(await fail(app.d, 'print:run', { doc: { type: 'labels', items: [{ productId: 9999, copies: 1 }] }, action: 'print' })).toBe('NOT_FOUND');
    const b = code128Svg('ABC-123', 40);
    expect(b.modules).toBeGreaterThan(40);
    expect(b.svg).toContain('<path');
  });

  it('speed: a warm query over a shop of 3,000 products, 5,000 customers and 3,000+ sales stays under 50 ms', async () => {
    app = makeApp();
    await setupWithUsers(app.d);
    const ctx = app.d.ctx();
    const t0 = performance.now();
    seedPerf(ctx, { ...PERF_FULL, sales: 3000, days: 60, endDate: '2026-10-01' });
    const seedMs = performance.now() - t0;
    const first = await ok(app.d, 'search:query', { q: 'marks', limit: 20 });
    expect(first.size).toBeGreaterThan(8000);
    const queries = ['marks milk', 'tea 400', 'rahim', 'karim sto', 'ricee', 'SKU-01234', '8900000000', 'inv-0000', 'দুধ', 'মার্কস', 'ilk powder', '01711'];
    const times: number[] = [];
    for (let round = 0; round < 5; round++) for (const q of queries) {
      const t = performance.now();
      const r = await ok(app.d, 'search:query', { q, limit: 20 });
      times.push(performance.now() - t);
      expect(r.hits.length).toBeLessThanOrEqual(20);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(`search perf: ${first.size} records, seed ${Math.round(seedMs)} ms, p95 ${p95.toFixed(1)} ms, max ${times.at(-1)!.toFixed(1)} ms`);
    expect(p95).toBeLessThan(50);
    expectIntegrity(app);
  }, 240_000);
});
