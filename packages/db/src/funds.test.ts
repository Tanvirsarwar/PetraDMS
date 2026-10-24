import { afterEach, describe, expect, it } from 'vitest';
import { checkIntegrity } from './integrity';
import { makeCtx } from './ctx';
import { postCash } from './ledger';
import { all, scalar } from './sql';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs, type App } from './testApp';

let app: App;
afterEach(() => app?.close());

const DATE = '2026-10-01';
const count = (sql: string, ...p: (string | number)[]) => scalar(app.d.db, sql, p);

async function start() {
  app = makeApp();
  const u = await setupWithUsers(app.d);
  const cat = (await ok(app.d, 'exp:categories', { includeArchived: false }))[0]!;
  const dsr = await ok(app.d, 'fund:save', { code: 'dsr', name: 'DSR fund', nameBn: 'ডিএসআর তহবিল', active: true });
  return { u, cat, dsr: dsr.id };
}

describe('Stage 2: DSR fund classification', () => {
  it('a new database has no funds and every cash row is ordinary business money (fund_id null)', async () => {
    app = makeApp();
    await setupWithUsers(app.d);
    expect(await ok(app.d, 'fund:list', { includeInactive: true })).toEqual([]);
    expect(count('SELECT COUNT(*) FROM cash_transactions WHERE fund_id IS NOT NULL')).toBe(0);
  });

  it('creates, renames and hides a fund; the code is stored upper case and cannot change; duplicates are refused', async () => {
    const { dsr } = await start();
    const [f] = await ok(app.d, 'fund:list', { includeInactive: false });
    expect(f).toMatchObject({ id: dsr, code: 'DSR', name: 'DSR fund', kind: 'dsr', active: true, movements: 0 });
    await ok(app.d, 'fund:save', { id: dsr, code: 'DSR', name: 'DSR cash', nameBn: '', active: true });
    expect((await ok(app.d, 'fund:list', { includeInactive: false }))[0]!.name).toBe('DSR cash');
    expect(await fail(app.d, 'fund:save', { id: dsr, code: 'OTHER', name: 'DSR cash', nameBn: '', active: true })).toBe('INVALID_INPUT');
    expect(await fail(app.d, 'fund:save', { code: 'dsr', name: 'Another', nameBn: '', active: true })).toBe('DUPLICATE');
    expect(await fail(app.d, 'fund:save', { code: 'x', name: 'Bad code', nameBn: '', active: true })).toBe('INVALID_INPUT');
    await ok(app.d, 'fund:save', { id: dsr, code: 'DSR', name: 'DSR cash', nameBn: '', active: false });
    expect(await ok(app.d, 'fund:list', { includeInactive: false })).toEqual([]);
    expect(await ok(app.d, 'fund:list', { includeInactive: true })).toHaveLength(1);
    expect(count("SELECT COUNT(*) FROM audit_log WHERE action IN ('fund.create', 'fund.update')")).toBe(3); // create, rename, hide: the refused calls leave no audit entry
  });

  it('an expense paid from a fund is ONE expense and ONE cash row, tagged with the fund; the account balance moves once', async () => {
    const { cat, dsr } = await start();
    const before = count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts');
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 30000, date: DATE, payee: 'Fuel', fundId: dsr });
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(1);
    const rows = all<{ fund_id: number | null; amount: number }>(app.d.db, "SELECT fund_id, amount FROM cash_transactions WHERE ref_type = 'expense' AND ref_id = ?", e.id);
    expect(rows).toEqual([{ fund_id: dsr, amount: -30000 }]);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(before - 30000);
    expect(count('SELECT COUNT(*) FROM cash_transactions WHERE ref_type = ?', 'expense')).toBe(1);
    expect((await ok(app.d, 'fund:list', { includeInactive: false }))[0]!.movements).toBe(1);
    expectIntegrity(app);
  });

  it('an ordinary expense is unchanged: no fund, same posting', async () => {
    const { cat } = await start();
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 10000, date: DATE });
    expect(count('SELECT fund_id IS NULL FROM cash_transactions WHERE ref_type = ? AND ref_id = ?', 'expense', e.id)).toBe(1);
    const book = await ok(app.d, 'cash:book', {});
    expect(book.rows.every((r) => r.fundId === null && r.fundCode === null)).toBe(true);
  });

  it('the cash book shows the fund of each movement', async () => {
    const { cat, dsr } = await start();
    await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 5000, date: DATE, fundId: dsr });
    await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 7000, date: DATE });
    const rows = (await ok(app.d, 'cash:book', {})).rows;
    expect(rows.map((r) => r.fundCode)).toEqual(['DSR', null]);
  });

  it('a void reverses inside the same fund, so the fund nets to zero and the account is restored once', async () => {
    const { cat, dsr } = await start();
    const before = count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts');
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 30000, date: DATE, fundId: dsr });
    await ok(app.d, 'exp:void', { id: e.id, reason: 'mistake' });
    expect(count('SELECT COALESCE(SUM(amount), 0) FROM cash_transactions WHERE fund_id = ?', dsr)).toBe(0);
    expect(count('SELECT COUNT(*) FROM cash_transactions WHERE fund_id = ?', dsr)).toBe(2);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(before);
    expectIntegrity(app);
  });

  it('a hidden fund takes no new postings, but old ones can still be voided', async () => {
    const { cat, dsr } = await start();
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 8000, date: DATE, fundId: dsr });
    await ok(app.d, 'fund:save', { id: dsr, code: 'DSR', name: 'DSR fund', nameBn: '', active: false });
    expect(await fail(app.d, 'exp:save', { categoryId: cat.id, amount: 1000, date: DATE, fundId: dsr })).toBe('INVALID_INPUT');
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(1);
    await ok(app.d, 'exp:void', { id: e.id, reason: 'x' });
    expectIntegrity(app);
  });

  it('an unknown fund is refused and nothing is posted', async () => {
    const { cat } = await start();
    expect(await fail(app.d, 'exp:save', { categoryId: cat.id, amount: 1000, date: DATE, fundId: 999 })).toBe('NOT_FOUND');
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(0);
    expect(count('SELECT COUNT(*) FROM cash_transactions WHERE source = ?', 'expense')).toBe(0);
  });

  it('a retry of a fund expense with the same request id posts once; the same id with another fund is refused', async () => {
    const { cat, dsr } = await start();
    const other = await ok(app.d, 'fund:save', { code: 'DSR2', name: 'Second DSR', nameBn: '', active: true });
    const body = { categoryId: cat.id, amount: 4000, date: DATE, fundId: dsr, requestId: 'fund-req-0000-0001' };
    const a = await ok(app.d, 'exp:save', body);
    expect(await ok(app.d, 'exp:save', body)).toEqual(a);
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(1);
    expect(await fail(app.d, 'exp:save', { ...body, fundId: other.id })).toBe('INVALID_INPUT');
  });

  it('only expenses may be classified: a fund on a sale, purchase or opening movement is refused', async () => {
    const { dsr } = await start();
    const ctx = makeCtx(app.d.db, null);
    const acc = scalar(app.d.db, 'SELECT id FROM money_accounts LIMIT 1', []);
    for (const source of ['sale', 'purchase', 'opening', 'payment', 'day_close'] as const) {
      expect(() => postCash(ctx, { accountId: acc, date: DATE, amount: 100, source, fundId: dsr })).toThrow(/cannot belong to a fund/);
    }
    expect(count('SELECT COUNT(*) FROM cash_transactions WHERE fund_id IS NOT NULL')).toBe(0);
  });

  it('a reversal cannot be put in another fund than the original', async () => {
    const { cat, dsr } = await start();
    const other = await ok(app.d, 'fund:save', { code: 'DSR2', name: 'Second DSR', nameBn: '', active: true });
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 2000, date: DATE, fundId: dsr });
    const row = all<{ id: number; account_id: number }>(app.d.db, "SELECT id, account_id FROM cash_transactions WHERE ref_type = 'expense' AND ref_id = ?", e.id)[0]!;
    expect(() => postCash(makeCtx(app.d.db, null), { accountId: row.account_id, date: DATE, amount: 2000, source: 'void_reversal', reversesId: row.id, fundId: other.id })).toThrow(/keeps the fund/);
  });

  it('the database refuses to move a posted movement to another fund (or out of one)', async () => {
    const { cat, dsr } = await start();
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 2000, date: DATE, fundId: dsr });
    const o = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 3000, date: DATE });
    expect(() => app.d.db.prepare("UPDATE cash_transactions SET fund_id = NULL WHERE ref_type = 'expense' AND ref_id = ?").run(e.id)).toThrow(/cannot change fund/);
    expect(() => app.d.db.prepare("UPDATE cash_transactions SET fund_id = ? WHERE ref_type = 'expense' AND ref_id = ?").run(dsr, o.id)).toThrow(/cannot change fund/);
    // updating something else on the row is still fine
    app.d.db.prepare("UPDATE cash_transactions SET note = 'edited' WHERE ref_type = 'expense' AND ref_id = ?").run(e.id);
  });

  it('the integrity checker catches a fund on the wrong kind of movement and a reversal in another fund (I13)', async () => {
    const { dsr } = await start();
    const acc = scalar(app.d.db, 'SELECT id FROM money_accounts LIMIT 1', []);
    app.d.db.exec('SAVEPOINT bad');
    app.d.db.prepare("INSERT INTO cash_transactions(account_id, business_date, direction, amount, source, created_at, fund_id) VALUES(?, ?, 'in', 0, 'sale', 'x', ?)").run(acc, DATE, dsr);
    expect(checkIntegrity(app.d.db).some((v) => v.invariant === 'I13')).toBe(true);
    app.d.db.exec('ROLLBACK TO bad');
    app.d.db.exec('RELEASE bad');
    expectIntegrity(app);
  });

  it('roles: staff reach neither channel; a manager may read funds but only the owner may change them', async () => {
    const { u } = await start();
    await signInAs(app.d, u.staff, 'staff');
    expect(await fail(app.d, 'fund:list', { includeInactive: false })).toBe('PERMISSION');
    expect(await fail(app.d, 'fund:save', { code: 'ZZ', name: 'Z', nameBn: '', active: true })).toBe('PERMISSION');
    await signInAs(app.d, u.manager, 'manager');
    expect(await ok(app.d, 'fund:list', { includeInactive: false })).toHaveLength(1);
    expect(await fail(app.d, 'fund:save', { code: 'ZZ', name: 'Z', nameBn: '', active: true })).toBe('PERMISSION');
  });
});
