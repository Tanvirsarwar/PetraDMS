import { PetraError } from './errors';
import { mulDiv, percentOf, toBnDigits } from './money';
import { allocateDiscount, type DiscountKind } from './invoice';

/**
 * Box + pieces arithmetic (v1.1). A "box" is any pack level of a product (carton, dozen, box);
 * `factor` is how many base units (pieces) are in one. Quantity is always stored in base units.
 */
export interface BoxPcs {
  box: number;
  pcs: number;
}

/** 126 base units in boxes of 24 -> 5 box + 6 pcs. Negative quantities keep the sign on both parts. */
export function splitBase(baseQty: number, factor: number): BoxPcs {
  if (!Number.isSafeInteger(baseQty) || !Number.isSafeInteger(factor) || factor < 1) throw new PetraError('INVALID_INPUT', 'quantity and box size must be whole numbers');
  const sign = baseQty < 0 ? -1 : 1;
  const abs = Math.abs(baseQty);
  const box = Math.floor(abs / factor);
  return { box: box * sign, pcs: (abs - box * factor) * sign };
}

/** 5 box + 6 pcs in boxes of 24 -> 126. Exact; throws instead of rounding. */
export function joinBoxPcs(box: number, pcs: number, factor: number): number {
  if (!Number.isSafeInteger(box) || !Number.isSafeInteger(pcs) || !Number.isSafeInteger(factor) || factor < 1 || box < 0 || pcs < 0) {
    throw new PetraError('INVALID_INPUT', 'box and pieces must be whole numbers');
  }
  const base = box * factor + pcs;
  if (!Number.isSafeInteger(base)) throw new PetraError('INVALID_INPUT', 'quantity out of range');
  return base;
}

/** Moves whole boxes out of the pieces: 0 box + 30 pcs (24 per box) -> 1 box + 6 pcs. The base quantity is unchanged. */
export function normalizeBoxPcs(box: number, pcs: number, factor: number): BoxPcs {
  return splitBase(joinBoxPcs(box, pcs, factor), factor);
}

export interface UnitNames {
  boxName: string;
  pcsName: string;
}

/**
 * "5 Box + 6 Pcs" (invoices, GRN) or "5 Box 6 Pcs" (stock). A zero part is left out; zero stock is "0 Pcs".
 * `bn` converts digits to Bangla. The names come from the product's pack and base unit.
 * `total` adds the piece count when boxes are shown: `total('126 Pcs')` -> "5 Box + 6 Pcs (126 Pcs total)".
 */
export function formatBoxPcs(baseQty: number, factor: number, names: UnitNames, opts: { sep?: ' + ' | ' '; bn?: boolean; total?: (pcs: string) => string } = {}): string {
  const { box, pcs } = splitBase(baseQty, factor);
  const sep = opts.sep ?? ' + ';
  const digits = (n: number): string => (opts.bn ? toBnDigits(String(n)) : String(n));
  const parts: string[] = [];
  if (factor > 1 && box !== 0) parts.push(`${digits(box)} ${names.boxName}`);
  if (factor > 1) {
    if (pcs !== 0) parts.push(`${digits(pcs)} ${names.pcsName}`);
  } else {
    parts.push(`${digits(baseQty)} ${names.pcsName}`);
  }
  if (parts.length === 0) return `${digits(0)} ${names.pcsName}`;
  const text = parts.join(sep);
  return opts.total && factor > 1 && box !== 0 ? `${text} (${opts.total(`${digits(baseQty)} ${names.pcsName}`)})` : text;
}

/** The fields of a sale line needed to group it with the loose pieces that follow it. */
export interface GroupableSaleItem {
  productId: number;
  kind: 'normal' | 'bonus';
  factor: number;
}

/**
 * A box line followed by loose pieces of the same product and kind was one "2 Box + 5 Pcs" line at the counter
 * (the engine stores it as two). Returns the groups in order; every other line is a group of one.
 */
