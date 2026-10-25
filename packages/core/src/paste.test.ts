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
    expect(g).toEqual({ hasHeader: true, start: 0, mapping: { product: 0, box: 1, pcs: 2, cost: 3 } });
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

describe('paste from Excel: a whole company invoice sheet', () => {
  const products = [
    { id: 7, sku: 'SF-NDL-12P', name: 'Shapla Noodles 12-pack', nameBn: '', barcodes: [] },
    { id: 8, sku: 'SF-TEA-400G', name: 'Shapla Tea 400 g', nameBn: '', barcodes: [] },
    { id: 9, sku: 'SF-SALT-1KG', name: 'Shapla Salt 1 kg', nameBn: '', barcodes: [] }
  ];
  const sheet = [
    'SHAPLA FOODS LTD (DEMO)  -  Sales invoice',
    'Invoice no: SF-1093\t\tDate: 21/10/2026',
    'To: MM Traders, Sylhet',
    '',
    'Item code\tDescription\tCTN\tPCS\tTP / CTN\tAmount',
    'SF-NDL-12P\tShapla Noodles 12-pack\t6\t0\t1250\t7500',
    'SF-TEA-400G\tShapla Tea 400 g\t2\t0\t4900\t9800',
    'SF-SALT-1KG\tShapla Salt 1 kg\t4\t10\t950\t4180',
    '',
    '\t\t\t\tTotal\t21480'
  ].join('\n');

  it('finds the heading row below the title, maps TP / CTN, and leaves the total row aside', () => {
    const cells = pasteCells(sheet);
    const g = guessPasteMapping(cells);
    // blank lines are dropped first, so the heading is the fourth row
    expect(g).toMatchObject({ hasHeader: true, start: 3, mapping: { product: 0, box: 2, pcs: 3, cost: 4 } });
    const rows = readPasteRows(cells, g.mapping, g.hasHeader, makeProductMatcher(products), g.start);
    const lines = rows.filter((r) => !r.ignored);
    expect(lines.map((r) => [r.productId, r.box, r.pcs, r.cost, r.problems])).toEqual([[7, 6, 0, 125_000, []], [8, 2, 0, 490_000, []], [9, 4, 10, 95_000, []]]);
    // the total row comes back marked, never silently dropped
    expect(rows.filter((r) => r.ignored).map((r) => r.cells.join('|'))).toEqual(['||||Total|21480']);
  });

  it('a heading-less paste still reads from the first row, and a real line with a typo is not ignored', () => {
    const cells = pasteCells('SF-NDL-12P\t2\t0\t1250\nSF-NDL-12X\t1\t0\t1250');
    const g = guessPasteMapping(cells);
    expect(g).toMatchObject({ hasHeader: false, start: 0 });
    const rows = readPasteRows(cells, g.mapping, g.hasHeader, makeProductMatcher(products), g.start);
    expect(rows.map((r) => [r.productId, r.ignored, r.problems])).toEqual([[7, false, []], [null, false, ['noProduct']]]);
  });
});
