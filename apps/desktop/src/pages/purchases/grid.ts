import { computePurchase, type DiscountKind, type PackDto, type ProductDto, type PurchaseCalcLine, type PurchaseCalcResult, type SupplierProductDto } from '@petra/core';

/** One product row of the bulk purchase grid. Empty quantities are allowed: such rows are ignored on save. */
export interface GridRow {
  key: string;
  productId: number;
  /** The box the cost is quoted in; the base pack when the product has no box. */
  packId: number;
  box: number | null;
  pcs: number | null;
  /** Cost of ONE box (of `packId`) in poisha. */
  cost: number | null;
  discKind: DiscountKind;
  /** pct: basis points; fixed: poisha. */
  disc: number | null;
  freeBox: number | null;
  freePcs: number | null;
  batchNo: string;
  expiry: string | null;
  /** True when the row came from the company's linked products (shown even without quantity). */
  linked: boolean;
}

export interface BillFields {
  discKind: DiscountKind;
  /** pct: basis points; fixed: poisha. */
  disc: number | null;
  tax: number | null;
  freight: number | null;
}

export const basePack = (p: ProductDto): PackDto => p.packs.find((k) => k.factor === 1) ?? p.packs[0] ?? { id: 0, name: p.baseUnit, nameBn: '', factor: 1, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: null };
export const largestPack = (p: ProductDto): PackDto => [...p.packs].sort((a, b) => b.factor - a.factor)[0] ?? basePack(p);
export const packOf = (p: ProductDto, id: number): PackDto => p.packs.find((k) => k.id === id) ?? basePack(p);

/** Company box first, then the product's default purchase unit, then its biggest box. */
export function defaultPack(p: ProductDto, link?: SupplierProductDto | null): PackDto {
  if (link?.defaultPackId) return packOf(p, link.defaultPackId);
  if (p.defaultPurchasePackId) return packOf(p, p.defaultPurchasePackId);
  return largestPack(p);
}

/** Cost per box: the company's last cost for that box, else the product's last cost (per piece) x box size. */
export function defaultCost(p: ProductDto, pack: PackDto, link?: SupplierProductDto | null): number | null {
  if (link?.lastCost !== null && link?.lastCost !== undefined) {
    const linkFactor = link.defaultPackId ? packOf(p, link.defaultPackId).factor : 1;
    return linkFactor === pack.factor ? link.lastCost : Math.round((link.lastCost * pack.factor) / linkFactor);
  }
  const per = p.lastCost ?? p.avgCost;
  return per !== null && per > 0 ? per * pack.factor : null;
}

let seq = 0;
export function makeRow(p: ProductDto, link?: SupplierProductDto | null, linked = false): GridRow {
  const pack = defaultPack(p, link);
  return { key: `r${++seq}`, productId: p.id, packId: pack.id, box: null, pcs: null, cost: defaultCost(p, pack, link), discKind: 'pct', disc: null, freeBox: null, freePcs: null, batchNo: '', expiry: null, linked };
}

export const paidQty = (r: GridRow): number => (r.box ?? 0) + (r.pcs ?? 0);
export const freeQty = (r: GridRow): number => (r.freeBox ?? 0) + (r.freePcs ?? 0);
export const hasQty = (r: GridRow): boolean => paidQty(r) > 0 || freeQty(r) > 0;

export function rowProblem(r: GridRow, p: ProductDto): 'cost' | 'expiry' | null {
  if (!hasQty(r)) return null;
  if (paidQty(r) > 0 && r.cost === null) return 'cost';
  if (p.trackExpiry && r.expiry === null) return 'expiry';
  return null;
}

/** The calc lines of one row: the paid part and, if any, the free part. */
export function rowCalcLines(r: GridRow, p: ProductDto): PurchaseCalcLine[] {
  const factor = packOf(p, r.packId).factor;
  const out: PurchaseCalcLine[] = [];
  if (paidQty(r) > 0) out.push({ kind: 'normal', factor, boxes: r.box ?? 0, pcs: r.pcs ?? 0, costPerBox: r.cost ?? 0, discKind: r.disc ? r.discKind : null, discValue: r.disc ?? 0 });
  if (freeQty(r) > 0) out.push({ kind: 'free', factor, boxes: r.freeBox ?? 0, pcs: r.freePcs ?? 0, costPerBox: 0 });
  return out;
}

