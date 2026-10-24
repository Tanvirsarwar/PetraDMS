import { describe, expect, it } from 'vitest';
import type { ProductDto } from '@petra/core';
import { defaultSalePackOf, demandFor, emptyCart, expandLines, isBoxed, lineBaseQty, lineOk, parseBoxPcs, parseCart, serialiseCart, tierPriceOf, totalsOf, type CartLine } from './cart';

const p: ProductDto = {
  id: 1, sku: 'MLK', name: 'Milk', nameBn: '', categoryId: null, categoryName: '', brandId: null, brandName: '', baseUnit: 'pcs', trackExpiry: false,
  defaultSalePackId: 12, defaultPurchasePackId: 12, priceRetail: 5_500, priceWholesale: 5_000, priceDealer: 4_800, minPrice: 0, stockQty: 500, stockValue: 0, avgCost: 0, lastCost: 0,
  reorderLevel: 0, favourite: false, status: 'active', notes: '',
  packs: [{ id: 11, name: 'pcs', nameBn: '', factor: 1, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: null }, { id: 12, name: 'Box', nameBn: 'বক্স', factor: 24, priceRetail: 130_000, priceWholesale: 120_000, priceDealer: null, barcode: 'BOX-1' }],
  barcodes: [], hasHistory: false, nearestExpiry: null
};
const byId = new Map([[1, p]]);
const line = (over: Partial<CartLine> = {}): CartLine => ({ key: 1, productId: 1, packId: 12, qty: 2, price: 130_000, discKind: null, discValue: 0, kind: 'normal', pcs: 5, pcsPrice: 5_500, ...over });

describe('POS box + pcs', () => {
  it('reads the shortcut "2b5" and its Bangla and plus forms', () => {
    expect(parseBoxPcs('2b5')).toEqual({ box: 2, pcs: 5 });
    expect(parseBoxPcs('2 box 5 pcs')).toEqual({ box: 2, pcs: 5 });
    expect(parseBoxPcs('২ব৫')).toEqual({ box: 2, pcs: 5 });
    expect(parseBoxPcs('2+5')).toEqual({ box: 2, pcs: 5 });
    expect(parseBoxPcs('7')).toEqual({ box: 7, pcs: null });
    expect(parseBoxPcs('2x')).toBeNull();
  });

  it('starts a new line in the default sale unit', () => {
    expect(defaultSalePackOf(p)).toBe(12);
    expect(defaultSalePackOf({ ...p, defaultSalePackId: null })).toBe(11);
  });

  it('"2 Box 5 Pcs" is two engine lines priced per box and per piece, and the amount adds up exactly', () => {
    const l = line();
    expect(lineBaseQty(p, l)).toBe(53);
    const subs = expandLines([l], byId);
    expect(subs.map((s) => [s.part, s.packId, s.qty, s.price])).toEqual([['box', 12, 2, 130_000], ['pcs', 11, 5, 5_500]]);
    const tot = totalsOf({ ...emptyCart(), lines: [l] }, 0, false, byId);
    expect(tot.amountOf.get(1)).toBe(2 * 130_000 + 5 * 5_500);
    expect(tot.total).toBe(287_500);
  });

  it('a percent discount applies to both parts; a fixed one only to the boxes', () => {
    expect(expandLines([line({ discKind: 'pct', discValue: 500 })], byId).map((s) => s.discValue)).toEqual([500, 500]);
    expect(expandLines([line({ discKind: 'fixed', discValue: 1_000 })], byId).map((s) => s.discValue)).toEqual([1_000, 0]);
    expect(expandLines([line({ qty: 0, discKind: 'fixed', discValue: 1_000 })], byId).map((s) => [s.part, s.discValue])).toEqual([['pcs', 1_000]]);
  });

  it('a line needs some quantity and a price for every part it uses', () => {
    expect(lineOk(p, line())).toBe(true);
    expect(lineOk(p, line({ qty: 0, pcs: 0 }))).toBe(false);
    expect(lineOk(p, line({ pcsPrice: null }))).toBe(false);
    expect(lineOk(p, line({ pcs: 0, pcsPrice: null }))).toBe(true);
    expect(lineOk(p, line({ kind: 'bonus', price: 0, pcsPrice: 0 }))).toBe(true);
  });

  it('keeps box + pcs through the autosaved draft', () => {
    const c = parseCart(serialiseCart({ ...emptyCart(), lines: [line()] }), [p]);
    expect(c?.lines[0]).toMatchObject({ qty: 2, pcs: 5, pcsPrice: 5_500, packId: 12 });
  });
});

