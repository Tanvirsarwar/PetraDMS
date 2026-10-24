import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  mulDiv, percentOf, formatMoney, parseMoney, roundToTaka, toBnDigits, formatInt,
  decomposeStock, formatStock, toBaseQty,
  costOut, splitProportional, cumulativeShare,
  computeInvoice, allocateDiscount,
  computeDueAging, bucketFor, daysBetween,
  businessDateFor, addDays, isIsoDate, formatDate,
  PetraError
} from './index';

describe('money', () => {
  it('rounds half-up and half away from zero for negatives', () => {
    expect(mulDiv(5, 1, 2)).toBe(3);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
    expect(mulDiv(4, 1, 3)).toBe(1);
    expect(mulDiv(10, 1, 3)).toBe(3);
    expect(percentOf(10000, 1250)).toBe(1250);
  });

  it('is exact where float math would overflow 2^53', () => {
    expect(mulDiv(9_000_000_000_000, 3, 3)).toBe(9_000_000_000_000);
    expect(mulDiv(4_000_000_000_000, 4_000_000, 4_000_000)).toBe(4_000_000_000_000);
  });

  it('formats with lakh grouping by default', () => {
    expect(formatMoney(10_000_000)).toBe('৳1,00,000');
    expect(formatMoney(707_750)).toBe('৳7,077.50');
    expect(formatMoney(12_345_678_900)).toBe('৳12,34,56,789');
    expect(formatMoney(-250_00)).toBe('-৳250');
    expect(formatMoney(100_000_000, { grouping: 'intl' })).toBe('৳1,000,000');
    expect(formatMoney(123_456, { bnDigits: true })).toBe('৳১,২৩৪.৫৬');
    expect(formatMoney(500, { fixedDecimals: true, symbol: false })).toBe('5.00');
    expect(formatInt(1234567)).toBe('12,34,567');
  });

  it('parses user input in English and Bangla digits', () => {
    expect(parseMoney('1,250.5')).toBe(125_050);
    expect(parseMoney('৳ ১,২৫০.৫০')).toBe(125_050);
    expect(parseMoney('250')).toBe(25_000);
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(toBnDigits('2026')).toBe('২০২৬');
  });

  it('parse(format(x)) round-trips', () => {
    fc.assert(fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (n) => {
      expect(parseMoney(formatMoney(n, { fixedDecimals: true }))).toBe(n);
    }));
  });

  it('rounds to whole taka', () => {
    expect(roundToTaka(10_049)).toBe(10_000);
    expect(roundToTaka(10_050)).toBe(10_100);
  });
});

describe('units', () => {
  const levels = [
    { id: 1, name: 'Piece', factor: 1 },
    { id: 2, name: 'Small Box', factor: 12 },
    { id: 3, name: 'Big Box', factor: 24 * 12 }
  ];

  it('decomposes stock greedily from the largest level', () => {
    expect(formatStock(12 * 288 + 7 * 12 + 11, levels)).toBe('12 Big Box 7 Small Box 11 Piece');
    expect(formatStock(12 * 288 + 7 * 12 + 11, levels, undefined, ', ')).toBe('12 Big Box, 7 Small Box, 11 Piece');
  });

  it('round-trips', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5_000_000 }), (n) => {
      const parts = decomposeStock(n, levels);
      expect(parts.reduce((a, p) => a + p.qty * p.level.factor, 0)).toBe(n);
    }));
  });

  it('handles zero and negative stock', () => {
    expect(formatStock(0, levels)).toBe('0 Piece');
    expect(decomposeStock(-25, levels).map((p) => p.qty)).toEqual([-2, -1]);
  });

  it('rejects fractional quantities', () => {
    expect(() => toBaseQty(1.5, 12)).toThrow(PetraError);
    expect(toBaseQty(3, 12)).toBe(36);
  });
});

describe('costing', () => {
  it('takes the exact remaining value when stock reaches zero', () => {
    expect(costOut(3, 1000, 3)).toBe(1000);
    expect(costOut(3, 1000, 1)).toBe(333);
  });

  it('never strands a remainder across a sequence of sales', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: 5_000_000 }),
      fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 80 }),
      (qty, value, takes) => {
        let q = qty; let v = value; let cogsTotal = 0;
        for (const t of takes) {
          if (t > q) break;
          const c = costOut(q, v, t);
          expect(c).toBeGreaterThanOrEqual(0);
          cogsTotal += c; q -= t; v -= c;
        }
        if (q === 0) expect(v).toBe(0);
        expect(cogsTotal + v).toBe(value);
      }
    ));
  });

  it('rejects removing more than is in stock', () => {
    expect(() => costOut(2, 100, 3)).toThrow(PetraError);
  });

  it('split is exact', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 1_000_000 }), fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 12 }),
      (total, weights) => {
        expect(splitProportional(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
      }
    ));
  });

  it('cumulative returns telescope to the original amount', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 60 }),
      (amount, qty) => {
        let returned = 0; let got = 0;
        for (let i = 0; i < qty; i++) { got += cumulativeShare(amount, returned, 1, qty); returned++; }
        expect(got).toBe(amount);
      }
    ));
  });
});

