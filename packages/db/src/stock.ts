import { PetraError, costOut, costOutAllowNegative, mulDiv, splitProportional } from '@petra/core';
import { all, get, run } from './sql';
import type { Ctx } from './ctx';
import { getRaw } from './settings';

export function allowNegative(db: Ctx['db']): boolean {
  const v = getRaw(db, 'allow_negative_stock');
  return v === '1' || v === 'true';
}

export type MovementKind =
  | 'opening' | 'purchase' | 'sale' | 'bonus' | 'sales_return' | 'purchase_return'
  | 'damage' | 'expired' | 'internal_use' | 'adjust_in' | 'adjust_out' | 'void_reversal';

export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  track_expiry: number;
  stock_qty: number;
  stock_value: number;
  last_cost: number;
  min_price: number;
  status: string;
  price_retail: number;
  price_wholesale: number;
  price_dealer: number;
  base_unit: string;
}

export function loadProduct(ctx: Ctx, id: number): ProductRow {
  const p = get<ProductRow>(ctx.db, 'SELECT id, sku, name, track_expiry, stock_qty, stock_value, last_cost, min_price, status, price_retail, price_wholesale, price_dealer, base_unit FROM products WHERE id = ?', id);
  if (!p) throw new PetraError('NOT_FOUND', 'product not found', { what: 'product', id });
  return p;
}

export interface MovementPost {
  productId: number;
  batchId?: number | null;
  date: string;
  kind: MovementKind;
  /** Signed base units. */
  baseQty: number;
  /** Signed poisha: the change in the product's stock_value. */
  value: number;
  refType?: string | null;
  refId?: number | null;
  reversesId?: number | null;
  note?: string;
}

/**
 * The only place stock is changed. Appends to the append-only `stock_movements` and updates the
 * `products.stock_qty/stock_value` caches (and the batch quantity) in the same transaction.
 */
export function recordMovement(ctx: Ctx, m: MovementPost): number {
  if (!Number.isSafeInteger(m.baseQty) || !Number.isSafeInteger(m.value)) throw new PetraError('INVALID_INPUT', 'stock quantity and value must be integers');
  const p = loadProduct(ctx, m.productId);
  const newQty = p.stock_qty + m.baseQty;
  const allowNeg = allowNegative(ctx.db) && !p.track_expiry;
  if (newQty < 0 && !allowNeg) {
    throw new PetraError('NEGATIVE_STOCK', `not enough stock for ${p.name}`, { product: p.name, available: p.stock_qty, wanted: -m.baseQty });
  }
  if (m.batchId) {
    const b = get<{ qty_remaining: number; product_id: number }>(ctx.db, 'SELECT qty_remaining, product_id FROM stock_batches WHERE id = ?', m.batchId);
    if (!b || b.product_id !== m.productId) throw new PetraError('NOT_FOUND', 'batch not found', { what: 'batch', id: m.batchId });
    if (b.qty_remaining + m.baseQty < 0) throw new PetraError('NEGATIVE_STOCK', `not enough stock in batch for ${p.name}`, { product: p.name, available: b.qty_remaining, wanted: -m.baseQty });
    run(ctx.db, 'UPDATE stock_batches SET qty_remaining = qty_remaining + ? WHERE id = ?', m.baseQty, m.batchId);
  }
  const r = run(
    ctx.db,
    'INSERT INTO stock_movements(product_id, batch_id, business_date, kind, base_qty, value, ref_type, ref_id, reverses_id, user_id, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    m.productId, m.batchId ?? null, m.date, m.kind, m.baseQty, m.value, m.refType ?? null, m.refId ?? null, m.reversesId ?? null, ctx.userId, m.note ?? '', ctx.now()
  );
  run(ctx.db, 'UPDATE products SET stock_qty = stock_qty + ?, stock_value = stock_value + ?, updated_at = ? WHERE id = ?', m.baseQty, m.value, ctx.now(), m.productId);
  return r.id;
}

export interface BatchSpec {
  batchNo?: string;
  expiry?: string | null;
}

export function findOrCreateBatch(ctx: Ctx, productId: number, spec: BatchSpec): number {
  const batchNo = spec.batchNo ?? '';
  const expiry = spec.expiry ?? null;
  const row = get<{ id: number }>(ctx.db, "SELECT id FROM stock_batches WHERE product_id = ? AND batch_no = ? AND COALESCE(expiry_date, '') = COALESCE(?, '')", productId, batchNo, expiry);
  if (row) return row.id;
  return run(ctx.db, 'INSERT INTO stock_batches(product_id, batch_no, expiry_date, qty_remaining, created_at) VALUES(?,?,?,0,?)', productId, batchNo, expiry, ctx.now()).id;
}

export interface StockInPost {
  productId: number;
  baseQty: number;
  /** Total value of the incoming goods in poisha. */
  value: number;
  kind: 'purchase' | 'opening' | 'adjust_in' | 'sales_return';
  date: string;
  refType?: string | null;
  refId?: number | null;
  batch?: BatchSpec | null;
  batchId?: number | null;
  note?: string;
  updateLastCost?: boolean;
}

