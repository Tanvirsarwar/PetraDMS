import { PetraError } from './errors';
import { mulDiv } from './money';

/**
 * Weighted-average cost of removing `q` base units from a product holding `stockQty` units
 * worth `stockValue` poisha. Integer-exact:
 *   cogs = round(stockValue * q / stockQty)
 * and when the stock reaches zero the entire remaining value is taken, so no remainder is stranded.
 */
export function costOut(stockQty: number, stockValue: number, q: number): number {
  if (!Number.isSafeInteger(q) || q <= 0) throw new PetraError('INVALID_INPUT', 'quantity must be positive');
  if (stockQty <= 0) return 0;
  if (q > stockQty) throw new PetraError('NEGATIVE_STOCK', 'not enough stock', { available: stockQty, wanted: q });
  if (q === stockQty) return stockValue;
  return mulDiv(stockValue, q, stockQty);
}

/**
 * Cost for a removal that may exceed stock (only when the Owner allows negative stock).
 * The part covered by stock is costed at weighted average; the uncovered part is costed
 * at the last known purchase cost per base unit.
 */
export function costOutAllowNegative(stockQty: number, stockValue: number, q: number, lastUnitCost: number): { cogs: number; fromStockValue: number } {
  const avail = Math.max(stockQty, 0);
  const covered = Math.min(avail, q);
  const fromStock = covered > 0 ? costOut(stockQty, stockValue, covered) : 0;
  const uncovered = q - covered;
  return { cogs: fromStock + uncovered * lastUnitCost, fromStockValue: fromStock };
}

/**
 * Splits `total` across `n` buckets in proportion to `weights` using the
 * remainder-to-last rule, so the parts always add up to `total` exactly.
 */
export function splitProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) {
    const out = weights.map(() => 0);
    out[out.length - 1] = total;
    return out;
  }
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < weights.length - 1; i++) {
    const share = mulDiv(total, weights[i] as number, sum);
    out.push(share);
    used += share;
  }
  out.push(total - used);
  return out;
}

/**
 * Telescoping split for partial returns: returning `r` of `q` units from an amount `a`
 * gives round(a*r/q), computed cumulatively so that returning everything in pieces
 * restores exactly `a`.
 */
export function cumulativeShare(amount: number, returnedBefore: number, returningNow: number, totalQty: number): number {
  const after = returnedBefore + returningNow;
  if (after > totalQty) throw new PetraError('OVER_RETURN', 'returning more than was sold');
  const upTo = (r: number): number => (r === totalQty ? amount : mulDiv(amount, r, totalQty));
  return upTo(after) - upTo(returnedBefore);
}
