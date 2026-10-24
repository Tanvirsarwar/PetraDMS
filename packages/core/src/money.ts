import { PetraError } from './errors';

/** All money is an integer number of poisha (1 taka = 100 poisha). Never floats. */
export type Poisha = number;

export function assertInt(n: number, label = 'value'): number {
  if (!Number.isSafeInteger(n)) throw new PetraError('INVALID_INPUT', `${label} must be an integer`, { field: label });
  return n;
}

/**
 * round-half-up (half away from zero for negatives) of a*b/c using BigInt for the product,
 * so large stock values times large quantities never lose precision.
 */
export function mulDiv(a: number, b: number, c: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  assertInt(c, 'c');
  if (c === 0) throw new PetraError('INVALID_INPUT', 'division by zero');
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  let bigC = BigInt(c);
  let num = bigA * bigB;
  if (bigC < 0n) {
    bigC = -bigC;
    num = -num;
  }
  const neg = num < 0n;
  const absNum = neg ? -num : num;
  const q = (2n * absNum + bigC) / (2n * bigC);
  const res = neg ? -q : q;
  const out = Number(res);
  if (!Number.isSafeInteger(out)) throw new PetraError('INVALID_INPUT', 'amount out of range');
  return out;
}

/** Basis points: 100 bp = 1%. */
export function percentOf(amount: Poisha, bp: number): Poisha {
  return mulDiv(amount, bp, 10000);
}

/** Rounds an amount to the nearest whole taka (100 poisha), half-up. */
export function roundToTaka(amount: Poisha): Poisha {
  return mulDiv(amount, 1, 100) * 100;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBnDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] as string);
}

export function fromBnDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

export interface MoneyFormatOptions {
  grouping?: 'lakh' | 'intl';
  bnDigits?: boolean;
  symbol?: boolean;
  /** Always show two decimals (used on printed invoices and ledgers). */
  fixedDecimals?: boolean;
}

export function groupDigits(whole: string, grouping: 'lakh' | 'intl'): string {
  if (whole.length <= 3) return whole;
  if (grouping === 'intl') return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/** `700750` -> `৳7,007.50`; lakh grouping by default (`৳1,00,000`). */
export function formatMoney(amount: Poisha, opts: MoneyFormatOptions = {}): string {
  const { grouping = 'lakh', bnDigits = false, symbol = true, fixedDecimals = false } = opts;
  assertInt(amount, 'amount');
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let s = groupDigits(String(whole), grouping);
  if (frac !== 0 || fixedDecimals) s += '.' + String(frac).padStart(2, '0');
  if (bnDigits) s = toBnDigits(s);
  return (neg ? '-' : '') + (symbol ? '৳' : '') + s;
}

/** Plain integer formatting with grouping (quantities). */
export function formatInt(n: number, opts: Pick<MoneyFormatOptions, 'grouping' | 'bnDigits'> = {}): string {
  const { grouping = 'lakh', bnDigits = false } = opts;
  assertInt(n, 'n');
  const s = (n < 0 ? '-' : '') + groupDigits(String(Math.abs(n)), grouping);
  return bnDigits ? toBnDigits(s) : s;
}

/**
 * Parses user input such as `1,250.5`, `৳ ১,২৫০.৫০` or `250` into poisha.
 * Returns null when the text is not a valid amount with at most two decimals.
 */
export function parseMoney(text: string): Poisha | null {
  const cleaned = fromBnDigits(text).replace(/[৳,\s]/g, '').replace(/^Tk\.?/i, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const neg = cleaned.startsWith('-');
  const body = neg ? cleaned.slice(1) : cleaned;
  const [w = '0', f = ''] = body.split('.');
  const poisha = Number(w) * 100 + Number(f.padEnd(2, '0'));
  if (!Number.isSafeInteger(poisha)) return null;
  return neg ? -poisha : poisha;
}
