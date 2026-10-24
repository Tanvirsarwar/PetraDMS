import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateByWeight, computePurchase, formatBoxPcs, groupBoxPcsItems, joinBoxPcs, marginBp, normalizeBoxPcs, splitBase } from './boxpcs';

const names = { boxName: 'Box', pcsName: 'Pcs' };

describe('box + pcs conversion', () => {
  it('splits and joins exactly', () => {
    expect(splitBase(126, 24)).toEqual({ box: 5, pcs: 6 });
    expect(splitBase(24, 24)).toEqual({ box: 1, pcs: 0 });
    expect(splitBase(23, 24)).toEqual({ box: 0, pcs: 23 });
    expect(splitBase(-126, 24)).toEqual({ box: -5, pcs: -6 });
    expect(joinBoxPcs(5, 6, 24)).toBe(126);
    expect(joinBoxPcs(0, 0, 24)).toBe(0);
  });

  it('moves whole boxes out of loose pieces without changing the quantity', () => {
    expect(normalizeBoxPcs(0, 30, 24)).toEqual({ box: 1, pcs: 6 });
    expect(normalizeBoxPcs(2, 48, 24)).toEqual({ box: 4, pcs: 0 });
  });

  it('rejects fractions, negatives and bad box sizes instead of rounding', () => {
    expect(() => joinBoxPcs(1.5, 0, 24)).toThrow();
    expect(() => joinBoxPcs(-1, 0, 24)).toThrow();
    expect(() => joinBoxPcs(1, 1, 0)).toThrow();
    expect(() => splitBase(1.2, 24)).toThrow();
  });

  it('property: split then join is the identity for any quantity and box size', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 1, max: 5000 }), (q, f) => {
      const { box, pcs } = splitBase(q, f);
      expect(pcs).toBeLessThan(f);
      expect(joinBoxPcs(box, pcs, f)).toBe(q);
    }), { numRuns: 500 });
  });

  it('formats "5 Box + 6 Pcs" for documents and "5 Box 6 Pcs" for stock, in both languages', () => {
    expect(formatBoxPcs(126, 24, names)).toBe('5 Box + 6 Pcs');
    expect(formatBoxPcs(126, 24, names, { sep: ' ' })).toBe('5 Box 6 Pcs');
    expect(formatBoxPcs(120, 24, names)).toBe('5 Box');
    expect(formatBoxPcs(6, 24, names)).toBe('6 Pcs');
    expect(formatBoxPcs(0, 24, names)).toBe('0 Pcs');
    expect(formatBoxPcs(7, 1, names)).toBe('7 Pcs');
    expect(formatBoxPcs(126, 24, { boxName: 'বক্স', pcsName: 'পিস' }, { bn: true })).toBe('৫ বক্স + ৬ পিস');
  });
});

describe('exact allocation', () => {
  it('never goes negative and always adds up (the case a remainder-to-last rule gets wrong)', () => {
    expect(allocateByWeight(1, [1, 1, 0])).toEqual([1, 0, 0]);
    expect(allocateByWeight(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateByWeight(7, [0, 0])).toEqual([0, 7]);
    expect(allocateByWeight(0, [3, 4])).toEqual([0, 0]);
  });
  it('property: parts are within one poisha of the exact share', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.array(fc.integer({ min: 0, max: 900_000 }), { minLength: 1, maxLength: 20 }), (total, w) => {
      const out = allocateByWeight(total, w);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      expect(out.every((x) => x >= 0)).toBe(true);
      const sum = w.reduce((a, b) => a + b, 0);
      if (sum > 0) w.forEach((x, i) => expect(Math.abs((out[i] as number) - (total * x) / sum)).toBeLessThan(1));
    }), { numRuns: 500 });
  });
});

