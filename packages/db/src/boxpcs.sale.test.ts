import { describe, expect, it } from 'vitest';
import type { ProductDto } from '@petra/core';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers } from './testApp';

const DATE = '2026-10-01';
type App = ReturnType<typeof makeApp>;

/** A product with its own box size and box price (null = piece price x box size). factor null = sold by the piece only. */
async function product(app: App, sku: string, factor: number | null, boxPrice: number | null, piecePrice = 1_000): Promise<ProductDto> {
  const r = await ok(app.d, 'catalog:productSave', {
    sku, name: `Product ${sku}`, baseUnit: 'pcs', priceRetail: piecePrice, priceWholesale: piecePrice, priceDealer: piecePrice, minPrice: 0,
    packs: factor ? [{ name: 'Box', nameBn: 'বক্স', factor, priceRetail: boxPrice, priceWholesale: boxPrice, priceDealer: boxPrice }] : [],
    barcodes: [], defaultSaleFactor: factor ?? 1, defaultPurchaseFactor: factor ?? 1, reorderLevel: 0
  });
  return products(app, r.id);
}

async function products(app: App, id: number): Promise<ProductDto> {
  return (await ok(app.d, 'catalog:products', { includeArchived: false })).find((p) => p.id === id)!;
}

const boxOf = (p: ProductDto) => p.packs.find((k) => k.factor > 1)!;
const pcsOf = (p: ProductDto) => p.packs.find((k) => k.factor === 1)!;

async function stockUp(app: App, p: ProductDto, boxes: number, loose = 0) {
  const sup = await ok(app.d, 'catalog:supplierSave', { name: `Supplier ${p.sku}` });
  await ok(app.d, 'purchase:save', { supplierId: sup.id, date: DATE, lines: [{ productId: p.id, packId: boxOf(p).id, qty: boxes, looseQty: loose, unitCost: 600 * boxOf(p).factor }], paid: 0 });
}

