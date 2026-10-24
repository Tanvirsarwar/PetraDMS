import { describe, expect, it } from 'vitest';
import type { ProductDto } from '@petra/core';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs } from './testApp';

const DATE = '2026-10-01';

async function product(app: ReturnType<typeof makeApp>) {
  const r = await ok(app.d, 'catalog:productSave', {
    sku: 'MLK-24', name: 'Marks Milk 25g', nameBn: 'মার্কস দুধ', baseUnit: 'pcs', priceRetail: 5_500, priceWholesale: 5_000, priceDealer: 4_800, minPrice: 0,
    packs: [{ name: 'Box', nameBn: 'বক্স', factor: 24, priceRetail: 130_000, priceWholesale: 118_000, priceDealer: null, barcode: 'BOX-MLK-24' }, { name: 'Dozen', factor: 12 }],
    barcodes: ['8941001'], defaultSaleFactor: 24, defaultPurchaseFactor: 24, reorderLevel: 48
  });
  return (await ok(app.d, 'catalog:products', { includeArchived: false })).find((p) => p.id === r.id) as ProductDto;
}

describe('box + pcs across the app (services)', () => {
  it('saves box prices, a box barcode and the default sale / purchase box; editing keeps or moves them', async () => {
    const app = makeApp();
    await setupWithUsers(app.d);
    const p = await product(app);
    const box = p.packs.find((k) => k.factor === 24)!;
    expect(box).toMatchObject({ name: 'Box', nameBn: 'বক্স', priceRetail: 130_000, priceWholesale: 118_000, priceDealer: null, barcode: 'BOX-MLK-24' });
    expect(p.barcodes).toEqual(['8941001']);
    expect(p.defaultSalePackId).toBe(box.id);
    expect(p.defaultPurchasePackId).toBe(box.id);
    // the box barcode cannot be reused as a product barcode
    expect(await fail(app.d, 'catalog:productSave', { sku: 'OTHER', name: 'Other', baseUnit: 'pcs', priceRetail: 1, priceWholesale: 1, priceDealer: 1, barcodes: ['BOX-MLK-24'] })).toBe('DUPLICATE');
    // removing the dozen and moving the barcode to it is fine; the default box stays
    await ok(app.d, 'catalog:productSave', {
      id: p.id, sku: p.sku, name: p.name, baseUnit: 'pcs', priceRetail: 5_500, priceWholesale: 5_000, priceDealer: 4_800,
      packs: [{ id: box.id, name: 'Box', factor: 24, priceRetail: 131_000, barcode: null }], barcodes: ['8941001', 'BOX-MLK-24'], defaultSaleFactor: 1, defaultPurchaseFactor: 24
    });
    const q = (await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!;
    expect(q.packs.map((k) => k.factor)).toEqual([1, 24]);
    expect(q.packs[1]!.barcode).toBeNull();
    expect(q.barcodes).toEqual(['8941001', 'BOX-MLK-24']);
    expect(q.defaultSalePackId).toBeNull();
    expect(q.defaultPurchasePackId).toBe(box.id);
    expectIntegrity(app);
  });

  it('a POS sale of 2 Box + 5 Pcs (two lines) prints as one row and returns 1 box + 3 pcs exactly', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    const p = await product(app);
    const box = p.packs.find((k) => k.factor === 24)!;
    const base = p.packs.find((k) => k.factor === 1)!;
    const sup = await ok(app.d, 'catalog:supplierSave', { name: 'Marks Ltd' });
    await ok(app.d, 'purchase:save', { supplierId: sup.id, date: DATE, lines: [{ productId: p.id, packId: box.id, qty: 10, looseQty: 0, unitCost: 100_000 }], paid: 0 });
    const cust = await ok(app.d, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0 });
    const sale = await ok(app.d, 'sale:save', { customerId: cust.id, date: DATE, paid: 0, lines: [{ productId: p.id, packId: box.id, qty: 2, price: 130_000 }, { productId: p.id, packId: base.id, qty: 5, price: 5_500 }] });
    expect(sale.total).toBe(287_500);
    expect((await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!.stockQty).toBe(240 - 53);

    await ok(app.d, 'print:run', { doc: { type: 'invoice', id: sale.id }, action: 'print', format: 'a4' });
    // the shop prints in Bangla (set up that way): Bangla box name and digits; price per box and per piece add up to the amount
    const html = app.printed.at(-1)!;
    expect(html).toContain('২ বক্স + ৫ pcs');
    expect(html).toContain('৳১,৩০০/বক্স + ৳৫৫/pcs');
    expect(html).toContain('৳২,৮৭৫');
    await ok(app.d, 'print:run', { doc: { type: 'invoice', id: sale.id }, action: 'print', format: 'thermal58' });
    expect(app.printed.at(-1)!).toContain('২ বক্স + ৫ pcs');

    // return 1 box + 3 pcs: 27 pieces, taken from the box line first
    const detail = await ok(app.d, 'sale:get', { id: sale.id });
    const boxItem = detail.items.find((i) => i.factor === 24)!;
    const r = await ok(app.d, 'sale:return', { saleId: sale.id, date: DATE, items: [{ saleItemId: boxItem.id, baseQty: 27 }], refundMode: 'due' });
    expect(r.total).toBe(Math.round((260_000 * 27) / 48));
    // more than was sold on that line is refused
    expect(await fail(app.d, 'sale:return', { saleId: sale.id, date: DATE, items: [{ saleItemId: boxItem.id, baseQty: 22 }], refundMode: 'due' })).toBe('OVER_RETURN');
    expect((await ok(app.d, 'catalog:products', { includeArchived: false }))[0]!.stockQty).toBe(240 - 53 + 27);
    void u;
    expectIntegrity(app);
  });

  it('prints a GRN for managers only, with box + pcs and free goods', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    const p = await product(app);
    const box = p.packs.find((k) => k.factor === 24)!;
    const sup = await ok(app.d, 'catalog:supplierSave', { name: 'Marks Ltd' });
    const pur = await ok(app.d, 'purchase:save', { supplierId: sup.id, supplierRef: 'MK-9', date: DATE, lines: [{ productId: p.id, packId: box.id, qty: 5, looseQty: 6, unitCost: 100_000 }, { productId: p.id, packId: box.id, qty: 1, looseQty: 0, unitCost: 0, kind: 'free' }], freight: 5_000, paid: 0 });
    await ok(app.d, 'print:run', { doc: { type: 'purchase', id: pur.id }, action: 'pdf' });
    const html = app.printed.at(-1)!;
    expect(html).toContain('৫ বক্স + ৬ pcs');
    expect(html).toContain('(ফ্রি)');
    expect(html).toContain('MK-9');
    expect(app.pdfs.at(-1)).toMatch(/GRN-PUR-000001\.pdf$/);
    await signInAs(app.d, u.staff, 'staff');
    expect(await fail(app.d, 'print:run', { doc: { type: 'purchase', id: pur.id }, action: 'print' })).toBe('PERMISSION');
  });
});