export function groupBoxPcsItems<T extends GroupableSaleItem>(items: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const it of items) {
    const prev = groups[groups.length - 1];
    const head = prev?.[0];
    if (prev && head && prev.length === 1 && head.productId === it.productId && head.kind === it.kind && head.factor > 1 && it.factor === 1) prev.push(it);
    else groups.push([it]);
  }
  return groups;
}

/**
 * Largest-remainder split: parts are proportional to `weights`, never negative, and add up to `total` exactly.
 * (Used for VAT and freight, where a "remainder to the last line" rule could go negative with half-up rounding.)
 * With all weights zero the whole amount goes to the last line.
 */
export function allocateByWeight(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new PetraError('INVALID_INPUT', 'amount must be a non-negative whole number of poisha');
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map(() => 0);
  if (sum === 0) {
    out[n - 1] = total;
    return out;
  }
  const bigTotal = BigInt(total);
  const bigSum = BigInt(sum);
  const rem: bigint[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    const num = bigTotal * BigInt(w);
    out[i] = Number(num / bigSum);
    rem.push(num % bigSum);
    used += out[i] as number;
  });
  let left = total - used;
  const order = weights.map((_, i) => i).sort((a, b) => (rem[b] as bigint) > (rem[a] as bigint) ? 1 : (rem[b] as bigint) < (rem[a] as bigint) ? -1 : a - b);
  for (const i of order) {
    if (left === 0) break;
    out[i] = (out[i] as number) + 1;
    left--;
  }
  return out;
}

// ===== Purchase arithmetic =====

export interface PurchaseCalcLine {
  kind: 'normal' | 'free';
  /** Pieces per box of the pack the cost is quoted in (1 when the product has no box). */
  factor: number;
  boxes: number;
  pcs: number;
  /** Cost of ONE box in poisha (per piece when factor is 1). */
  costPerBox: number;
  discKind?: DiscountKind | null;
  /** pct: basis points. fixed: poisha. */
  discValue?: number;
}

export interface PurchaseCalcInput {
  lines: PurchaseCalcLine[];
  billDiscKind?: DiscountKind | null;
  billDiscValue?: number;
  /** VAT or any other charge on the bill, in poisha. It is part of the stock cost. */
  tax?: number;
  /** Freight / extra cost on the bill, in poisha. It is part of the stock cost. */
  freight?: number;
}

export interface PurchaseCalcLineResult {
  boxes: number;
  pcs: number;
  baseQty: number;
  /** boxes * cost + the pieces part, rounded ONCE half-up (see DECISIONS D22). */
  gross: number;
  discount: number;
  /** gross - discount: the stored line amount. */
  amount: number;
  allocDiscount: number;
  allocCharge: number;
  /** What the goods cost on the shelf: amount - allocDiscount + allocCharge. */
  cost: number;
}

export interface PurchaseCalcResult {
  lines: PurchaseCalcLineResult[];
  totalBoxes: number;
  totalPcs: number;
  baseQty: number;
  subtotal: number;
  discount: number;
  tax: number;
  freight: number;
  total: number;
}

/**
 * The single source of purchase arithmetic, used by the screen (live summary) and by the posting engine.
 * Rounding rule: the only rounding in a line is the pieces part, `round_half_up(costPerBox * pcs / factor)`,
 * done once on the whole line. The stored line amount is authoritative; stock value is built from amounts,
 * never from a rounded per-piece cost, so stock value, ledger and cash always add up to the poisha.
 */
