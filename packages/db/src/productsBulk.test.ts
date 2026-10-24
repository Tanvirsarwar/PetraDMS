import { describe, expect, it } from 'vitest';
import { makeCtx } from './ctx';
import { all, scalar } from './sql';
import { archiveProducts, deleteProducts } from './productsBulk';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs, type App } from './testApp';

const DATE = '2026-10-01';

function productInput(sku: string, over: { barcodes?: string[]; packs?: { name: string; factor: number; barcode?: string }[]; defaultSaleFactor?: number } = {}) {
  return {
    sku,
    name: `Product ${sku}`,
    nameBn: '',
    categoryId: null,
    brandId: null,
    baseUnit: 'pcs',
    trackExpiry: false,
    priceRetail: 5000,
    priceWholesale: 4800,
    priceDealer: 4600,
    minPrice: 4000,
    reorderLevel: 0,
    favourite: false,
    notes: '',
    packs: over.packs ?? [],
    barcodes: over.barcodes ?? [],
    ...(over.defaultSaleFactor ? { defaultSaleFactor: over.defaultSaleFactor } : {})
  };
}

async function start() {
  const app = makeApp();
  const u = await setupWithUsers(app.d);
  await signInAs(app.d, u.manager, 'manager');
  return { app, d: app.d, u };
}

async function makeProduct(d: App['d'], sku: string, over: Parameters<typeof productInput>[1] = {}): Promise<number> {
  return (await ok(d, 'catalog:productSave', productInput(sku, over))).id;
}

const count = (app: App, sql: string) => scalar(app.d.db, sql);

describe('bulk product archive / restore', () => {
  it('archives and restores many products; already-archived, repeated and unknown ids are skipped, never an error', async () => {
    const { app, d } = await start();
    const a = await makeProduct(d, 'BA-1');
    const b = await makeProduct(d, 'BA-2');
    const c = await makeProduct(d, 'BA-3');
    await ok(d, 'catalog:productArchive', { id: c, archived: true }); // already archived before the bulk call

    const r = await ok(d, 'catalog:productsArchive', { ids: [a, b, c, 99_999, a], archived: true });
    expect(r).toEqual({ changed: 2, skipped: 3 });
    expect(r.changed + r.skipped).toBe(5);
    const all1 = await ok(d, 'catalog:products', { includeArchived: true });
    expect(all1.every((p) => p.status === 'archived')).toBe(true);
    expect(await ok(d, 'catalog:products', { includeArchived: false })).toHaveLength(0);

    const back = await ok(d, 'catalog:productsArchive', { ids: [a, b, 12_345], archived: false });
    expect(back).toEqual({ changed: 2, skipped: 1 });
    expect((await ok(d, 'catalog:products', { includeArchived: false })).map((p) => p.id).sort()).toEqual([a, b].sort());

    // one audit entry per bulk action, with the ids and counts
    const logs = all<{ action: string; after_json: string }>(app.d.db, "SELECT action, after_json FROM audit_log WHERE action LIKE 'products.bulk%' ORDER BY id");
    expect(logs.map((l) => l.action)).toEqual(['products.bulkArchive', 'products.bulkRestore']);
    expect(JSON.parse(logs[0]!.after_json)).toMatchObject({ ids: [a, b], changed: 2, skipped: 3, requested: 5 });
    expectIntegrity(app);
    app.close();
  });

  it('single-product archive keeps working as before', async () => {
    const { app, d } = await start();
    const a = await makeProduct(d, 'SG-1');
    await ok(d, 'catalog:productArchive', { id: a, archived: true });
    expect((await ok(d, 'catalog:products', { includeArchived: true }))[0]!.status).toBe('archived');
    expect(count(app, "SELECT COUNT(*) FROM audit_log WHERE action = 'product.archive'")).toBe(1);
    app.close();
  });
});

