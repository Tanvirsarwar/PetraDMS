import { computeInvoice, fromBnDigits, type CustomerDto, type InvoiceResult, type PriceTier, type ProductDto } from '@petra/core';

export interface CartLine {
  key: number;
  productId: number;
  packId: number;
  /** Units of the chosen pack (boxes when the pack is a box). */
  qty: number | null;
  /** Price per ONE unit of the chosen pack, in poisha. */
  price: number | null;
  /** Loose pieces beside the boxes ("2 Box 5 Pcs"); only used when the chosen pack is a box. */
  pcs?: number | null;
  /** Price per ONE piece for the loose part, in poisha. */
  pcsPrice?: number | null;
  discKind: 'pct' | 'fixed' | null;
  /** pct: basis points. fixed: poisha. */
  discValue: number;
  kind: 'normal' | 'bonus';
}

export interface CartState {
  customerId: number | null;
  lines: CartLine[];
  discKind: 'pct' | 'fixed' | null;
  discValue: number;
  /** null = untouched, follow the default. */
  paid: number | null;
  accountId: number | null;
  note: string;
}

export const emptyCart = (): CartState => ({ customerId: null, lines: [], discKind: null, discValue: 0, paid: null, accountId: null, note: '' });

export function baseQtyOf(p: ProductDto, packId: number, qty: number | null): number {
  const pack = p.packs.find((k) => k.id === packId);
  return (qty ?? 0) * (pack?.factor ?? 1);
}

/** Tier price per ONE unit of a pack: the pack's own price when set, otherwise the per-base price times the factor. */
export function tierPriceOf(p: ProductDto, packId: number, tier: PriceTier): number {
  const pack = p.packs.find((k) => k.id === packId) ?? p.packs[0];
  const base = tier === 'retail' ? p.priceRetail : tier === 'wholesale' ? p.priceWholesale : p.priceDealer;
  if (!pack) return base;
  const own = tier === 'retail' ? pack.priceRetail : tier === 'wholesale' ? pack.priceWholesale : pack.priceDealer;
  return own ?? base * pack.factor;
}

export function basePackOf(p: ProductDto): number {
  return (p.packs.find((k) => k.factor === 1) ?? p.packs[0])!.id;
}

/** The unit a new line starts in: the product's default sale unit, else the base unit. */
export function defaultSalePackOf(p: ProductDto): number {
  return p.defaultSalePackId && p.packs.some((k) => k.id === p.defaultSalePackId) ? p.defaultSalePackId : basePackOf(p);
}

/**
 * "2b5", "2 box 5", "2+5", "২ব৫" -> 2 boxes and 5 pieces. Plain digits are boxes only. Null when it is not a quantity.
 */
export function parseBoxPcs(text: string): { box: number; pcs: number | null } | null {
  const s = fromBnDigits(text).trim().toLowerCase();
  if (s === '') return null;
  if (/^\d{1,9}$/.test(s)) return { box: Number(s), pcs: null };
  const m = /^(\d{1,9})\s*(?:b|box|bx|ctn|বক্স|ব|\+|\s)\s*(\d{1,9})\s*(?:p|pc|pcs|পিস|প)?$/.exec(s);
  return m ? { box: Number(m[1]), pcs: Number(m[2]) } : null;
}

export function customerTier(c: CustomerDto | null): PriceTier {
  return c?.type ?? 'retail';
}

/** One line of the invoice the engine receives. A box + pcs cart line becomes two: the boxes, then the loose pieces. */
export interface SaleSubLine {
  lineKey: number;
  part: 'box' | 'pcs';
  kind: 'normal' | 'bonus';
  productId: number;
  packId: number;
  qty: number;
  price: number;
  discKind: 'pct' | 'fixed' | null;
  discValue: number;
}

export const factorOf = (p: ProductDto | undefined, packId: number): number => p?.packs.find((k) => k.id === packId)?.factor ?? 1;
export const isBoxed = (p: ProductDto | undefined, l: Pick<CartLine, 'packId'>): boolean => factorOf(p, l.packId) > 1;

/** Base units a cart line takes from stock. */
export function lineBaseQty(p: ProductDto | undefined, l: CartLine): number {
  return (l.qty ?? 0) * factorOf(p, l.packId) + (isBoxed(p, l) ? l.pcs ?? 0 : 0);
}

/**
 * Expands the cart into engine lines. A percentage discount applies to both parts; a fixed taka discount goes on the
 * box part (or on the pieces when there are no boxes), so the line total is exactly what the cashier saw.
 */
