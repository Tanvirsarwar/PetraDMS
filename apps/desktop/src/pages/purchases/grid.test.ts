import { describe, expect, it } from 'vitest';
import type { ProductDto } from '@petra/core';
import { defaultCost, defaultPack, makeRow, rowAmount, stockAfter, summarize, toSaveLines } from './grid';

const product = (over: Partial<ProductDto> = {}): ProductDto => ({
  id: 1, sku: 'TEA', name: 'Tea', nameBn: '', categoryId: null, categoryName: '', brandId: null, brandName: '', baseUnit: 'pcs', trackExpiry: false,
  defaultSalePackId: null, defaultPurchasePackId: null, priceRetail: 500, priceWholesale: 450, priceDealer: 400, minPrice: 0, stockQty: 10, stockValue: 0, avgCost: 400, lastCost: 400,
  reorderLevel: 0, favourite: false, status: 'active', notes: '',
  packs: [{ id: 11, name: 'pcs', nameBn: '', factor: 1, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: null }, { id: 12, name: 'Box', nameBn: '', factor: 24, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: null }],
  barcodes: [], hasHistory: false, nearestExpiry: null, ...over
});

describe('bulk purchase grid', () => {
  it('starts each row in the company box, at the company\'s last cost, else last cost x box size', () => {
    const p = product();
    expect(defaultPack(p).id).toBe(12);
    expect(defaultPack(p, { productId: 1, defaultPackId: 11, lastCost: 410, sort: 1 }).id).toBe(11);
    expect(defaultCost(p, defaultPack(p))).toBe(400 * 24);
    expect(defaultCost(p, defaultPack(p), { productId: 1, defaultPackId: 12, lastCost: 9_999, sort: 1 })).toBe(9_999);
  });

  it('prices "5 Box + 6 Pcs" with free goods and keeps empty rows out of the save', () => {
    const p = product();
    const byId = new Map([[1, p]]);
    const r = { ...makeRow(p), box: 5, pcs: 6, cost: 24_000, freeBox: 1, freePcs: 2 };
    const empty = makeRow(p);
    expect(rowAmount(r, p)).toBe(5 * 24_000 + 6 * 1_000);
    expect(stockAfter(r, p)).toBe(10 + 6 * 24 + 8);
    const s = summarize([r, empty], byId, { discKind: 'fixed', disc: 1_000, tax: null, freight: 500 });
    expect(s).toMatchObject({ lineCount: 1, boxes: 6, pcs: 8 });
    expect(s.calc?.total).toBe(126_000 - 1_000 + 500);
    expect(toSaveLines([r, empty], byId)).toEqual([
      { productId: 1, packId: 12, qty: 5, looseQty: 6, unitCost: 24_000, kind: 'normal', discKind: null, discValue: 0, batchNo: '', expiry: null },
      { productId: 1, packId: 12, qty: 1, looseQty: 2, unitCost: 0, kind: 'free', discKind: null, discValue: 0, batchNo: '', expiry: null }
    ]);
  });
});
