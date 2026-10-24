import { PetraError } from '@petra/core';
import { audit } from './audit';
import { type Ctx, tx } from './ctx';
import { all, get, run, scalar } from './sql';

/**
 * Funds classify cash movements (see migration 0004). They never hold a balance of their own: a fund's balance
 * is always the sum of the cash_transactions rows that carry its id.
 */
export interface FundRow {
  id: number;
  code: string;
  name: string;
  nameBn: string;
  kind: 'dsr';
  active: boolean;
  /** Cash rows classified to this fund, reversals included. */
  movements: number;
}

export interface FundSave {
  id?: number;
  code: string;
  name: string;
  nameBn: string;
  active: boolean;
}

export function listFunds(ctx: Ctx, includeInactive: boolean): FundRow[] {
  return all<{ id: number; code: string; name: string; name_bn: string; kind: 'dsr'; active: number; n: number }>(
    ctx.db,
    `SELECT f.id, f.code, f.name, f.name_bn, f.kind, f.active, (SELECT COUNT(*) FROM cash_transactions c WHERE c.fund_id = f.id) AS n
       FROM funds f WHERE (? = 1 OR f.active = 1) ORDER BY f.active DESC, f.name`,
    includeInactive ? 1 : 0
  ).map((r) => ({ id: r.id, code: r.code, name: r.name, nameBn: r.name_bn, kind: r.kind, active: r.active === 1, movements: r.n }));
}

export function saveFund(ctx: Ctx, i: FundSave): number {
  return tx(ctx, () => {
    try {
      if (!i.id) {
        const r = run(ctx.db, "INSERT INTO funds(code, name, name_bn, kind, active, created_at) VALUES(?,?,?,'dsr',1,?)", i.code, i.name, i.nameBn, ctx.now());
        audit(ctx, { action: 'fund.create', entity: 'fund', entityId: r.id, after: { code: i.code, name: i.name } });
        return r.id;
      }
      const cur = get<{ code: string }>(ctx.db, 'SELECT code FROM funds WHERE id = ?', i.id);
      if (!cur) throw new PetraError('NOT_FOUND', 'fund not found', { what: 'fund', id: i.id });
      // the code is how a fund is told apart in reports and exports: it is fixed once the fund exists
      if (cur.code !== i.code) throw new PetraError('INVALID_INPUT', 'a fund code cannot be changed', { field: 'code' });
      run(ctx.db, 'UPDATE funds SET name = ?, name_bn = ?, active = ? WHERE id = ?', i.name, i.nameBn, i.active ? 1 : 0, i.id);
      audit(ctx, { action: 'fund.update', entity: 'fund', entityId: i.id, after: { name: i.name, active: i.active } });
      return i.id;
    } catch (e) {
      if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new PetraError('DUPLICATE', 'a fund with this code or name already exists', { field: 'code' });
      throw e;
    }
  });
}

/** A new posting may only go to a fund that exists and is active; old postings to a hidden fund stay as they are. */
export function requireActiveFund(ctx: Ctx, fundId: number): void {
  const f = get<{ active: number }>(ctx.db, 'SELECT active FROM funds WHERE id = ?', fundId);
  if (!f) throw new PetraError('NOT_FOUND', 'fund not found', { what: 'fund', id: fundId });
  if (f.active !== 1) throw new PetraError('INVALID_INPUT', 'this fund is hidden', { field: 'fund' });
}

export function fundMovementCount(ctx: Ctx, fundId: number): number {
  return scalar(ctx.db, 'SELECT COUNT(*) FROM cash_transactions WHERE fund_id = ?', [fundId]);
}
