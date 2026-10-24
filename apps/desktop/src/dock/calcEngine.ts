/**
 * The dock calculator's arithmetic (v1.1.1, D23). Exact decimals, no floating point and no eval():
 * every number is a BigInt of units plus a decimal scale, so 0.1 + 0.2 is 0.3 and 1.005 * 100 is 100.5.
 *
 * Grammar (usual precedence, left to right):
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := ('-' | '+') unary | postfix
 *   postfix:= primary '%'?
 *   primary:= number | '(' expr ')'
 * Percent works like a shop calculator: "200 + 10%" is 220, "200 - 10%" is 180, "200 * 10%" is 20 and "10%" alone is 0.1.
 * Division keeps 20 decimal places internally; results are shown with at most 10.
 */

export interface Dec { n: bigint; s: number }
export type CalcError = 'syntax' | 'divzero' | 'overflow' | 'empty';
export type CalcResult = { ok: true; value: Dec; text: string } | { ok: false; error: CalcError };

const DIV_SCALE = 20;
const SHOW_SCALE = 10;
/** Largest magnitude shown (15 integer digits): beyond this the answer is "too large". */
const LIMIT = 10n ** 15n;

const pow10 = (k: number): bigint => 10n ** BigInt(k);
const align = (a: Dec, b: Dec): [bigint, bigint, number] => {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
};
/** Drop trailing zeros so scales stay small. */
function norm(d: Dec): Dec {
  let { n, s } = d;
  while (s > 0 && n % 10n === 0n) {
    n /= 10n;
    s -= 1;
  }
  return { n, s };
}
/** Round half away from zero to `scale` decimal places. */
export function roundDec(d: Dec, scale: number): Dec {
  if (d.s <= scale) return d;
  const f = pow10(d.s - scale);
  const neg = d.n < 0n;
  const abs = neg ? -d.n : d.n;
  let q = abs / f;
  if ((abs % f) * 2n >= f) q += 1n;
  return norm({ n: neg ? -q : q, s: scale });
}
export const add = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return norm({ n: x + y, s }); };
export const sub = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return norm({ n: x - y, s }); };
export const mul = (a: Dec, b: Dec): Dec => norm({ n: a.n * b.n, s: a.s + b.s });
export function div(a: Dec, b: Dec): Dec | null {
  if (b.n === 0n) return null;
  // a / b = (a.n / 10^a.s) / (b.n / 10^b.s); scale the numerator so the quotient carries DIV_SCALE + 1 places, then round
  const extra = DIV_SCALE + 1;
  const num = a.n * pow10(extra + b.s);
  const den = b.n * pow10(a.s);
  return roundDec({ n: num / den, s: extra }, DIV_SCALE);
}
const HUNDRED: Dec = { n: 100n, s: 0 };

export function parseDec(text: string): Dec | null {
  if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') return null;
  const [i = '', f = ''] = text.split('.');
  return norm({ n: BigInt((i || '0') + f), s: f.length });
}

export function formatDec(d: Dec, scale = SHOW_SCALE): string {
  const r = roundDec(d, scale);
  const neg = r.n < 0n;
  const abs = (neg ? -r.n : r.n).toString().padStart(r.s + 1, '0');
  const int = abs.slice(0, abs.length - r.s);
  const frac = r.s > 0 ? abs.slice(abs.length - r.s) : '';
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== '0' ? `-${out}` : out;
}

type Tok = { k: 'num'; v: Dec } | { k: 'op'; v: '+' | '-' | '*' | '/' | '%' | '(' | ')' };

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Bangla digits and the usual symbols (× ÷ −) are accepted as typed. */
export function normaliseInput(s: string): string {
  return s
    .replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)))
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/,/g, '');
}

function tokenize(src: string): Tok[] | null {
  const s = normaliseInput(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ') { i++; continue; }
    if (/[\d.]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j]!)) j++;
      const v = parseDec(s.slice(i, j));
      if (!v) return null;
      out.push({ k: 'num', v });
      i = j;
      continue;
    }
    if ('+-*/%()'.includes(c)) { out.push({ k: 'op', v: c as '+' }); i++; continue; }
    return null;
  }
  return out;
}

class Fail extends Error {
  constructor(readonly code: CalcError) { super(code); }
}

/** Evaluates an expression. Never throws; an unusable expression gives an error code. */
export function evaluate(src: string): CalcResult {
  if (src.trim() === '') return { ok: false, error: 'empty' };
  const toks = tokenize(src);
  if (!toks || toks.length === 0) return { ok: false, error: 'syntax' };
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.k === 'op' && t.v === v;

  const primary = (): Dec => {
    const t = peek();
    if (!t) throw new Fail('syntax');
    if (t.k === 'num') { p++; return t.v; }
    if (isOp(t, '(')) {
      p++;
      const v = expr();
      if (!isOp(peek(), ')')) throw new Fail('syntax');
      p++;
      return v;
    }
    throw new Fail('syntax');
  };
  // returns the value and whether it was written as a percentage (so + and - can take it as a share of the left side)
  const postfix = (): { v: Dec; pct: boolean } => {
    const v = primary();
    if (isOp(peek(), '%')) { p++; return { v, pct: true }; }
    return { v, pct: false };
  };
  const unary = (): { v: Dec; pct: boolean } => {
    if (isOp(peek(), '-')) { p++; const u = unary(); return { v: { n: -u.v.n, s: u.v.s }, pct: u.pct }; }
    if (isOp(peek(), '+')) { p++; return unary(); }
    return postfix();
  };
  const asValue = (u: { v: Dec; pct: boolean }): Dec => (u.pct ? (div(u.v, HUNDRED) as Dec) : u.v);
  const term = (): { v: Dec; pct: boolean } => {
    const first = unary();
    let acc = first;
    let single = true;
    while (isOp(peek(), '*') || isOp(peek(), '/')) {
      const op = (peek() as { v: string }).v;
      p++;
      const rhs = asValue(unary());
      const left = asValue(acc);
      if (op === '*') acc = { v: mul(left, rhs), pct: false };
      else {
        const q = div(left, rhs);
        if (!q) throw new Fail('divzero');
        acc = { v: q, pct: false };
      }
      single = false;
    }
    return single ? first : acc;
  };
  const expr = (): Dec => {
    let acc = asValue(term());
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = (peek() as { v: string }).v;
      p++;
      const t = term();
      // "a + b%" adds b percent of a
      const rhs = t.pct ? mul(acc, div(t.v, HUNDRED) as Dec) : t.v;
      acc = op === '+' ? add(acc, rhs) : sub(acc, rhs);
    }
    return acc;
  };

  try {
    const v = expr();
    if (p !== toks.length) return { ok: false, error: 'syntax' };
    const r = roundDec(v, DIV_SCALE);
    if ((r.n < 0n ? -r.n : r.n) >= LIMIT * pow10(r.s)) return { ok: false, error: 'overflow' };
    return { ok: true, value: r, text: formatDec(r) };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.code };
    return { ok: false, error: 'syntax' };
  }
}

/** The keys the dock calculator understands, from a keyboard event key. Anything else is ignored. */
export function calcKeyOf(key: string): string | null {
  const k = normaliseInput(key);
  if (/^[\d.+\-*/%()]$/.test(k)) return k;
  if (key === 'Enter' || key === '=') return '=';
  if (key === 'Backspace') return 'BACK';
  if (key === 'Delete') return 'C';
  return null;
}

/** Last results kept by the calculator. */
export const HISTORY_SIZE = 5;
export function pushHistory<T>(list: T[], item: T, size = HISTORY_SIZE): T[] {
  return [item, ...list].slice(0, size);
}