describe('POS box + pcs: per-product box size and pieces-only products', () => {
  const pack = (id: number, factor: number, name: string, priceRetail: number | null = null) => ({ id, name, nameBn: '', factor, priceRetail, priceWholesale: null, priceDealer: null, barcode: null });
  const make = (id: number, factor: number | null, boxPrice: number | null): ProductDto => ({
    ...p, id, sku: `P${id}`, defaultSalePackId: factor ? id * 10 + 2 : null, priceRetail: 1_000,
    packs: factor ? [pack(id * 10 + 1, 1, 'pcs'), pack(id * 10 + 2, factor, 'Box', boxPrice)] : [pack(id * 10 + 1, 1, 'pcs')]
  });
  const a = make(2, 12, 11_000); // 12 per box, box cheaper than 12 pieces (12_000)
  const b = make(3, 24, null); // 24 per box, no box price: piece price x 24
  const c = make(4, 48, 50_000);
  const loose = make(5, null, null); // sold by the piece only
  const all = new Map([a, b, c, loose].map((x) => [x.id, x]));
  const l = (prod: ProductDto, qty: number, pcs: number | null, over: Partial<CartLine> = {}): CartLine => {
    const packId = defaultSalePackOf(prod);
    return { key: prod.id, productId: prod.id, packId, qty, price: tierPriceOf(prod, packId, 'retail'), pcs, pcsPrice: tierPriceOf(prod, prod.packs[0]!.id, 'retail'), discKind: null, discValue: 0, kind: 'normal', ...over };
  };

  it('converts with each product\'s own box size', () => {
    expect(lineBaseQty(a, l(a, 2, 5))).toBe(29);
    expect(lineBaseQty(b, l(b, 2, 5))).toBe(53);
    expect(lineBaseQty(c, l(c, 2, 5))).toBe(101);
    expect(lineBaseQty(a, l(a, 2, null))).toBe(24);
    // loose pieces beyond a box are still exact pieces, never rounded into boxes
    expect(lineBaseQty(a, l(a, 1, 15))).toBe(27);
  });

  it('a box has its own price; without one it is the piece price times the box size', () => {
    expect(tierPriceOf(a, defaultSalePackOf(a), 'retail')).toBe(11_000);
    expect(tierPriceOf(b, defaultSalePackOf(b), 'retail')).toBe(24_000);
    const tot = totalsOf({ ...emptyCart(), lines: [l(a, 2, 5), l(b, 1, 0)] }, 0, false, all);
    expect(tot.amountOf.get(a.id)).toBe(2 * 11_000 + 5 * 1_000);
    expect(tot.amountOf.get(b.id)).toBe(24_000);
  });

  it('a product sold only by the piece ignores any loose-pieces value and never shows a box', () => {
    const line = l(loose, 7, 3);
    expect(isBoxed(loose, line)).toBe(false);
    expect(lineBaseQty(loose, line)).toBe(7);
    expect(expandLines([line], all).map((s) => [s.part, s.qty])).toEqual([['box', 7]]);
  });

  it('the stock warning counts boxes and pieces of all lines of the product together', () => {
    const cart = { ...emptyCart(), lines: [l(a, 2, 5), { ...l(a, 0, 3), key: 99, kind: 'bonus' as const, price: 0, pcsPrice: 0 }] };
    expect(demandFor(cart, all, a.id)).toBe(32);
  });
});