describe('bulk product delete', () => {
  it('deletes a clean product with its packs, barcodes and company link, and the same SKU can be imported again', async () => {
    const { app, d } = await start();
    const clean = await makeProduct(d, 'DEL-1', { barcodes: ['8800001'], packs: [{ name: 'Carton', factor: 12, barcode: '8800002' }], defaultSaleFactor: 12 });
    const keep = await makeProduct(d, 'KEEP-1', { barcodes: ['8800009'] });
    const sup = await ok(d, 'catalog:supplierSave', { name: 'Supplier A', nameBn: '', phone: '', address: '', notes: '' });
    await ok(d, 'supplier:link', { supplierId: sup.id, productIds: [clean, keep] });
    expect(count(app, `SELECT COUNT(*) FROM product_packs WHERE product_id = ${clean}`)).toBe(2);
    expect(count(app, `SELECT COUNT(*) FROM product_barcodes WHERE product_id = ${clean}`)).toBe(2);

    const preview = await ok(d, 'catalog:productsDeletePreview', { ids: [clean, keep, 424_242] });
    expect(preview).toEqual({ deletable: [clean, keep], blocked: [] });

    const r = await ok(d, 'catalog:productsDelete', { ids: [clean, 424_242], confirm: 'DELETE' });
    expect(r).toEqual({ deleted: 1, archivedInstead: 0 });

    expect(count(app, `SELECT COUNT(*) FROM products WHERE id = ${clean}`)).toBe(0);
    for (const t of ['product_packs', 'product_barcodes', 'supplier_products']) expect(count(app, `SELECT COUNT(*) FROM ${t} WHERE product_id = ${clean}`)).toBe(0);
    expect(count(app, `SELECT COUNT(*) FROM supplier_products WHERE product_id = ${keep}`)).toBe(1); // untouched
    expect(count(app, 'SELECT COUNT(*) FROM product_packs WHERE product_id NOT IN (SELECT id FROM products)')).toBe(0);
    expect(all(app.d.db, 'PRAGMA foreign_key_check')).toEqual([]);

    // audit keeps what vanished
    const log = all<{ after_json: string }>(app.d.db, "SELECT after_json FROM audit_log WHERE action = 'products.bulkDelete'");
    expect(JSON.parse(log[0]!.after_json)).toMatchObject({ deleted: 1, archivedInstead: 0, deletedProducts: [{ id: clean, sku: 'DEL-1' }] });

    // SKU and barcodes are free again: the same product can be imported
    const csv = 'SKU,Name,Retail,Barcode\r\nDEL-1,Product DEL-1,50,8800001';
    const m = (await ok(d, 'import:preview', { kind: 'products', text: csv })).mapping;
    const again = await ok(d, 'import:run', { kind: 'products', text: csv, mapping: m, dryRun: false, skipBad: false });
    expect(again.created).toBe(1);
    expect((await ok(d, 'catalog:products', { includeArchived: true })).map((p) => p.sku).sort()).toEqual(['DEL-1', 'KEEP-1']);
    expectIntegrity(app);
    app.close();
  });

  it('a product with a sale, a purchase or opening stock is never deleted: it is archived instead and the sale still reads correctly', async () => {
    const { app, d } = await start();
    const bought = await makeProduct(d, 'H-BUY');
    const sold = await makeProduct(d, 'H-SALE');
    const opened = await makeProduct(d, 'H-OPEN');
    const clean = await makeProduct(d, 'H-CLEAN');

    await ok(d, 'purchase:save', { supplierId: null, supplierRef: '', date: DATE, lines: [{ productId: bought, packId: null, qty: 10, unitCost: 1000 }, { productId: sold, packId: null, qty: 10, unitCost: 1000 }], discount: 0, paid: 20_000, accountId: null, note: '' });
    const sale = await ok(d, 'sale:save', { date: DATE, paid: 5000, lines: [{ productId: sold, qty: 1, price: 5000 }] });
    await ok(d, 'stock:adjust', { productId: opened, kind: 'opening', baseQty: 5, date: DATE, value: 5000 });

    const all4 = [bought, sold, opened, clean];
    const preview = await ok(d, 'catalog:productsDeletePreview', { ids: all4 });
    expect(preview.deletable).toEqual([clean]);
    expect(preview.blocked).toEqual([
      { id: bought, reason: 'hasPurchases' },
      { id: sold, reason: 'hasSales' },
      { id: opened, reason: 'hasStock' }
    ]);

    const r = await ok(d, 'catalog:productsDelete', { ids: all4, confirm: 'DELETE' });
    expect(r).toEqual({ deleted: 1, archivedInstead: 3 });

    const list = await ok(d, 'catalog:products', { includeArchived: true });
    expect(list.map((p) => [p.sku, p.status]).sort()).toEqual([['H-BUY', 'archived'], ['H-OPEN', 'archived'], ['H-SALE', 'archived']]);
    const detail = await ok(d, 'sale:get', { id: sale.id });
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]!.sku).toBe('H-SALE');
    expect(detail.total).toBe(5000);
    expectIntegrity(app);
    app.close();
  });

  it('refuses a wrong confirm text and changes nothing', async () => {
    const { app, d } = await start();
    const a = await makeProduct(d, 'CF-1');
    expect(await fail(d, 'catalog:productsDelete', { ids: [a], confirm: 'delete' })).toBe('INVALID_INPUT');
    expect(await fail(d, 'catalog:productsDelete', { ids: [a], confirm: '' })).toBe('INVALID_INPUT');
    expect(() => deleteProducts(makeCtx(app.d.db, null), [a], 'nope')).toThrow(/DELETE/);
    expect(count(app, `SELECT COUNT(*) FROM products WHERE id = ${a}`)).toBe(1);
    app.close();
  });

  it('rejects empty and oversized id lists', async () => {
    const { app, d } = await start();
    expect(await fail(d, 'catalog:productsArchive', { ids: [], archived: true })).toBe('INVALID_INPUT');
    expect(await fail(d, 'catalog:productsDeletePreview', { ids: Array.from({ length: 2001 }, (_, i) => i + 1) })).toBe('INVALID_INPUT');
    app.close();
  });

  it('staff get PERMISSION from all three channels and nothing changes', async () => {
    const { app, d, u } = await start();
    const a = await makeProduct(d, 'ST-1');
    await signInAs(d, u.staff, 'staff');
    expect(await fail(d, 'catalog:productsArchive', { ids: [a], archived: true })).toBe('PERMISSION');
    expect(await fail(d, 'catalog:productsDeletePreview', { ids: [a] })).toBe('PERMISSION');
    expect(await fail(d, 'catalog:productsDelete', { ids: [a], confirm: 'DELETE' })).toBe('PERMISSION');
    expect(count(app, `SELECT COUNT(*) FROM products WHERE id = ${a} AND status = 'active'`)).toBe(1);
    app.close();
  });
});

