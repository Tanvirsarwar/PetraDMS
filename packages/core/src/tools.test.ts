import { describe, it, expect } from 'vitest';
import { SearchIndex, calcInitial, calcPress, calcKeyFromEvent, editDistance, normalize, type CalcKey, type SearchDoc } from './index';

const run = (keys: CalcKey[]) => keys.reduce(calcPress, calcInitial);

describe('search index', () => {
  const docs: SearchDoc[] = [
    { kind: 'product', id: 1, title: 'Marks Milk Powder 500g', subtitle: 'MLK', text: ['Marks Milk Powder 500g', 'মার্কস গুঁড়া দুধ', 'MLK', '8901234567890'], weight: 4 },
    { kind: 'product', id: 2, title: 'Sylon Tea 400g', subtitle: 'TEA', text: ['Sylon Tea 400g', 'চা পাতা', 'TEA'], weight: 4 },
    { kind: 'customer', id: 3, title: 'Karim Store', subtitle: '01711111111', text: ['Karim Store', 'করিম স্টোর', '01711111111', 'Zindabazar'], weight: 3 },
    { kind: 'sale', id: 4, title: 'INV-000123', subtitle: '2026-10-01', text: ['INV-000123', 'Karim Store'], weight: 1 }
  ];
  const idx = new SearchIndex();
  idx.build(docs);
  const top = (q: string) => idx.search(q, 5).map((h) => `${h.kind}:${h.id}`);

  it('finds by prefix, infix, barcode, phone, document number and Bangla', () => {
    expect(top('mar')[0]).toBe('product:1');
    expect(top('milk pow')[0]).toBe('product:1');
    expect(top('ilk')).toContain('product:1'); // middle of a word
    expect(top('8901234567890')[0]).toBe('product:1');
    expect(top('01711111111')[0]).toBe('customer:3');
    expect(top('inv-000123')[0]).toBe('sale:4');
    expect(top('দুধ')[0]).toBe('product:1');
    expect(top('করিম')[0]).toBe('customer:3');
  });

  it('tolerates a typo and Bangla digits, and respects the kind filter', () => {
    expect(top('sylom tea')[0]).toBe('product:2');
    expect(top('milc')[0]).toBe('product:1');
    expect(top('০১৭১১১১১১১১১')[0]).toBe('customer:3');
    expect(idx.search('karim', 5, (k) => k === 'product')).toHaveLength(0);
    expect(idx.search('', 5)).toHaveLength(0);
    expect(idx.search('zzzzqq', 5)).toHaveLength(0);
  });

  it('helpers behave', () => {
    expect(normalize('  Ｍilk—Powder! ')).toBe('milk powder');
    expect(editDistance('tea', 'tae', 2)).toBe(1);
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBeGreaterThan(2);
  });
});

describe('calculator', () => {
  it('does arithmetic without floating drift', () => {
    expect(run(['0', '.', '1', '+', '0', '.', '2', '=']).display).toBe('0.3');
    expect(run(['1', '2', '*', '3', '=']).display).toBe('36');
    expect(run(['1', '0', '/', '4', '=']).display).toBe('2.5');
    expect(run(['5', '-', '8', '=']).display).toBe('-3');
  });

  it('chains operators, percent, backspace, negate, clear', () => {
    expect(run(['2', '+', '3', '*', '4', '=']).display).toBe('20'); // left to right, like a pocket calculator
    expect(run(['2', '0', '0', '+', '1', '0', '%', '=']).display).toBe('220');
    expect(run(['2', '0', '0', '-', '1', '0', '%', '=']).display).toBe('180');
    expect(run(['5', '0', '%']).display).toBe('0.5');
    expect(run(['1', '2', '3', 'BACK']).display).toBe('12');
    expect(run(['7', 'NEG']).display).toBe('-7');
    expect(run(['9', '+', '1', 'C']).display).toBe('0');
  });

  it('division by zero is an error that clears on the next key', () => {
    const s = run(['5', '/', '0', '=']);
    expect(s.error).toBe(true);
    expect(calcPress(s, '4').display).toBe('4');
  });

  it('memory and history', () => {
    let s = run(['5', '0', 'M+', 'C', '2', '0', 'M-']);
    s = calcPress(calcPress(s, 'C'), 'MR');
    expect(s.display).toBe('30');
    expect(calcPress(s, 'MC').memory).toBe(0);
    let h = calcInitial;
    for (let i = 1; i <= 12; i++) h = (['1', '+', String(i % 10), '='] as CalcKey[]).reduce(calcPress, h);
    expect(h.history).toHaveLength(10);
  });

  it('maps keyboard keys', () => {
    expect(calcKeyFromEvent('7')).toBe('7');
    expect(calcKeyFromEvent('*')).toBe('*');
    expect(calcKeyFromEvent('Enter')).toBe('=');
    expect(calcKeyFromEvent('Backspace')).toBe('BACK');
    expect(calcKeyFromEvent('c')).toBe('C');
    expect(calcKeyFromEvent('Escape')).toBeNull(); // Escape closes the panel instead
    expect(calcKeyFromEvent('q')).toBeNull();
  });
});
