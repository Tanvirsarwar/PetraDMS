import { PetraError } from '@petra/core';
import { get, run, scalar } from './sql';
import { type Ctx, assertDateOpen, lastClosedDate, requireRow, tx } from './ctx';
import { defaultAccountId, postCash } from './ledger';
import { reverseDocument } from './reverse';
import { audit } from './audit';

export interface DayFigures {
  openingCash: number;
  collections: number;
  expenses: number;
  expectedCash: number;
}

/**
 * Figures for a business date, taken only from cash transactions on accounts of kind `cash`
 * (cash book, section 5.10). Collections = money in during the day; expenses = money out.
 */
export function dayFigures(ctx: Ctx, date: string): DayFigures {
  const cashAcc = "account_id IN (SELECT id FROM money_accounts WHERE kind = 'cash')";
  // Collections / expenses show real trading only: reversal pairs (voids) and the day-close adjustment itself are left out,
  // and they net to zero anyway, so expected cash is still exactly the sum of the cash book.
  const live = "source != 'day_close' AND reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = cash_transactions.id)";
  const openingCash = scalar(ctx.db, `SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE ${cashAcc} AND business_date < ?`, [date]);
  const collections = scalar(ctx.db, `SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE ${cashAcc} AND business_date = ? AND amount > 0 AND ${live}`, [date]);
  const expenses = -scalar(ctx.db, `SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE ${cashAcc} AND business_date = ? AND amount < 0 AND ${live}`, [date]);
  return { openingCash, collections, expenses, expectedCash: openingCash + collections - expenses };
}

export interface CloseDayInput { date: string; actualCash: number; note?: string }

/**
 * Close Day: records opening cash, collections, expenses, expected and actual cash and the difference,
 * and locks every posting dated on or before the day. A non-zero difference is booked to the cash book
 * (source `day_close`) so the book equals the counted cash and tomorrow starts from the real figure.
 */
export function closeDay(ctx: Ctx, input: CloseDayInput): { id: number; difference: number; expectedCash: number } {
  if (!Number.isSafeInteger(input.actualCash) || input.actualCash < 0) throw new PetraError('INVALID_INPUT', 'counted cash must be a non-negative whole number of poisha', { field: 'actualCash' });
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    const f = dayFigures(ctx, input.date);
    const difference = input.actualCash - f.expectedCash;
    const t = ctx.now();
    const existing = get<{ id: number; status: string }>(ctx.db, 'SELECT id, status FROM day_closings WHERE business_date = ?', input.date);
    let id: number;
    if (existing) {
      id = existing.id;
      run(ctx.db, "UPDATE day_closings SET status = 'reopened' WHERE id = ?", id);
    } else {
      id = run(
        ctx.db,
        "INSERT INTO day_closings(business_date, opening_cash, collections, expenses, expected_cash, actual_cash, difference, status, note, closed_by, closed_at) VALUES(?,?,?,?,?,?,?,'reopened',?,?,?)",
        input.date, f.openingCash, f.collections, f.expenses, f.expectedCash, input.actualCash, difference, input.note ?? '', ctx.userId, t
      ).id;
    }
    if (difference !== 0) {
      postCash(ctx, { accountId: cashAccountId(ctx), date: input.date, amount: difference, source: 'day_close', refType: 'day_closing', refId: id, note: difference > 0 ? 'Cash over' : 'Cash short' });
    }
    // closed_at is stamped AFTER the day's last posting, which is how invariant I8 recognises late postings.
    run(
      ctx.db,
      "UPDATE day_closings SET opening_cash = ?, collections = ?, expenses = ?, expected_cash = ?, actual_cash = ?, difference = ?, status = 'closed', note = ?, closed_by = ?, closed_at = ?, reopened_by = NULL, reopened_at = NULL WHERE id = ?",
      f.openingCash, f.collections, f.expenses, f.expectedCash, input.actualCash, difference, input.note ?? '', ctx.userId, ctx.now(), id
    );
    audit(ctx, { action: 'day.close', entity: 'day_closing', entityId: id, after: { date: input.date, expected: f.expectedCash, actual: input.actualCash, difference } });
    return { id, difference, expectedCash: f.expectedCash };
  });
}

function cashAccountId(ctx: Ctx): number {
  const row = get<{ id: number }>(ctx.db, "SELECT id FROM money_accounts WHERE kind = 'cash' AND active = 1 ORDER BY is_default DESC, id LIMIT 1");
  return row ? row.id : defaultAccountId(ctx);
}

/** Owner only (checked by the service layer). Only the most recent closed day can be reopened, with a reason. */
export function reopenDay(ctx: Ctx, date: string, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to reopen a day');
  tx(ctx, () => {
    const row = requireRow(get<{ id: number; status: string }>(ctx.db, 'SELECT id, status FROM day_closings WHERE business_date = ?', date), 'closed day', date);
    if (row.status !== 'closed') throw new PetraError('DAY_NOT_CLOSED', 'this day is not closed', { date });
    if (lastClosedDate(ctx.db) !== date) throw new PetraError('INVALID_INPUT', 'only the most recent closed day can be reopened', { date });
    run(ctx.db, "UPDATE day_closings SET status = 'reopened', reopened_by = ?, reopened_at = ?, reopen_reason = ? WHERE id = ?", ctx.userId, ctx.now(), reason, row.id);
    reverseDocument(ctx, 'day_closing', row.id, date, `Reopen: ${reason}`);
    audit(ctx, { action: 'day.reopen', entity: 'day_closing', entityId: row.id, after: { date }, reason });
  });
}
