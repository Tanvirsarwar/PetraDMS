import { PetraError, isIsoDate } from '@petra/core';
import { type Db, get, scalar } from './sql';

export interface Ctx {
  db: Db;
  userId: number | null;
  /** UTC ISO timestamp source. Injected so tests can run on a fake clock. */
  now: () => string;
}

export function makeCtx(db: Db, userId: number | null = null, now: () => string = () => new Date().toISOString()): Ctx {
  return { db, userId, now };
}

const depth = new WeakMap<Db, number>();

/**
 * Runs `fn` atomically. The outermost call is BEGIN IMMEDIATE ... COMMIT; nested calls use SAVEPOINTs,
 * so a failure inside an inner call rolls back only that call. Any exception rolls back and rethrows,
 * which is what makes every posting all-or-nothing.
 */
export function tx<T>(ctx: Ctx, fn: () => T): T {
  const d = depth.get(ctx.db) ?? 0;
  const name = `sp_${d}`;
  if (d === 0) ctx.db.exec('BEGIN IMMEDIATE');
  else ctx.db.exec(`SAVEPOINT ${name}`);
  depth.set(ctx.db, d + 1);
  try {
    const out = fn();
    depth.set(ctx.db, d);
    if (d === 0) ctx.db.exec('COMMIT');
    else ctx.db.exec(`RELEASE ${name}`);
    return out;
  } catch (e) {
    depth.set(ctx.db, d);
    try {
      if (d === 0) ctx.db.exec('ROLLBACK');
      else ctx.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    } catch {
      /* the original error is the one that matters */
    }
    throw e;
  }
}

export function lastClosedDate(db: Db): string | null {
  return scalar<string | null>(db, "SELECT MAX(business_date) FROM day_closings WHERE status = 'closed'", [], null);
}

/** Postings dated on or before a closed day are rejected (plan section 5.8). */
export function assertDateOpen(ctx: Ctx, date: string): void {
  if (!isIsoDate(date)) throw new PetraError('INVALID_INPUT', 'invalid date', { field: 'date' });
  const closed = lastClosedDate(ctx.db);
  if (closed && date <= closed) throw new PetraError('DAY_CLOSED', `day ${closed} is closed`, { closedDate: closed, date });
}

export function requireRow<T>(row: T | undefined, what: string, id?: number | string): T {
  if (row === undefined) throw new PetraError('NOT_FOUND', `${what} not found`, { what, id: id ?? null });
  return row;
}

export function userRole(db: Db, userId: number): string | null {
  return get<{ role: string }>(db, 'SELECT role FROM users WHERE id = ? AND active = 1', userId)?.role ?? null;
}