export function stockIn(ctx: Ctx, s: StockInPost): { movementId: number; batchId: number | null } {
  if (!Number.isSafeInteger(s.baseQty) || s.baseQty <= 0) throw new PetraError('INVALID_INPUT', 'quantity must be a positive whole number');
  if (!Number.isSafeInteger(s.value) || s.value < 0) throw new PetraError('INVALID_INPUT', 'value must be a non-negative whole number of poisha');
  const p = loadProduct(ctx, s.productId);
  let batchId: number | null = s.batchId ?? null;
  if (!batchId && p.track_expiry) batchId = findOrCreateBatch(ctx, p.id, s.batch ?? {});
  let value = s.value;
  // Receiving goods into negative stock: the units that were already sold were expensed at last cost,
  // so only the value of the units that actually remain on the shelf is added to stock.
  if (p.stock_qty < 0) {
    const covers = Math.min(-p.stock_qty, s.baseQty);
    value = covers >= s.baseQty ? 0 : s.value - mulDiv(s.value, covers, s.baseQty);
  }
  const movementId = recordMovement(ctx, { productId: p.id, batchId, date: s.date, kind: s.kind, baseQty: s.baseQty, value, refType: s.refType, refId: s.refId, note: s.note });
  if (s.updateLastCost !== false && s.kind === 'purchase') {
    run(ctx.db, 'UPDATE products SET last_cost = ? WHERE id = ?', mulDiv(s.value, 1, s.baseQty), p.id);
  }
  return { movementId, batchId };
}

export interface StockOutPost {
  productId: number;
  baseQty: number;
  kind: 'sale' | 'bonus' | 'purchase_return' | 'damage' | 'expired' | 'internal_use' | 'adjust_out';
  date: string;
  refType?: string | null;
  refId?: number | null;
  /** Cashier override: take from this batch first, then earliest-expiry-first. */
  preferBatchId?: number | null;
  note?: string;
}

export interface Slice {
  batchId: number | null;
  baseQty: number;
  value: number;
}

export interface StockOutResult {
  /** Cost of goods for this removal (includes any uncovered part costed at last cost). */
  cogs: number;
  slices: Slice[];
}

/** Earliest-expiry-first allocation over a product's batches (section 5.5). */
export function allocateBatches(ctx: Ctx, productId: number, baseQty: number, preferBatchId?: number | null): { batchId: number; qty: number }[] {
  const rows = all<{ id: number; qty_remaining: number }>(
    ctx.db,
    'SELECT id, qty_remaining FROM stock_batches WHERE product_id = ? AND qty_remaining > 0 ORDER BY (expiry_date IS NULL), expiry_date, id',
    productId
  );
  const ordered = preferBatchId ? [...rows.filter((r) => r.id === preferBatchId), ...rows.filter((r) => r.id !== preferBatchId)] : rows;
  const out: { batchId: number; qty: number }[] = [];
  let need = baseQty;
  for (const r of ordered) {
    if (need === 0) break;
    const take = Math.min(r.qty_remaining, need);
    out.push({ batchId: r.id, qty: take });
    need -= take;
  }
  if (need > 0) {
    const p = loadProduct(ctx, productId);
    throw new PetraError('NEGATIVE_STOCK', `not enough stock for ${p.name}`, { product: p.name, available: baseQty - need, wanted: baseQty });
  }
  return out;
}

/** Removes stock at weighted-average cost (section 5.4), consuming batches FEFO for expiry products. */
export function stockOut(ctx: Ctx, s: StockOutPost): StockOutResult {
  if (!Number.isSafeInteger(s.baseQty) || s.baseQty <= 0) throw new PetraError('INVALID_INPUT', 'quantity must be a positive whole number');
  const p = loadProduct(ctx, s.productId);
  const allowNeg = allowNegative(ctx.db) && !p.track_expiry;
  let cogs: number;
  let fromStockValue: number;
  if (s.baseQty > p.stock_qty) {
    if (!allowNeg) throw new PetraError('NEGATIVE_STOCK', `not enough stock for ${p.name}`, { product: p.name, available: p.stock_qty, wanted: s.baseQty });
    const r = costOutAllowNegative(p.stock_qty, p.stock_value, s.baseQty, p.last_cost);
    cogs = r.cogs;
    fromStockValue = r.fromStockValue;
  } else {
    cogs = costOut(p.stock_qty, p.stock_value, s.baseQty);
    fromStockValue = cogs;
  }

  const slices: Slice[] = [];
  if (p.track_expiry) {
    const alloc = allocateBatches(ctx, p.id, s.baseQty, s.preferBatchId);
    const values = splitProportional(fromStockValue, alloc.map((a) => a.qty));
    alloc.forEach((a, i) => slices.push({ batchId: a.batchId, baseQty: a.qty, value: values[i] as number }));
  } else {
    slices.push({ batchId: null, baseQty: s.baseQty, value: fromStockValue });
  }
  for (const sl of slices) {
    recordMovement(ctx, { productId: p.id, batchId: sl.batchId, date: s.date, kind: s.kind, baseQty: -sl.baseQty, value: -sl.value, refType: s.refType, refId: s.refId, note: s.note });
  }
  return { cogs, slices };
}

/** Value to book when adding stock without a stated cost: current average, else last purchase cost. */
export function averageCostFor(ctx: Ctx, productId: number, baseQty: number): number {
  const p = loadProduct(ctx, productId);
  if (p.stock_qty > 0 && p.stock_value > 0) return mulDiv(p.stock_value, baseQty, p.stock_qty);
  return p.last_cost * baseQty;
}