describe('invoice', () => {
  it('computes lines, discounts, tax and round-off', () => {
    const r = computeInvoice({
      lines: [
        { kind: 'normal', qty: 10, price: 52_000 },
        { kind: 'normal', qty: 5, price: 45_000, discKind: 'pct', discValue: 500 },
        { kind: 'bonus', qty: 2, price: 0 }
      ],
      discKind: 'fixed', discValue: 10_000, taxBp: 500, roundOff: true
    });
    expect(r.subtotal).toBe(520_000 + 213_750);
    expect(r.discount).toBe(10_000);
    expect(r.lines[2]).toMatchObject({ amount: 0, allocDiscount: 0, net: 0 });
    expect(r.total).toBe(r.subtotal - r.discount + r.tax + r.roundOff);
    expect(r.total % 100).toBe(0);
  });

  it('sum of line nets always equals subtotal - discount; allocations stay within each line', () => {
    const line = fc.record({
      kind: fc.constantFrom('normal' as const, 'bonus' as const),
      qty: fc.integer({ min: 1, max: 500 }),
      price: fc.integer({ min: 0, max: 500_000 }),
      discKind: fc.constantFrom('pct' as const, 'fixed' as const, null),
      discValue: fc.integer({ min: 0, max: 20_000 })
    });
    fc.assert(fc.property(
      fc.array(line, { minLength: 1, maxLength: 10 }),
      fc.constantFrom('pct' as const, 'fixed' as const, null), fc.integer({ min: 0, max: 10_000 }),
      fc.integer({ min: 0, max: 1500 }), fc.boolean(),
      (lines, discKind, discValue, taxBp, roundOff) => {
        const fixedLines = lines.map((l) => ({ ...l, discValue: l.discKind === 'pct' ? Math.min(l.discValue, 10_000) : l.discValue }));
        const invDisc = discKind === 'pct' ? Math.min(discValue, 10_000) : discValue * 100;
        const r = computeInvoice({ lines: fixedLines, discKind, discValue: invDisc, taxBp, roundOff });
        expect(r.lines.reduce((a, l) => a + l.net, 0)).toBe(r.subtotal - r.discount);
        expect(r.lines.reduce((a, l) => a + l.allocDiscount, 0)).toBe(r.discount);
        for (const l of r.lines) { expect(l.allocDiscount).toBeGreaterThanOrEqual(0); expect(l.allocDiscount).toBeLessThanOrEqual(l.amount); }
        expect(r.total).toBe(r.subtotal - r.discount + r.tax + r.roundOff);
        if (roundOff) expect(r.total % 100).toBe(0);
      }
    ));
  });

  it('allocation puts the remainder on the last line', () => {
    expect(allocateDiscount(100, [100, 100, 100])).toEqual([33, 33, 34]);
  });

  it('rejects bad input', () => {
    expect(() => computeInvoice({ lines: [{ kind: 'normal', qty: 0, price: 1 }] })).toThrow(PetraError);
    expect(() => computeInvoice({ lines: [{ kind: 'normal', qty: 1, price: 1.5 }] })).toThrow(PetraError);
    expect(() => computeInvoice({ lines: [{ kind: 'normal', qty: 1, price: 100 }], discKind: 'pct', discValue: 10_001 })).toThrow(PetraError);
  });
});

describe('aging', () => {
  it('applies credits to the oldest invoices first', () => {
    const r = computeDueAging(
      [{ ref: 'a', date: '2026-05-01', amount: 1000 }, { ref: 'b', date: '2026-08-20', amount: 500 }, { ref: 'c', date: '2026-09-25', amount: 300 }],
      1200, '2026-10-01'
    );
    expect(r.total).toBe(600);
    expect(r.open.map((o) => [o.ref, o.remaining])).toEqual([['b', 300], ['c', 300]]);
    expect(r.buckets['31-60']).toBe(300);
    expect(r.buckets['0-30']).toBe(300);
  });

  it('reports advance when credits exceed debits', () => {
    expect(computeDueAging([{ ref: 'a', date: '2026-09-01', amount: 100 }], 400, '2026-10-01')).toMatchObject({ total: 0, advance: 300 });
  });

  it('buckets by age', () => {
    expect([0, 30, 31, 60, 61, 90, 91].map(bucketFor)).toEqual(['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+']);
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
  });
});

describe('business date', () => {
  it('keeps late-night trading on the previous business day', () => {
    expect(businessDateFor(new Date(2026, 9, 7, 1, 30))).toBe('2026-10-06');
    expect(businessDateFor(new Date(2026, 9, 7, 9, 0))).toBe('2026-10-07');
  });
  it('moves past a closed day', () => {
    expect(businessDateFor(new Date(2026, 9, 7, 1, 30), 4, '2026-10-06')).toBe('2026-10-07');
  });
  it('date helpers', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(formatDate('2026-10-06')).toBe('06/10/2026');
  });
});