export function computePurchase(input: PurchaseCalcInput): PurchaseCalcResult {
  const base = input.lines.map((l) => {
    if (!Number.isSafeInteger(l.factor) || l.factor < 1) throw new PetraError('INVALID_INPUT', 'box size must be a whole number of at least 1', { field: 'factor' });
    if (!Number.isSafeInteger(l.boxes) || !Number.isSafeInteger(l.pcs) || l.boxes < 0 || l.pcs < 0) throw new PetraError('INVALID_INPUT', 'box and pieces must be whole numbers', { field: 'qty' });
    if (l.boxes === 0 && l.pcs === 0) throw new PetraError('INVALID_INPUT', 'quantity must be positive', { field: 'qty' });
    if (!Number.isSafeInteger(l.costPerBox) || l.costPerBox < 0) throw new PetraError('INVALID_INPUT', 'cost must be a non-negative whole number of poisha', { field: 'unitCost' });
    const n = normalizeBoxPcs(l.boxes, l.pcs, l.factor);
    const baseQty = joinBoxPcs(n.box, n.pcs, l.factor);
    if (l.kind === 'free') return { boxes: n.box, pcs: n.pcs, baseQty, gross: 0, discount: 0, amount: 0 };
    const gross = n.box * l.costPerBox + (n.pcs > 0 ? mulDiv(l.costPerBox, n.pcs, l.factor) : 0);
    if (!Number.isSafeInteger(gross)) throw new PetraError('INVALID_INPUT', 'amount out of range');
    let discount = 0;
    if (l.discKind && l.discValue) {
      if (l.discValue < 0) throw new PetraError('INVALID_INPUT', 'discount cannot be negative', { field: 'discount' });
      if (l.discKind === 'pct') {
        if (l.discValue > 10000) throw new PetraError('INVALID_INPUT', 'discount cannot exceed 100%', { field: 'discount' });
        discount = percentOf(gross, l.discValue);
      } else discount = Math.min(l.discValue, gross);
    }
    return { boxes: n.box, pcs: n.pcs, baseQty, gross, discount, amount: gross - discount };
  });

  const subtotal = base.reduce((a, l) => a + l.amount, 0);
  let discount = 0;
  if (input.billDiscKind && input.billDiscValue) {
    if (input.billDiscValue < 0) throw new PetraError('INVALID_INPUT', 'discount cannot be negative', { field: 'discount' });
    if (input.billDiscKind === 'pct') {
      if (input.billDiscValue > 10000) throw new PetraError('INVALID_INPUT', 'discount cannot exceed 100%', { field: 'discount' });
      discount = percentOf(subtotal, input.billDiscValue);
    } else {
      if (input.billDiscValue > subtotal) throw new PetraError('INVALID_INPUT', 'discount is more than the bill', { field: 'discount' });
      discount = input.billDiscValue;
    }
  }
  const tax = input.tax ?? 0;
  const freight = input.freight ?? 0;
  if (!Number.isSafeInteger(tax) || tax < 0) throw new PetraError('INVALID_INPUT', 'charge must be a non-negative whole number of poisha', { field: 'tax' });
  if (!Number.isSafeInteger(freight) || freight < 0) throw new PetraError('INVALID_INPUT', 'freight must be a non-negative whole number of poisha', { field: 'freight' });

  const allocDisc = allocateDiscount(discount, base.map((l) => l.amount));
  const afterDisc = base.map((l, i) => l.amount - (allocDisc[i] as number));
  // Charges follow value: each line carries its share of the money actually paid for goods; the last line takes the remainder.
  const charges = tax + freight;
  const allocCharge = base.length === 0 ? [] : allocateByWeight(charges, afterDisc);

  const lines: PurchaseCalcLineResult[] = base.map((l, i) => ({
    ...l,
    allocDiscount: allocDisc[i] as number,
    allocCharge: allocCharge[i] as number,
    cost: (afterDisc[i] as number) + (allocCharge[i] as number)
  }));
  return {
    lines,
    totalBoxes: lines.reduce((a, l) => a + l.boxes, 0),
    totalPcs: lines.reduce((a, l) => a + l.pcs, 0),
    baseQty: lines.reduce((a, l) => a + l.baseQty, 0),
    subtotal, discount, tax, freight,
    total: subtotal - discount + tax + freight
  };
}

/**
 * Selling-price margin for the "update selling prices" step: (price - cost) / price in basis points,
 * null when there is no price. Cost and price are per the SAME unit.
 */
export function marginBp(price: number, cost: number): number | null {
  if (!Number.isSafeInteger(price) || !Number.isSafeInteger(cost) || price <= 0) return null;
  return mulDiv(price - cost, 10000, price);
}