describe('purchase arithmetic', () => {
  const line = { kind: 'normal' as const, factor: 24, costPerBox: 100_000 };

  it('prices boxes and pieces from the cost per box', () => {
    const r = computePurchase({ lines: [{ ...line, boxes: 5, pcs: 6 }] });
    expect(r.lines[0]).toMatchObject({ boxes: 5, pcs: 6, baseQty: 126, gross: 525_000, amount: 525_000, cost: 525_000 });
    expect(r.subtotal).toBe(525_000);
    expect(r.total).toBe(525_000);
    expect(r.totalBoxes).toBe(5);
    expect(r.totalPcs).toBe(6);
  });

  it('rounds the pieces part once, half up, and keeps the line amount exact (rule D22)', () => {
    // 100001 * 7 / 24 = 29166.958... -> 29167
    const r = computePurchase({ lines: [{ ...line, costPerBox: 100_001, boxes: 0, pcs: 7 }] });
    expect(r.lines[0]?.amount).toBe(29_167);
    // a whole box plus 6 pcs is the same as 30 pcs: normalising never changes the money
    const a = computePurchase({ lines: [{ ...line, costPerBox: 100_001, boxes: 0, pcs: 30 }] });
    const b = computePurchase({ lines: [{ ...line, costPerBox: 100_001, boxes: 1, pcs: 6 }] });
    expect(a.lines[0]?.amount).toBe(b.lines[0]?.amount);
    expect(a.lines[0]).toMatchObject({ boxes: 1, pcs: 6, baseQty: 30 });
  });

  it('free goods add stock and cost nothing', () => {
    const r = computePurchase({ lines: [{ ...line, boxes: 10, pcs: 0 }, { ...line, kind: 'free', boxes: 1, pcs: 3 }] });
    expect(r.lines[1]).toMatchObject({ baseQty: 27, gross: 0, amount: 0, cost: 0 });
    expect(r.baseQty).toBe(240 + 27);
    expect(r.total).toBe(1_000_000);
  });

  it('applies line discounts (percent in basis points, or fixed) before the bill discount', () => {
    const r = computePurchase({
      lines: [{ ...line, boxes: 10, pcs: 0, discKind: 'pct', discValue: 250 }, { ...line, boxes: 2, pcs: 0, discKind: 'fixed', discValue: 5_000 }],
      billDiscKind: 'pct', billDiscValue: 100
    });
    expect(r.lines[0]).toMatchObject({ gross: 1_000_000, discount: 25_000, amount: 975_000 });
    expect(r.lines[1]).toMatchObject({ gross: 200_000, discount: 5_000, amount: 195_000 });
    expect(r.subtotal).toBe(1_170_000);
    expect(r.discount).toBe(11_700);
    expect(r.total).toBe(1_158_300);
    expect(r.lines.reduce((a, l) => a + l.allocDiscount, 0)).toBe(11_700);
  });

  it('adds VAT and freight to the total and allocates them into stock cost exactly', () => {
    const r = computePurchase({ lines: [{ ...line, boxes: 3, pcs: 0 }, { ...line, factor: 12, costPerBox: 7_777, boxes: 1, pcs: 5 }], tax: 1_001, freight: 2_503 });
    expect(r.total).toBe(r.subtotal - r.discount + 1_001 + 2_503);
    expect(r.lines.reduce((a, l) => a + l.allocCharge, 0)).toBe(3_504);
    expect(r.lines.reduce((a, l) => a + l.cost, 0)).toBe(r.total);
  });

  it('property: cost of all lines always equals the bill total, whatever the mix', () => {
    const lineArb = fc.record({
      kind: fc.constantFrom('normal' as const, 'normal' as const, 'free' as const),
      factor: fc.integer({ min: 1, max: 48 }),
      boxes: fc.integer({ min: 0, max: 60 }),
      pcs: fc.integer({ min: 0, max: 80 }),
      costPerBox: fc.integer({ min: 0, max: 900_000 }),
      discKind: fc.constantFrom('pct' as const, 'fixed' as const, null),
      discValue: fc.integer({ min: 0, max: 5_000 })
    }).filter((l) => l.boxes + l.pcs > 0);
    fc.assert(fc.property(fc.array(lineArb, { minLength: 1, maxLength: 12 }), fc.constantFrom('pct' as const, 'fixed' as const, null), fc.integer({ min: 0, max: 900 }), fc.integer({ min: 0, max: 50_000 }), fc.integer({ min: 0, max: 50_000 }), (lines, bk, bv, tax, freight) => {
      const subtotal = computePurchase({ lines }).subtotal;
      const r = computePurchase({ lines, billDiscKind: bk, billDiscValue: bk === 'fixed' ? Math.min(bv, subtotal) : bv, tax, freight });
      expect(r.lines.reduce((a, l) => a + l.cost, 0)).toBe(r.total);
      expect(r.lines.reduce((a, l) => a + l.amount, 0)).toBe(r.subtotal);
      expect(r.lines.every((l) => l.allocDiscount <= l.amount && l.cost >= 0)).toBe(true);
      expect(r.total).toBe(r.subtotal - r.discount + tax + freight);
    }), { numRuns: 400 });
  });

  it('rejects an empty line, a fraction and a bad discount', () => {
    expect(() => computePurchase({ lines: [{ ...line, boxes: 0, pcs: 0 }] })).toThrow();
    expect(() => computePurchase({ lines: [{ ...line, boxes: 1.5, pcs: 0 }] })).toThrow();
    expect(() => computePurchase({ lines: [{ ...line, boxes: 1, pcs: 0 }], billDiscKind: 'fixed', billDiscValue: 200_000 })).toThrow();
    expect(() => computePurchase({ lines: [{ ...line, boxes: 1, pcs: 0, discKind: 'pct', discValue: 10_001 }] })).toThrow();
  });

  it('margin in basis points', () => {
    expect(marginBp(120_000, 100_000)).toBe(1667);
    expect(marginBp(0, 100)).toBeNull();
    expect(marginBp(90_000, 100_000)).toBe(-1111);
  });
});