describe('box + pcs sales with a box size per product', () => {
  it('2 boxes + 5 pieces takes the right number of pieces for 12, 24 and 48 per box, at separate box and piece prices', async () => {
    const app = makeApp();
    await setupWithUsers(app.d);
    const a = await product(app, 'A', 12, 11_000); // box cheaper than 12 pieces (12_000)
    const b = await product(app, 'B', 24, null); // no box price: 24 x 1_000
    const c = await product(app, 'C', 48, 45_000);
    for (const p of [a, b, c]) await stockUp(app, p, 10);
    const lines = [a, b, c].flatMap((p) => [
      { productId: p.id, packId: boxOf(p).id, qty: 2, price: boxOf(p).priceRetail ?? 1_000 * boxOf(p).factor },
      { productId: p.id, packId: pcsOf(p).id, qty: 5, price: 1_000 }
    ]);
    const sale = await ok(app.d, 'sale:save', { customerId: null, date: DATE, paid: 2 * 11_000 + 2 * 24_000 + 2 * 45_000 + 3 * 5_000, lines });
    expect(sale.total).toBe(2 * 11_000 + 5_000 + 2 * 24_000 + 5_000 + 2 * 45_000 + 5_000);
    expect((await products(app, a.id)).stockQty).toBe(120 - 29);
    expect((await products(app, b.id)).stockQty).toBe(240 - 53);
    expect((await products(app, c.id)).stockQty).toBe(480 - 101);

    // stored in base pieces, with the box size of the day kept on the line
    const d = await ok(app.d, 'sale:get', { id: sale.id });
    expect(d.items.map((i) => [i.factor, i.qty, i.baseQty])).toEqual([[12, 2, 24], [1, 5, 5], [24, 2, 48], [1, 5, 5], [48, 2, 96], [1, 5, 5]]);
    expectIntegrity(app);
  });

  it('prints "2 Box + 5 pcs" with the total pieces on A4 and thermal', async () => {
    const app = makeApp();
    await setupWithUsers(app.d);
    const a = await product(app, 'A', 12, 11_000);
    await stockUp(app, a, 5);
    const sale = await ok(app.d, 'sale:save', { customerId: null, date: DATE, paid: 27_000, lines: [{ productId: a.id, packId: boxOf(a).id, qty: 2, price: 11_000 }, { productId: a.id, packId: pcsOf(a).id, qty: 5, price: 1_000 }] });
    await ok(app.d, 'print:run', { doc: { type: 'invoice', id: sale.id }, action: 'print', format: 'a4' });
    // the test shop prints in Bangla
    expect(app.printed.at(-1)!).toContain('২ বক্স + ৫ pcs (মোট ২৯ pcs)');
    await ok(app.d, 'print:run', { doc: { type: 'invoice', id: sale.id }, action: 'print', format: 'thermal58' });
    expect(app.printed.at(-1)!).toContain('২ বক্স + ৫ pcs (মোট ২৯ pcs)');
  });

  it('a product sold only by the piece works as before, with no box anywhere', async () => {
    const app = makeApp();
    await setupWithUsers(app.d);
    const p = await product(app, 'LOOSE', null, null, 2_500);
    expect(p.packs.map((k) => k.factor)).toEqual([1]);
    await ok(app.d, 'stock:adjust', { productId: p.id, kind: 'opening', baseQty: 40, date: DATE, reason: 'count', value: 40_000 });
    const sale = await ok(app.d, 'sale:save', { customerId: null, date: DATE, paid: 17_500, lines: [{ productId: p.id, packId: pcsOf(p).id, qty: 7, price: 2_500 }] });
    expect(sale.total).toBe(17_500);
    expect((await products(app, p.id)).stockQty).toBe(33);
    await ok(app.d, 'print:run', { doc: { type: 'invoice', id: sale.id }, action: 'print', format: 'a4' });
    expect(app.printed.at(-1)!).not.toContain('মোট ৭');
    expectIntegrity(app);
  });

  it('stock entered in boxes + pieces (opening, adjustment, damage) is the same pieces as a sale takes', async () => {
    const app = makeApp();
    await setupWithUsers(app.d);
    const a = await product(app, 'A', 12, 11_000);
    // 3 boxes + 4 pieces on the adjustment screen is 3 * 12 + 4 = 40 pieces
    await ok(app.d, 'stock:adjust', { productId: a.id, kind: 'opening', baseQty: 3 * 12 + 4, date: DATE, reason: 'count', value: 24_000 });
    await ok(app.d, 'stock:adjust', { productId: a.id, kind: 'damage', baseQty: 1 * 12 + 1, date: DATE, reason: 'wet box' });
    expect((await products(app, a.id)).stockQty).toBe(27);
    // a sale of 2 boxes + 4 pieces (28) is more than the 27 left
    expect(await fail(app.d, 'sale:save', { customerId: null, date: DATE, paid: 26_000, lines: [{ productId: a.id, packId: boxOf(a).id, qty: 2, price: 11_000 }, { productId: a.id, packId: pcsOf(a).id, qty: 4, price: 1_000 }] })).toBe('NEGATIVE_STOCK');
    await ok(app.d, 'sale:save', { customerId: null, date: DATE, paid: 25_000, lines: [{ productId: a.id, packId: boxOf(a).id, qty: 2, price: 11_000 }, { productId: a.id, packId: pcsOf(a).id, qty: 3, price: 1_000 }] });
    expect((await products(app, a.id)).stockQty).toBe(0);
    expectIntegrity(app);
  });

  it('returns a partial box exactly: stock gets the pieces back and the credit follows the prices paid', async () => {
    const app = makeApp();
    await setupWithUsers(app.d);
    const a = await product(app, 'A', 12, 11_000);
    await stockUp(app, a, 5);
    const cust = await ok(app.d, 'customer:save', { name: 'Rahim Store', type: 'retail', creditLimit: 0 });
    const sale = await ok(app.d, 'sale:save', { customerId: cust.id, date: DATE, paid: 0, lines: [{ productId: a.id, packId: boxOf(a).id, qty: 2, price: 11_000 }, { productId: a.id, packId: pcsOf(a).id, qty: 5, price: 1_000 }] });
    const d = await ok(app.d, 'sale:get', { id: sale.id });
    const boxLine = d.items.find((i) => i.factor === 12)!;
    const pcsLine = d.items.find((i) => i.factor === 1)!;
    // 1 box + 2 pieces back: 14 pieces out of the box line (bought at 11_000 per 12) -> 12_833.33 rounds to 12_833
    const r = await ok(app.d, 'sale:return', { saleId: sale.id, date: DATE, items: [{ saleItemId: boxLine.id, baseQty: 14 }], refundMode: 'due' });
    expect(r.total).toBe(Math.round((22_000 * 14) / 24));
    expect((await products(app, a.id)).stockQty).toBe(60 - 29 + 14);
    // the loose pieces go back at the piece price
    const r2 = await ok(app.d, 'sale:return', { saleId: sale.id, date: DATE, items: [{ saleItemId: pcsLine.id, baseQty: 5 }], refundMode: 'due' });
    expect(r2.total).toBe(5_000);
    expect(await fail(app.d, 'sale:return', { saleId: sale.id, date: DATE, items: [{ saleItemId: boxLine.id, baseQty: 11 }], refundMode: 'due' })).toBe('OVER_RETURN');
    expect((await ok(app.d, 'customer:list', { includeArchived: false })).find((x) => x.id === cust.id)!.balance).toBe(27_000 - r.total - 5_000);
    expectIntegrity(app);
  });

  it('a box size can be fixed before first use, but not after; a new size is a new pack and history keeps the old one', async () => {
    const app = makeApp();
    await setupWithUsers(app.d);
    const a = await product(app, 'A', 12, 11_000);
    const save = (packs: { id?: number; name: string; factor: number; priceRetail: number }[]) => ({ id: a.id, sku: a.sku, name: a.name, baseUnit: 'pcs', priceRetail: 1_000, priceWholesale: 1_000, priceDealer: 1_000, minPrice: 0, packs, barcodes: [], defaultSaleFactor: packs[0]!.factor, defaultPurchaseFactor: packs[0]!.factor, reorderLevel: 0 });
    const box = boxOf(a);
    // typo fixed before anything was sold or bought: fine
    await ok(app.d, 'catalog:productSave', save([{ id: box.id, name: 'Box', factor: 10, priceRetail: 11_000 }]));
    await ok(app.d, 'catalog:productSave', save([{ id: box.id, name: 'Box', factor: 12, priceRetail: 11_000 }]));
    await stockUp(app, a, 2);
    const sale = await ok(app.d, 'sale:save', { customerId: null, date: DATE, paid: 11_000, lines: [{ productId: a.id, packId: box.id, qty: 1, price: 11_000 }] });
    // after use the size is locked; the price can still change
    expect(await fail(app.d, 'catalog:productSave', save([{ id: box.id, name: 'Box', factor: 24, priceRetail: 11_000 }]))).toBe('PACK_SIZE_LOCKED');
    await ok(app.d, 'catalog:productSave', save([{ id: box.id, name: 'Box', factor: 12, priceRetail: 11_500 }]));
    // the company now sends boxes of 24: add a second pack
    await ok(app.d, 'catalog:productSave', save([{ id: box.id, name: 'Box', factor: 12, priceRetail: 11_500 }, { name: 'Box 24', factor: 24, priceRetail: 22_000 }]));
    const after = await products(app, a.id);
    expect(after.packs.map((k) => [k.name, k.factor])).toEqual([['pcs', 1], ['Box', 12], ['Box 24', 24]]);
    expect((await ok(app.d, 'sale:get', { id: sale.id })).items[0]).toMatchObject({ factor: 12, qty: 1, baseQty: 12, price: 11_000 });
    expect(after.stockQty).toBe(12);
    expectIntegrity(app);
  });
});
