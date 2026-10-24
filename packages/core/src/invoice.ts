import { PetraError } from './errors';
import { mulDiv, percentOf, roundToTaka } from './money';

export type DiscountKind = 'pct' | 'fixed';

export interface InvoiceLineInput {
  kind: 'normal' | 'bonus';
  /** Quantity at the chosen pack level. */
  qty: number;
  /** Price per ONE unit of the chosen pack level, in poisha. Bonus lines are always 0. */
  price: number;
  discKind?: DiscountKind | null;
  /** pct: basis points. fixed: poisha. */
  discValue?: number;
}

export interface InvoiceInput {
  lines: InvoiceLineInput[];
  discKind?: DiscountKind | null;
  discValue?: number;
  /** Single VAT percentage in basis points; 0 = off. */
  taxBp?: number;
  roundOff?: boolean;
}

export interface InvoiceLineResult {
  gross: number;
  discount: number;
  /** gross - discount, before the invoice-level discount. */
  amount: number;
  /** This line's share of the invoice-level discount. */
  allocDiscount: number;
  /** amount - allocDiscount: what the customer actually pays for this line (before tax). */
  net: number;
}

export interface InvoiceResult {
  lines: InvoiceLineResult[];
  subtotal: number;
  discount: number;
  tax: number;
  roundOff: number;
  total: number;
}

function lineDiscount(gross: number, kind: DiscountKind | null | undefined, value: number | undefined): number {
  if (!kind || !value) return 0;
  if (value < 0) throw new PetraError('INVALID_INPUT', 'discount cannot be negative');
  if (kind === 'pct') {
    if (value > 10000) throw new PetraError('INVALID_INPUT', 'discount cannot exceed 100%');
    return percentOf(gross, value);
  }
  return Math.min(value, gross);
}

/**
 * Allocates `discount` across lines in proportion to `amounts` (rounded once, half-up),
 * with the remainder on the last line that can take it. No line ever gets more than its amount.
 */
export function allocateDiscount(discount: number, amounts: number[]): number[] {
  const out = amounts.map(() => 0);
  const subtotal = amounts.reduce((a, b) => a + b, 0);
  if (discount === 0 || subtotal === 0) return out;
  const eligible = amounts.map((a, i) => (a > 0 ? i : -1)).filter((i) => i >= 0);
  const lastIdx = eligible[eligible.length - 1] as number;
  let used = 0;
  for (const i of eligible) {
    if (i === lastIdx) continue;
    const share = Math.min(mulDiv(discount, amounts[i] as number, subtotal), amounts[i] as number);
    out[i] = share;
    used += share;
  }
  let remainder = discount - used;
  out[lastIdx] = Math.min(remainder, amounts[lastIdx] as number);
  remainder -= out[lastIdx] as number;
  // Spill any overflow back onto earlier lines that still have room (very rare, only by a few poisha).
  for (let k = eligible.length - 1; k >= 0 && remainder > 0; k--) {
    const i = eligible[k] as number;
    const room = (amounts[i] as number) - (out[i] as number);
    const add = Math.min(room, remainder);
    out[i] = (out[i] as number) + add;
    remainder -= add;
  }
  return out;
}

export function computeInvoice(input: InvoiceInput): InvoiceResult {
  const base = input.lines.map((l) => {
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new PetraError('INVALID_INPUT', 'quantity must be a positive whole number');
    if (!Number.isSafeInteger(l.price) || l.price < 0) throw new PetraError('INVALID_INPUT', 'price must be a non-negative whole number of poisha');
    if (l.kind === 'bonus') return { gross: 0, discount: 0, amount: 0 };
    const gross = l.qty * l.price;
    if (!Number.isSafeInteger(gross)) throw new PetraError('INVALID_INPUT', 'amount out of range');
    const discount = lineDiscount(gross, l.discKind, l.discValue);
    return { gross, discount, amount: gross - discount };
  });

  const subtotal = base.reduce((a, l) => a + l.amount, 0);
  const discount = lineDiscountInvoice(subtotal, input.discKind, input.discValue);
  const alloc = allocateDiscount(discount, base.map((l) => l.amount));
  const lines: InvoiceLineResult[] = base.map((l, i) => ({
    ...l,
    allocDiscount: alloc[i] as number,
    net: l.amount - (alloc[i] as number)
  }));

  const taxable = subtotal - discount;
  const tax = input.taxBp ? percentOf(taxable, input.taxBp) : 0;
  const beforeRound = taxable + tax;
  const roundOff = input.roundOff ? roundToTaka(beforeRound) - beforeRound : 0;
  return { lines, subtotal, discount, tax, roundOff, total: beforeRound + roundOff };
}

function lineDiscountInvoice(subtotal: number, kind: DiscountKind | null | undefined, value: number | undefined): number {
  return lineDiscount(subtotal, kind, value);
}
