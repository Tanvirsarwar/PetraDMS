import { PetraError } from '@petra/core';
import { get, run } from './sql';
import { type Ctx, assertDateOpen, requireRow, tx } from './ctx';
import { nextDocNo } from './settings';
import { averageCostFor, loadProduct, stockIn, stockOut, type BatchSpec } from './stock';
import { reverseDocument } from './reverse';
import { audit } from './audit';
import { postOnce } from './idempotency';

export type AdjustKind = 'opening' | 'adjust_in' | 'adjust_out' | 'damage' | 'expired' | 'internal_use';

export interface AdjustmentInput {
  productId: number;
  kind: AdjustKind;
  baseQty: number;
  date: string;
  reason?: string;
  /** Total value for `opening` / `adjust_in`. Omit to use the current average cost. */
  value?: number;
  /** For `opening` / `adjust_in` on expiry products. */
  batch?: BatchSpec;
  /** For outgoing kinds on expiry products: take from this batch first. */
  batchId?: number | null;
  /** Client-chosen id: the same id twice returns the first adjustment and posts nothing new. */
  requestId?: string;
}

/**
 * Opening stock, manual adjustments, damage, expiry write-off and internal use.
 * Losses are not cash: the profit report reads them straight from the stock movements as "Stock loss".
 */
export function postStockAdjustment(ctx: Ctx, input: AdjustmentInput): { id: number; docNo: string; value: number } {
  const { requestId, ...data } = input;
  return postOnce(ctx, 'stock_adjust', requestId, data, () => postStockAdjustmentOnce(ctx, input));
}

function postStockAdjustmentOnce(ctx: Ctx, input: AdjustmentInput): { id: number; docNo: string; value: number } {
  if (!Number.isSafeInteger(input.baseQty) || input.baseQty <= 0) throw new PetraError('INVALID_INPUT', 'quantity must be a positive whole number', { field: 'qty' });
  if ((input.kind !== 'opening') && !(input.reason ?? '').trim() && input.kind !== 'adjust_in') {
    throw new PetraError('REASON_REQUIRED', 'a reason is required');
  }
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    const docNo = nextDocNo(ctx, 'ADJ');
    let value: number;
    let batchId: number | null = input.batchId ?? null;
    const incoming = input.kind === 'opening' || input.kind === 'adjust_in';
    const id = run(
      ctx.db,
      "INSERT INTO stock_adjustments(doc_no, product_id, batch_id, kind, base_qty, value, reason, business_date, status, user_id, created_at) VALUES(?,?,NULL,?,?,0,?,?, 'posted', ?, ?)",
      docNo, input.productId, input.kind, input.baseQty, input.reason ?? '', input.date, ctx.userId, ctx.now()
    ).id;
    if (incoming) {
      value = input.value ?? averageCostFor(ctx, input.productId, input.baseQty);
      if (!Number.isSafeInteger(value) || value < 0) throw new PetraError('INVALID_INPUT', 'value must be a non-negative whole number of poisha', { field: 'value' });
      const r = stockIn(ctx, { productId: input.productId, baseQty: input.baseQty, value, kind: input.kind as 'opening' | 'adjust_in', date: input.date, refType: 'stock_adjustment', refId: id, batch: input.batch ?? null, note: input.reason, updateLastCost: false });
      batchId = r.batchId;
    } else {
      const out = stockOut(ctx, { productId: input.productId, baseQty: input.baseQty, kind: input.kind as 'adjust_out' | 'damage' | 'expired' | 'internal_use', date: input.date, refType: 'stock_adjustment', refId: id, preferBatchId: input.batchId, note: input.reason });
      value = out.cogs;
      batchId = out.slices.length === 1 ? (out.slices[0]?.batchId ?? null) : null;
    }
    run(ctx.db, 'UPDATE stock_adjustments SET value = ?, batch_id = ? WHERE id = ?', value, batchId, id);
    audit(ctx, { action: `stock.${input.kind}`, entity: 'product', entityId: input.productId, after: { docNo, baseQty: input.baseQty, value }, reason: input.reason });
    return { id, docNo, value };
  });
}

export function voidStockAdjustment(ctx: Ctx, id: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void an adjustment');
  tx(ctx, () => {
    const a = requireRow(get<{ id: number; status: string; business_date: string; product_id: number }>(ctx.db, 'SELECT id, status, business_date, product_id FROM stock_adjustments WHERE id = ?', id), 'adjustment', id);
    if (a.status === 'void') throw new PetraError('ALREADY_VOID', 'this adjustment is already void');
    assertDateOpen(ctx, a.business_date);
    loadProduct(ctx, a.product_id);
    reverseDocument(ctx, 'stock_adjustment', id, a.business_date, `Void: ${reason}`);
    run(ctx.db, "UPDATE stock_adjustments SET status = 'void', void_reason = ? WHERE id = ?", reason, id);
    audit(ctx, { action: 'stock_adjustment.void', entity: 'stock_adjustment', entityId: id, reason });
  });
}
