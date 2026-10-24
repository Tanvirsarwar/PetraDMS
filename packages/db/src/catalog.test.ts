import { describe, expect, it } from 'vitest';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs } from './testApp';
import type { Dispatcher } from './app/dispatcher';
import type { ProductDto } from '@petra/core';

const DATE = '2026-10-01';

async function newProduct(d: Dispatcher, over: Partial<Parameters<typeof productInput>[0]> = {}) {
  const r = await ok(d, 'catalog:productSave', productInput(over));
  const list = await ok(d, 'catalog:products', { includeArchived: true });
  return list.find((p) => p.id === r.id) as ProductDto;
}

function productInput(over: { sku?: string; name?: string; trackExpiry?: boolean; id?: number; packs?: { id?: number; name: string; factor: number }[] } = {}) {
  return {
    sku: over.sku ?? 'MARKS-500',
    name: over.name ?? 'Marks Full Cream Milk Powder 500g',
    nameBn: 'মার্কস মিল্ক পাউডার ৫০০গ্রাম',
    categoryId: null,
    brandId: null,
    baseUnit: 'pcs',
    trackExpiry: over.trackExpiry ?? false,
    priceRetail: 52000,
    priceWholesale: 50000,
    priceDealer: 48500,
    minPrice: 47000,
    reorderLevel: 24,
    favourite: false,
    notes: '',
    packs: over.packs ?? [{ name: 'Carton', factor: 24 }],
    barcodes: [],
    ...(over.id ? { id: over.id } : {})
  };
}

