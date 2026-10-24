import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { asciiDigits, autoMap, checkRow, mappingProblems, parseCsv, parseDateLoose, parseTaka, parseWhole, templateRows, writeCsv } from './index';

describe('csv', () => {
  it('reads quotes, doubled quotes, embedded line breaks, BOM and CRLF', () => {
    const r = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","two\nlines"\r\n\r\n1,2,3\r\n');
    expect(r.rows).toEqual([['a', 'b', 'c'], ['x, y', 'he said "hi"', 'two\nlines'], ['1', '2', '3']]);
  });
  it('detects semicolon and tab files', () => {
    expect(parseCsv('a;b\n1;2').rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
  });
  it('round-trips any text through writeCsv and parseCsv', () => {
    const cell = fc.string({ unit: fc.constantFrom('a', 'b', ' ', ',', '"', '\n', '\r', ';', 'ক', '১', '\t'), maxLength: 12 });
    fc.assert(fc.property(fc.array(fc.array(cell, { minLength: 2, maxLength: 4 }), { minLength: 1, maxLength: 6 }), (rows) => {
      const width = rows[0]!.length;
      const even = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? 'x'));
      // a row whose only content is blank is dropped on purpose, so give every row a visible first cell
      const safe = even.map((r, i) => [`r${i}`, ...r.slice(1)]);
      expect(parseCsv(writeCsv(safe)).rows).toEqual(safe);
    }), { numRuns: 300 });
  });
});

describe('parsers', () => {
  it('reads taka in many spellings', () => {
    expect(parseTaka('1,250.5')).toBe(125050);
    expect(parseTaka('৳ 640')).toBe(64000);
    expect(parseTaka('১২৫০.৫০')).toBe(125050);
    expect(parseTaka('Tk 99')).toBe(9900);
    expect(parseTaka('(50)')).toBe(-5000);
    expect(parseTaka('-0.05')).toBe(-5);
    expect(parseTaka('12.345')).toBeNull();
    expect(parseTaka('abc')).toBeNull();
    expect(parseTaka('')).toBeNull();
  });
  it('whole numbers and Bangla digits', () => {
    expect(parseWhole('১,২০০')).toBe(1200);
    expect(parseWhole('1.5')).toBeNull();
    expect(asciiDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789');
  });
  it('dates are day first and must be real days', () => {
    expect(parseDateLoose('2026-10-01')).toBe('2026-10-01');
    expect(parseDateLoose('01/10/2026')).toBe('2026-10-01');
    expect(parseDateLoose('১-১০-২০২৬')).toBe('2026-10-01');
    expect(parseDateLoose('2026-13-01')).toBeNull();
    expect(parseDateLoose('31/02/2026')).toBeNull();
    expect(parseDateLoose('29/02/2028')).toBe('2028-02-29');
  });
  it('taka to poisha never loses a paisa', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_999 }), (p) => parseTaka((p / 100).toFixed(2)) === p));
  });
});

describe('mapping and row checks', () => {
  it('matches English and Bangla headings and uses each column once', () => {
    const m = autoMap('customers', ['দোকান', 'Mobile', 'ঠিকানা', 'Previous Due', 'Opening Date', 'Junk']);
    expect(m.name).toBe(0);
    expect(m.phone).toBe(1);
    expect(m.address).toBe(2);
    expect(m.openingDue).toBe(3);
    expect(m.openingDate).toBe(4);
    expect(m.area).toBeNull();
  });
  it('reports missing, shared and out-of-range columns', () => {
    expect(mappingProblems('products', { sku: 0, name: null }, 3).map((p) => p.code)).toEqual(['missingColumn']);
    expect(mappingProblems('products', { sku: 0, name: 0 }, 3).map((p) => p.code)).toEqual(['sameColumn']);
    expect(mappingProblems('products', { sku: 0, name: 7 }, 3).map((p) => p.code)).toEqual(['badColumn']);
    expect(mappingProblems('dues', { party: 0, amount: 1, name: null, phone: null }, 3).length).toBe(1);
  });
  it('the template imports cleanly for every kind', () => {
    for (const kind of ['products', 'customers', 'dues'] as const) {
      const [head, sample] = templateRows(kind) as [string[], string[]];
      const m = autoMap(kind, head);
      expect(mappingProblems(kind, m, head.length)).toEqual([]);
      const r = checkRow(kind, sample, m);
      expect(r.issues).toEqual([]);
      expect(r.value).not.toBeNull();
    }
  });
  it('says what is wrong with each field', () => {
    const head = ['sku', 'name', 'priceRetail', 'reorderLevel', 'trackExpiry', 'openingQty', 'openingCost', 'barcode'];
    const m = autoMap('products', head);
    const r = checkRow('products', ['', 'Milk', 'abc', '2.5', 'maybe', '5', '', 'a b!'], m);
    expect(r.value).toBeNull();
    expect(r.issues.map((x) => `${x.field}:${x.code}`).sort()).toEqual(['barcode:barcode', 'openingCost:required', 'priceRetail:number', 'reorderLevel:whole', 'sku:required', 'trackExpiry:yesNo']);
  });
  it('customer phones are tidied and checked', () => {
    const head = ['name', 'phone', 'type'];
    const m = autoMap('customers', head);
    expect((checkRow('customers', ['A', '+880 1712-345678', 'পাইকারি'], m).value as { phone: string; type: string }).phone).toBe('01712345678');
    expect(checkRow('customers', ['A', '12345', ''], m).issues[0]?.code).toBe('phone');
    expect(checkRow('customers', ['A', '', 'vip'], m).issues[0]?.code).toBe('choice');
  });
});