describe('bulk actions are all or nothing', () => {
  /** A clock that works for `okCalls` calls and then throws, to make a step fail part-way through the batch. */
  function failingCtx(app: App, okCalls: number) {
    let n = 0;
    return makeCtx(app.d.db, null, () => {
      if (++n > okCalls) throw new Error('boom');
      return '2026-10-01T05:00:00.000Z';
    });
  }

  it('bulk archive rolls back every change when one step throws', async () => {
    const { app, d } = await start();
    const ids = [await makeProduct(d, 'RB-1'), await makeProduct(d, 'RB-2'), await makeProduct(d, 'RB-3')];
    expect(() => archiveProducts(failingCtx(app, 2), ids, true)).toThrow('boom');
    expect(count(app, "SELECT COUNT(*) FROM products WHERE status = 'archived'")).toBe(0);
    expect(count(app, "SELECT COUNT(*) FROM audit_log WHERE action = 'products.bulkArchive'")).toBe(0);
    // the connection is usable afterwards (no dangling transaction)
    expect(archiveProducts(makeCtx(app.d.db, null), ids, true)).toEqual({ changed: 3, skipped: 0 });
    app.close();
  });

  it('bulk delete rolls back deletions and archive-instead changes when one step throws', async () => {
    const { app, d } = await start();
    const clean1 = await makeProduct(d, 'RD-1', { barcodes: ['7700001'], packs: [{ name: 'Box', factor: 6 }] });
    const clean2 = await makeProduct(d, 'RD-2');
    const used = await makeProduct(d, 'RD-3');
    await ok(d, 'stock:adjust', { productId: used, kind: 'opening', baseQty: 3, date: DATE, value: 3000 });
    // the failing clock hits the archive-instead step of the third product, after two real deletions
    expect(() => deleteProducts(failingCtx(app, 0), [clean1, clean2, used], 'DELETE')).toThrow('boom');
    // nothing at all took effect
    expect(count(app, 'SELECT COUNT(*) FROM products')).toBe(3);
    expect(count(app, `SELECT COUNT(*) FROM product_barcodes WHERE product_id = ${clean1}`)).toBe(1);
    expect(count(app, `SELECT COUNT(*) FROM product_packs WHERE product_id = ${clean1}`)).toBe(2);
    expect(count(app, "SELECT COUNT(*) FROM products WHERE status = 'archived'")).toBe(0);
    expect(count(app, "SELECT COUNT(*) FROM audit_log WHERE action = 'products.bulkDelete'")).toBe(0);
    expectIntegrity(app);
    app.close();
  });
});