describe('box + pcs totals for sales (per-product box size)', () => {
  it('adds the piece count when boxes are shown, for any box size', () => {
    const total = (pcs: string) => `${pcs} total`;
    expect(formatBoxPcs(29, 12, names, { total })).toBe('2 Box + 5 Pcs (29 Pcs total)');
    expect(formatBoxPcs(53, 24, names, { total })).toBe('2 Box + 5 Pcs (53 Pcs total)');
    expect(formatBoxPcs(96, 48, names, { total })).toBe('2 Box (96 Pcs total)');
    // pieces alone (or a product without a box) need no total
    expect(formatBoxPcs(5, 12, names, { total })).toBe('5 Pcs');
    expect(formatBoxPcs(29, 1, names, { total })).toBe('29 Pcs');
    expect(formatBoxPcs(29, 12, names, { total: (q) => `মোট ${q}`, bn: true })).toBe('২ Box + ৫ Pcs (মোট ২৯ Pcs)');
    // without the option the text is exactly as before
    expect(formatBoxPcs(29, 12, names)).toBe('2 Box + 5 Pcs');
  });

  it('groups a box line with the loose pieces after it, and nothing else', () => {
    const line = (productId: number, factor: number, kind: 'normal' | 'bonus' = 'normal') => ({ productId, factor, kind });
    const a = line(1, 12); const aPcs = line(1, 1); const b = line(2, 24); const bBonus = line(2, 1, 'bonus'); const c = line(3, 1); const cPcs = line(3, 1);
    expect(groupBoxPcsItems([a, aPcs, b, bBonus, c, cPcs])).toEqual([[a, aPcs], [b], [bBonus], [c], [cPcs]]);
    // pieces before the box, or a second loose line, start a new row
    expect(groupBoxPcsItems([aPcs, a])).toEqual([[aPcs], [a]]);
    expect(groupBoxPcsItems([a, aPcs, aPcs])).toEqual([[a, aPcs], [aPcs]]);
  });
});
