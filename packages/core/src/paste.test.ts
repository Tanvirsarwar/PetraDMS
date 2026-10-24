import { describe, expect, it } from 'vitest';
import { guessPasteMapping, makeProductMatcher, pasteCells, readPasteRows } from './paste';

const products = [
  { id: 1, sku: 'MARKS-500', name: 'Marks Milk 500g', nameBn: 'মার্কস দুধ ৫০০গ্রা', barcodes: ['8900001'] },
  { id: 2, sku: 'TEA-1', name: 'Tea 400g', nameBn: '', barcodes: [] },
  { id: 3, sku: 'DUP-A', name: 'Same Name', nameBn: '', barcodes: [] },
  { id: 4, sku: 'DUP-B', name: 'Same Name', nameBn: '', barcodes: [] }
];
const match = makeProductMatcher(products);

describe('paste from Excel', () => {
  it('reads tab-separated rows with a heading row and maps the columns by name', () => {
    const rows = pasteCells('Code\tCtn\tPcs\tRate\nmarks-500\t5\t6\t1,250.50\nTEA-1\t2\t\t900\n');
    const g = guessPasteMapping(rows);
    expect(g).toEqual({ hasHeader: true, mapping: { product: 0, box: 1, pcs: 2, cost: 3 } });
    const out = readPasteRows(rows, g.mapping, g.hasHeader, match);
    expect(out.map((r) => [r.line, r.productId, r.box, r.pcs, r.cost, r.problems])).toEqual([
      [2, 1, 5, 6, 125_050, []],
      [3, 2, 2, 0, 90_000, []]
    ]);
  });

  it('guesses product, box, pcs, cost from left to right without headings and matches barcode and Bangla name', () => {
    const rows = pasteCells('8900001,1,0,100\nমার্কস দুধ ৫০০গ্রা,০,৭,');
    const g = guessPasteMapping(rows);
    expect(g.hasHeader).toBe(false);
    const out = readPasteRows(rows, g.mapping, g.hasHeader, match);
    expect(out[0]).toMatchObject({ productId: 1, box: 1, pcs: 0, cost: 10_000, problems: [] });
    expect(out[1]).toMatchObject({ productId: 1, box: 0, pcs: 7, cost: null, problems: [] });
  });

  it('keeps every bad row with the reasons instead of dropping it', () => {
    const rows = pasteCells('Item\tBox\tPcs\tCost\nunknown thing\t1\t0\t10\nTEA-1\tx\t2\t10\nTEA-1\t0\t0\t10\nTEA-1\t1\t0\tabc\nSame Name\t1\t0\t5');
    const g = guessPasteMapping(rows);
    const out = readPasteRows(rows, g.mapping, g.hasHeader, match);
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.problems)).toEqual([['noProduct'], ['badBox'], ['noQty'], ['badCost'], ['noProduct']]);
  });
});