/** Line amount (after the line discount) for the Amount column; null while the row cannot be priced. */
export function rowAmount(r: GridRow, p: ProductDto): number | null {
  if (!hasQty(r) || (paidQty(r) > 0 && r.cost === null)) return null;
  try {
    return computePurchase({ lines: rowCalcLines(r, p) }).subtotal;
  } catch {
    return null;
  }
}

export function stockAfter(r: GridRow, p: ProductDto): number {
  const f = packOf(p, r.packId).factor;
  return p.stockQty + ((r.box ?? 0) + (r.freeBox ?? 0)) * f + (r.pcs ?? 0) + (r.freePcs ?? 0);
}

export interface Summary {
  calc: PurchaseCalcResult | null;
  error: string | null;
  lineCount: number;
  boxes: number;
  pcs: number;
}

export function summarize(rows: GridRow[], byId: Map<number, ProductDto>, bill: BillFields): Summary {
  const active = rows.filter(hasQty);
  const lines: PurchaseCalcLine[] = [];
  for (const r of active) {
    const p = byId.get(r.productId);
    if (p && rowProblem(r, p) !== 'cost') lines.push(...rowCalcLines(r, p));
  }
  const boxes = active.reduce((a, r) => a + (r.box ?? 0) + (r.freeBox ?? 0), 0);
  const pcs = active.reduce((a, r) => a + (r.pcs ?? 0) + (r.freePcs ?? 0), 0);
  if (lines.length === 0) return { calc: null, error: null, lineCount: active.length, boxes, pcs };
  try {
    const calc = computePurchase({ lines, billDiscKind: bill.disc ? bill.discKind : null, billDiscValue: bill.disc ?? 0, tax: bill.tax ?? 0, freight: bill.freight ?? 0 });
    return { calc, error: null, lineCount: active.length, boxes, pcs };
  } catch (e) {
    return { calc: null, error: e instanceof Error ? e.message : String(e), lineCount: active.length, boxes, pcs };
  }
}

/** The purchase:save lines for the rows that have a quantity (free goods become their own line). */
export function toSaveLines(rows: GridRow[], byId: Map<number, ProductDto>) {
  const out: { productId: number; packId: number; qty: number; looseQty: number; unitCost: number; kind: 'normal' | 'free'; discKind: DiscountKind | null; discValue: number; batchNo: string; expiry: string | null }[] = [];
  for (const r of rows.filter(hasQty)) {
    const p = byId.get(r.productId);
    if (!p) continue;
    if (paidQty(r) > 0) out.push({ productId: r.productId, packId: r.packId, qty: r.box ?? 0, looseQty: r.pcs ?? 0, unitCost: r.cost ?? 0, kind: 'normal', discKind: r.disc ? r.discKind : null, discValue: r.disc ?? 0, batchNo: r.batchNo, expiry: p.trackExpiry ? r.expiry : null });
    if (freeQty(r) > 0) out.push({ productId: r.productId, packId: r.packId, qty: r.freeBox ?? 0, looseQty: r.freePcs ?? 0, unitCost: 0, kind: 'free', discKind: null, discValue: 0, batchNo: r.batchNo, expiry: p.trackExpiry ? r.expiry : null });
  }
  return out;
}

/** Draft payload: only rows that hold anything typed, so a 500-product company stays small. */
export interface PurchaseDraft {
  v: 1;
  supplierId: number | null;
  date: string | null;
  ref: string;
  invoiceDate: string | null;
  dueDate: string | null;
  bill: BillFields;
  paid: number | null;
  paidTouched: boolean;
  accountId: number | null;
  note: string;
  dupReason: string;
  rows: Omit<GridRow, 'key'>[];
}

export const rowTouched = (r: GridRow): boolean => hasQty(r) || !r.linked || r.batchNo !== '' || r.expiry !== null || r.disc !== null;
