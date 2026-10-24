import { all, get } from './sql';
import type { Ctx } from './ctx';
import { postCash, postLedger, type PartyKind, type CashSource } from './ledger';
import { recordMovement, loadProduct } from './stock';

interface MovementRow { id: number; product_id: number; batch_id: number | null; base_qty: number; value: number }
interface LedgerRow { id: number; party_kind: PartyKind; party_id: number; amount: number }
interface CashRow { id: number; account_id: number; amount: number; party_kind: PartyKind | null; party_id: number | null }

/**
 * Generic, exact reversal of everything a document posted (stock, party ledger, cash).
 * Nothing is deleted: each still-live row gets a negating row that points back at it
 * (`reverses_id`), so a voided document nets to zero in every table (invariant I7).
 * Rows already reversed - for instance by an earlier invoice edit - are skipped.
 */
export function reverseDocument(ctx: Ctx, refType: string, refId: number, date: string, note: string): { stock: number; ledger: number; cash: number } {
  const moves = all<MovementRow>(
    ctx.db,
    `SELECT m.id, m.product_id, m.batch_id, m.base_qty, m.value FROM stock_movements m
      WHERE m.ref_type = ? AND m.ref_id = ? AND m.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_id = m.id)
      ORDER BY m.id DESC`,
    refType, refId
  );
  const touched = new Set<number>();
  for (const m of moves) {
    recordMovement(ctx, { productId: m.product_id, batchId: m.batch_id, date, kind: 'void_reversal', baseQty: -m.base_qty, value: -m.value, refType, refId, reversesId: m.id, note });
    touched.add(m.product_id);
  }
  // If reversing leaves a product with no units but a stray value, clear it so the next purchase
  // is not costed against a phantom amount. The residual is its own row, outside the document.
  for (const productId of touched) {
    const p = loadProduct(ctx, productId);
    if (p.stock_qty === 0 && p.stock_value !== 0) {
      recordMovement(ctx, { productId, date, kind: p.stock_value > 0 ? 'adjust_out' : 'adjust_in', baseQty: 0, value: -p.stock_value, note: 'void residual' });
    }
  }

  const ledger = all<LedgerRow>(
    ctx.db,
    `SELECT l.id, l.party_kind, l.party_id, l.amount FROM party_ledger l
      WHERE l.ref_type = ? AND l.ref_id = ? AND l.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM party_ledger r WHERE r.reverses_id = l.id)
      ORDER BY l.id DESC`,
    refType, refId
  );
  for (const l of ledger) {
    postLedger(ctx, { partyKind: l.party_kind, partyId: l.party_id, kind: 'void_reversal', amount: -l.amount, refType, refId, date, note, reversesId: l.id });
  }

  const cash = all<CashRow>(
    ctx.db,
    `SELECT c.id, c.account_id, c.amount, c.party_kind, c.party_id FROM cash_transactions c
      WHERE c.ref_type = ? AND c.ref_id = ? AND c.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = c.id)
      ORDER BY c.id DESC`,
    refType, refId
  );
  for (const c of cash) {
    postCash(ctx, { accountId: c.account_id, date, amount: -c.amount, source: 'void_reversal' as CashSource, refType, refId, partyKind: c.party_kind, partyId: c.party_id, note, reversesId: c.id });
  }
  return { stock: moves.length, ledger: ledger.length, cash: cash.length };
}

export function hasRow(ctx: Ctx, sql: string, ...params: (string | number)[]): boolean {
  return get(ctx.db, sql, ...params) !== undefined;
}