export function expandLines(lines: CartLine[], byId: Map<number, ProductDto>): SaleSubLine[] {
  const out: SaleSubLine[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    const boxed = isBoxed(p, l);
    const box = l.qty ?? 0;
    const pcs = boxed ? l.pcs ?? 0 : 0;
    const bonus = l.kind === 'bonus';
    if (box > 0) out.push({ lineKey: l.key, part: 'box', kind: l.kind, productId: l.productId, packId: l.packId, qty: box, price: bonus ? 0 : l.price ?? 0, discKind: bonus ? null : l.discKind, discValue: bonus ? 0 : l.discValue });
    if (pcs > 0 && p) {
      const fixedOnBox = box > 0 && l.discKind === 'fixed';
      out.push({ lineKey: l.key, part: 'pcs', kind: l.kind, productId: l.productId, packId: basePackOf(p), qty: pcs, price: bonus ? 0 : l.pcsPrice ?? 0, discKind: bonus || fixedOnBox ? null : l.discKind, discValue: bonus || fixedOnBox ? 0 : l.discValue });
    }
  }
  return out;
}

/** A line can be saved when it has a quantity and every part has a price. */
export function lineOk(p: ProductDto | undefined, l: CartLine): boolean {
  const boxed = isBoxed(p, l);
  const box = l.qty ?? 0;
  const pcs = boxed ? l.pcs ?? 0 : 0;
  if (box + pcs <= 0 || (l.qty !== null && l.qty < 0)) return false;
  if (l.kind === 'bonus') return true;
  if (box > 0 && l.price === null) return false;
  if (pcs > 0 && (l.pcsPrice ?? null) === null) return false;
  return true;
}

export interface CartTotals extends InvoiceResult {
  /** Amount (after the line discount) per cart line key. */
  amountOf: Map<number, number>;
}

export function totalsOf(cart: CartState, taxBp: number, roundOff: boolean, byId: Map<number, ProductDto> = new Map()): CartTotals {
  const run = (subs: SaleSubLine[]) =>
    computeInvoice({
      lines: subs.map((l) => ({ kind: l.kind, qty: l.qty, price: l.price, discKind: l.discKind, discValue: l.discValue })),
      discKind: cart.discKind,
      discValue: cart.discValue,
      taxBp,
      roundOff
    });
  // A line whose quantity is empty or zero is shown as invalid and blocks saving; it must not stop the screen from drawing.
  const subs = expandLines(cart.lines.filter((l) => lineOk(byId.get(l.productId), l) || ((l.qty ?? 0) > 0 && !byId.size)), byId);
  const withAmounts = (r: InvoiceResult, used: SaleSubLine[]): CartTotals => {
    const amountOf = new Map<number, number>();
    used.forEach((s, i) => amountOf.set(s.lineKey, (amountOf.get(s.lineKey) ?? 0) + (r.lines[i]?.amount ?? 0)));
    return { ...r, amountOf };
  };
  try {
    return withAmounts(run(subs), subs);
  } catch {
    try {
      return withAmounts(run([]), []);
    } catch {
      return withAmounts(computeInvoice({ lines: [], discKind: null, discValue: 0, taxBp: 0, roundOff: false }), []);
    }
  }
}

/** Draft payload stored in `sale_drafts`; restored defensively because products may have changed since. */
export function serialiseCart(c: CartState): string {
  return JSON.stringify({ v: 1, ...c, lines: c.lines.map((l) => ({ ...l })) });
}

export function parseCart(payload: string, products: ProductDto[]): CartState | null {
  try {
    const raw = JSON.parse(payload) as Partial<CartState> & { v?: number };
    if (raw.v !== 1 || !Array.isArray(raw.lines)) return null;
    const lines: CartLine[] = [];
    let key = 1;
    for (const l of raw.lines) {
      const p = products.find((x) => x.id === l.productId);
      if (!p || p.status !== 'active') continue;
      const packId = p.packs.some((k) => k.id === l.packId) ? l.packId : basePackOf(p);
      lines.push({
        key: key++, productId: p.id, packId, qty: typeof l.qty === 'number' ? l.qty : 1, price: typeof l.price === 'number' ? l.price : null, discKind: l.discKind ?? null, discValue: l.discValue ?? 0, kind: l.kind === 'bonus' ? 'bonus' : 'normal',
        pcs: typeof l.pcs === 'number' ? l.pcs : null, pcsPrice: typeof l.pcsPrice === 'number' ? l.pcsPrice : null
      });
    }
    return { customerId: typeof raw.customerId === 'number' ? raw.customerId : null, lines, discKind: raw.discKind ?? null, discValue: raw.discValue ?? 0, paid: typeof raw.paid === 'number' ? raw.paid : null, accountId: raw.accountId ?? null, note: raw.note ?? '' };
  } catch {
    return null;
  }
}

/** Total base quantity of a product across the normal and bonus lines (for the stock warning). */
export function demandFor(cart: CartState, products: Map<number, ProductDto>, productId: number): number {
  const p = products.get(productId);
  if (!p) return 0;
  return cart.lines.filter((l) => l.productId === productId).reduce((a, l) => a + lineBaseQty(p, l), 0);
}