describe('catalog and inbound services', () => {
  it('creates a product with base pack plus carton, rejects duplicate SKU, hides cost from staff, blocks staff edits', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    const p = await newProduct(app.d);
    expect(p.packs.map((x) => [x.name, x.factor])).toEqual([['pcs', 1], ['Carton', 24]]);
    expect(p.priceRetail).toBe(52000);
    expect(await fail(app.d, 'catalog:productSave', productInput())).toBe('DUPLICATE');

    await signInAs(app.d, u.manager, 'manager');
    const supplier = await ok(app.d, 'catalog:supplierSave', { name: 'Marks Distribution', nameBn: '', phone: '', address: '', notes: '' });
    await ok(app.d, 'purchase:save', { supplierId: supplier.id, supplierRef: 'B-1', date: DATE, lines: [{ productId: p.id, packId: p.packs[1]!.id, qty: 2, unitCost: 1_080_000 }], discount: 0, paid: 0, accountId: null, note: '' });
    const asManager = (await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!;
    expect(asManager.stockQty).toBe(48);
    expect(asManager.avgCost).toBe(45000);
    expect(asManager.stockValue).toBe(2_160_000);

    await signInAs(app.d, u.staff, 'staff');
    const asStaff = (await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!;
    expect(asStaff.stockQty).toBe(48);
    expect(asStaff.avgCost).toBeNull();
    expect(asStaff.stockValue).toBeNull();
    expect(asStaff.lastCost).toBeNull();
    expect(await fail(app.d, 'catalog:productSave', productInput({ sku: 'X1' }))).toBe('PERMISSION');
    expect(await fail(app.d, 'purchase:list', {})).toBe('PERMISSION');
    expect(await fail(app.d, 'stock:movements', { productId: p.id, limit: 10 })).toBe('PERMISSION');
    expectIntegrity(app);
    app.close();
  });

  it('purchase: weighted average cost, supplier due, part payment, ledger and void restore everything', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    await signInAs(app.d, u.manager, 'manager');
    const p = await newProduct(app.d);
    const s = await ok(app.d, 'catalog:supplierSave', { name: 'Supplier A', nameBn: '', phone: '', address: '', notes: '', openingBalance: 500_000, openingDate: DATE });
    const carton = p.packs[1]!.id;
    const r1 = await ok(app.d, 'purchase:save', { supplierId: s.id, supplierRef: '', date: DATE, lines: [{ productId: p.id, packId: carton, qty: 1, unitCost: 1_200_000 }], discount: 0, paid: 700_000, accountId: null, note: '' });
    expect(r1.total).toBe(1_200_000);
    expect(r1.due).toBe(500_000);
    const r2 = await ok(app.d, 'purchase:save', { supplierId: s.id, supplierRef: '', date: DATE, lines: [{ productId: p.id, packId: null, qty: 24, unitCost: 55000 }], discount: 20_000, paid: 0, accountId: null, note: '' });
    let prod = (await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!;
    expect(prod.stockQty).toBe(48);
    // (1,200,000 + 24*55,000 - 20,000) / 48 = 50,000 exactly
    expect(prod.stockValue).toBe(1_200_000 + 1_320_000 - 20_000);
    expect(prod.avgCost).toBe(52083);
    const suppliers = await ok(app.d, 'catalog:suppliers', { includeArchived: false });
    expect(suppliers[0]!.balance).toBe(500_000 + 500_000 + 1_300_000);
    const ledger = await ok(app.d, 'party:ledger', { kind: 'supplier', id: s.id });
    expect(ledger.rows.at(-1)!.balanceAfter).toBe(suppliers[0]!.balance);
    expect(ledger.rows.some((x) => x.refNo === r1.docNo)).toBe(true);

    await ok(app.d, 'payment:save', { partyKind: 'supplier', partyId: s.id, amount: 1_000_000, date: DATE, accountId: null, reference: 'cheque 7', note: '' });
    expect((await ok(app.d, 'catalog:suppliers', { includeArchived: false }))[0]!.balance).toBe(1_300_000);

    await ok(app.d, 'purchase:void', { id: r2.id, reason: 'wrong supplier' });
    prod = (await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!;
    expect(prod.stockQty).toBe(24);
    expect(prod.stockValue).toBe(1_200_000);
    expect(await fail(app.d, 'purchase:void', { id: r2.id, reason: 'again' })).toBe('ALREADY_VOID');
    const detail = await ok(app.d, 'purchase:get', { id: r1.id });
    expect(detail.items[0]).toMatchObject({ qty: 1, baseQty: 24, packName: 'Carton', factor: 24 });
    const list = await ok(app.d, 'purchase:list', { search: 'pur-' });
    expect(list.map((x) => x.status).sort()).toEqual(['posted', 'void']);
    expectIntegrity(app);
    app.close();
  });

  it('expiry products: batches, FEFO, alerts, and the expiry switch is locked once stock exists', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    await signInAs(app.d, u.manager, 'manager');
    const p = await newProduct(app.d, { sku: 'YOG-1', name: 'Yoghurt cup', trackExpiry: true, packs: [] });
    await ok(app.d, 'purchase:save', {
      supplierId: null, supplierRef: '', date: DATE,
      lines: [
        { productId: p.id, packId: null, qty: 10, unitCost: 3000, batchNo: 'B-LATE', expiry: '2026-12-31' },
        { productId: p.id, packId: null, qty: 10, unitCost: 3000, batchNo: 'B-SOON', expiry: '2026-10-20' },
        { productId: p.id, packId: null, qty: 5, unitCost: 3000, batchNo: 'B-OLD', expiry: '2026-09-25' }
      ],
      discount: 0, paid: 75_000, accountId: null, note: ''
    });
    const batches = await ok(app.d, 'stock:batches', {});
    expect(batches.map((b) => [b.batchNo, b.state])).toEqual([['B-OLD', 'expired'], ['B-SOON', 'soon'], ['B-LATE', 'ok']]);
    const alerts = await ok(app.d, 'stock:alerts', { soonDays: 30 });
    expect(alerts.expired.map((b) => b.batchNo)).toEqual(['B-OLD']);
    expect(alerts.expiring.map((b) => b.batchNo)).toEqual(['B-SOON']);

    // write off the expired batch, then FEFO takes the soonest-expiring batch first
    const old = batches.find((b) => b.batchNo === 'B-OLD')!;
    await ok(app.d, 'stock:adjust', { productId: p.id, kind: 'expired', baseQty: 5, date: DATE, reason: 'expired', batchId: old.id });
    await ok(app.d, 'stock:adjust', { productId: p.id, kind: 'damage', baseQty: 4, date: DATE, reason: 'dropped crate' });
    const after = await ok(app.d, 'stock:batches', {});
    expect(after.map((b) => [b.batchNo, b.qty])).toEqual([['B-SOON', 6], ['B-LATE', 10]]);

    expect(await fail(app.d, 'catalog:productSave', productInput({ id: p.id, sku: 'YOG-1', name: 'Yoghurt cup', trackExpiry: false, packs: [] }))).toBe('INVALID_INPUT');
    const adj = await ok(app.d, 'stock:adjustments', {});
    expect(adj.map((a) => a.kind).sort()).toEqual(['damage', 'expired']);
    expect(await fail(app.d, 'stock:adjust', { productId: p.id, kind: 'damage', baseQty: 1, date: DATE, reason: '' })).toBe('REASON_REQUIRED');
    await ok(app.d, 'stock:adjustVoid', { id: adj.find((a) => a.kind === 'damage')!.id, reason: 'counted wrong' });
    expect((await ok(app.d, "catalog:products", { includeArchived: false }))[0]!.stockQty).toBe(20);
    expectIntegrity(app);
    app.close();
  });

  it('opening stock, running movement balance, purchase return and archive', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    await signInAs(app.d, u.manager, 'manager');
    const p = await newProduct(app.d, { packs: [] });
    await ok(app.d, 'stock:adjust', { productId: p.id, kind: 'opening', baseQty: 100, date: DATE, reason: '', value: 4_000_000 });
    const s = await ok(app.d, 'catalog:supplierSave', { name: 'Supplier B', nameBn: '', phone: '', address: '', notes: '' });
    const pur = await ok(app.d, 'purchase:save', { supplierId: s.id, supplierRef: '', date: DATE, lines: [{ productId: p.id, packId: null, qty: 50, unitCost: 41000 }], discount: 0, paid: 0, accountId: null, note: '' });
    const ret = await ok(app.d, 'purchase:return', { supplierId: s.id, purchaseId: pur.id, date: DATE, lines: [{ productId: p.id, baseQty: 10, credit: 400_000 }], refundMode: 'due', accountId: null, reason: 'damaged cartons' });
    expect(ret.credit).toBe(400_000);
    expect((await ok(app.d, 'catalog:suppliers', { includeArchived: false }))[0]!.balance).toBe(2_050_000 - 400_000);
    const moves = await ok(app.d, 'stock:movements', { productId: p.id, limit: 50 });
    expect(moves[0]!.balanceQty).toBe(140);
    expect(moves.at(-1)!.kind).toBe('opening');
    const prod = (await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!;
    expect(prod.stockQty).toBe(moves[0]!.balanceQty);
    await ok(app.d, 'purchase:returnVoid', { id: ret.id, reason: 'supplier refused' });
    expect((await ok(app.d, 'catalog:suppliers', { includeArchived: false }))[0]!.balance).toBe(2_050_000);
    await ok(app.d, 'catalog:productArchive', { id: p.id, archived: true });
    expect(await ok(app.d, 'catalog:products', { includeArchived: false })).toHaveLength(0);
    expect(await fail(app.d, 'purchase:save', { supplierId: s.id, supplierRef: '', date: DATE, lines: [{ productId: p.id, packId: null, qty: 1, unitCost: 1 }], discount: 0, paid: 0, accountId: null, note: '' })).toBe('INVALID_INPUT');
    expectIntegrity(app);
    app.close();
  });

  it('pack editing: sizes can be swapped; a pack used on a document cannot be removed', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    await signInAs(app.d, u.manager, 'manager');
    const p = await newProduct(app.d, { packs: [{ name: 'Dozen', factor: 12 }, { name: 'Carton', factor: 24 }] });
    const [, dozen, carton] = p.packs;
    await ok(app.d, 'catalog:productSave', productInput({ id: p.id, packs: [{ id: dozen!.id, name: 'Dozen', factor: 24 }, { id: carton!.id, name: 'Carton', factor: 12 }] }));
    const swapped = (await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!;
    expect(swapped.packs.map((x) => [x.name, x.factor])).toEqual([['pcs', 1], ['Carton', 12], ['Dozen', 24]]);
    await ok(app.d, 'purchase:save', { supplierId: null, supplierRef: '', date: DATE, lines: [{ productId: p.id, packId: dozen!.id, qty: 1, unitCost: 1000 }], discount: 0, paid: 1000, accountId: null, note: '' });
    expect(await fail(app.d, 'catalog:productSave', productInput({ id: p.id, packs: [{ id: carton!.id, name: 'Carton', factor: 12 }] }))).toBe('IN_USE');
    expect(await fail(app.d, 'catalog:productSave', productInput({ id: p.id, packs: [{ name: 'Same', factor: 12 }, { name: 'Other', factor: 12 }] }))).toBe('DUPLICATE');
    expectIntegrity(app);
    app.close();
  });

  it('categories and brands: create, rename, archive; duplicate names are rejected', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    await signInAs(app.d, u.manager, 'manager');
    const c = await ok(app.d, 'catalog:lookupSave', { kind: 'category', name: 'Milk powder', nameBn: 'গুঁড়া দুধ' });
    expect(await fail(app.d, 'catalog:lookupSave', { kind: 'category', name: 'Milk powder', nameBn: '' })).toBe('DUPLICATE');
    await ok(app.d, 'catalog:lookupSave', { kind: 'category', id: c.id, name: 'Milk powders', nameBn: 'গুঁড়া দুধ', archived: false });
    const b = await ok(app.d, 'catalog:lookupSave', { kind: 'brand', name: 'Marks', nameBn: 'মার্কস' });
    const lookups = await ok(app.d, 'catalog:lookups');
    expect(lookups.categories[0]!.name).toBe('Milk powders');
    expect(lookups.brands[0]!.id).toBe(b.id);
    const p = await ok(app.d, 'catalog:productSave', { ...productInput(), categoryId: c.id, brandId: b.id });
    const row = (await ok(app.d, 'catalog:products', { includeArchived: false })).find((x) => x.id === p.id)!;
    expect([row.categoryName, row.brandName]).toEqual(['Milk powders', 'Marks']);
    app.close();
  });
});
