import { afterEach, describe, expect, it } from 'vitest';
import { all, scalar } from './sql';
import { makeCtx } from './ctx';
import { reverseDocument } from './reverse';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, type App } from './testApp';

let app: App;
afterEach(() => app?.close());

const DATE = '2026-10-01';
const REQ_A = 'req-0000-aaaa-0001';
const REQ_B = 'req-0000-bbbb-0002';

async function start() {
  app = makeApp();
  await setupWithUsers(app.d);
  const cat = (await ok(app.d, 'exp:categories', { includeArchived: false }))[0]!;
  return { cat };
}
const count = (sql: string, ...p: (string | number)[]) => scalar(app.d.db, sql, p);

describe('Stage 1: one real-world money event posts exactly once', () => {
  it('an expense retried with the same request id posts once: one expense, one cash row, balance moved once', async () => {
    const { cat } = await start();
    const input = { categoryId: cat.id, amount: 150000, date: DATE, payee: 'Rent', note: '', requestId: REQ_A };
    const first = await ok(app.d, 'exp:save', input);
    const retry = await ok(app.d, 'exp:save', input);
    const third = await ok(app.d, 'exp:save', input);
    expect(retry).toEqual(first);
    expect(third).toEqual(first);
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(1);
    expect(count("SELECT COUNT(*) FROM cash_transactions WHERE ref_type = 'expense'")).toBe(1);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(-150000);
    expect(count('SELECT COUNT(*) FROM audit_log WHERE action = ?', 'expense.create')).toBe(1);
    expectIntegrity(app);
  });

  it('without a request id nothing changes: two identical expenses are two real expenses', async () => {
    const { cat } = await start();
    const input = { categoryId: cat.id, amount: 20000, date: DATE, payee: 'Tea', note: '' };
    const a = await ok(app.d, 'exp:save', input);
    const b = await ok(app.d, 'exp:save', input);
    expect(b.id).not.toBe(a.id);
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(2);
    expect(count('SELECT COUNT(*) FROM idempotency_keys')).toBe(0);
  });

  it('a customer receipt retried with the same request id lowers the dues and raises the cash once', async () => {
    await start();
    const cust = await ok(app.d, 'customer:save', { name: 'Karim', phone: '', type: 'retail', creditLimit: 0, openingBalance: 500000, openingDate: DATE });
    const input = { partyKind: 'customer' as const, partyId: cust.id, amount: 200000, date: DATE, reference: 'cash', note: '', requestId: REQ_A };
    const first = await ok(app.d, 'payment:save', input);
    const retry = await ok(app.d, 'payment:save', input);
    expect(retry).toEqual(first);
    expect(count('SELECT COUNT(*) FROM payments')).toBe(1);
    expect(count("SELECT COUNT(*) FROM party_ledger WHERE ref_type = 'payment'")).toBe(1);
    expect(count("SELECT COUNT(*) FROM cash_transactions WHERE ref_type = 'payment'")).toBe(1);
    expect(count('SELECT balance FROM customers WHERE id = ?', cust.id)).toBe(300000);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(200000);
    expectIntegrity(app);
  });

  it('a salary or advance payment retried with the same request id posts once', async () => {
    await start();
    const emp = await ok(app.d, 'emp:save', { name: 'Sumon', baseSalary: 1200000, jobTitle: 'Salesman' });
    const input = { employeeId: emp.id, amount: 100000, date: DATE, purpose: 'advance' as const, note: '', requestId: REQ_A };
    const first = await ok(app.d, 'emp:pay', input);
    expect(await ok(app.d, 'emp:pay', input)).toEqual(first);
    expect(count('SELECT COUNT(*) FROM payments')).toBe(1);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(-100000);
    expectIntegrity(app);
  });

  it('the same request id with different data is refused, never silently merged', async () => {
    const { cat } = await start();
    await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 5000, date: DATE, requestId: REQ_A });
    expect(await fail(app.d, 'exp:save', { categoryId: cat.id, amount: 9000, date: DATE, requestId: REQ_A })).toBe('INVALID_INPUT');
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(1);
    // and a key cannot be reused across kinds of event
    const emp = await ok(app.d, 'emp:save', { name: 'Rafiq', baseSalary: 100000 });
    expect(await fail(app.d, 'emp:pay', { employeeId: emp.id, amount: 5000, date: DATE, purpose: 'advance', requestId: REQ_A })).toBe('INVALID_INPUT');
    expect(count('SELECT COUNT(*) FROM payments')).toBe(0);
  });

  it('a failed attempt does not burn the request id: the corrected retry posts once', async () => {
    const { cat } = await start();
    expect(await fail(app.d, 'exp:save', { categoryId: 99999, amount: 7000, date: DATE, requestId: REQ_B })).toBe('NOT_FOUND');
    expect(count('SELECT COUNT(*) FROM idempotency_keys')).toBe(0);
    await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 7000, date: DATE, requestId: REQ_B });
    expect(count('SELECT COUNT(*) FROM expenses')).toBe(1);
  });

  it('request ids must be a sensible length', async () => {
    const { cat } = await start();
    expect(await fail(app.d, 'exp:save', { categoryId: cat.id, amount: 100, date: DATE, requestId: 'x' })).toBe('INVALID_INPUT');
    expect(await fail(app.d, 'exp:save', { categoryId: cat.id, amount: 100, date: DATE, requestId: 'y'.repeat(200) })).toBe('INVALID_INPUT');
  });

  it('old request ids are pruned, recent ones kept', async () => {
    const { cat } = await start();
    app.d.db.prepare("INSERT INTO idempotency_keys(key, scope, fingerprint, result_json, created_at) VALUES('old-key-0000-0001', 'expense', '{}', '{}', '2026-08-01T00:00:00.000Z')").run();
    await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 100, date: DATE, requestId: REQ_A });
    expect(count("SELECT COUNT(*) FROM idempotency_keys WHERE key = 'old-key-0000-0001'")).toBe(0);
    expect(count('SELECT COUNT(*) FROM idempotency_keys WHERE key = ?', REQ_A)).toBe(1);
  });

  it('a void is applied exactly once: second void refused, one reversal row per original, balance restored once', async () => {
    const { cat } = await start();
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 40000, date: DATE, requestId: REQ_A });
    await ok(app.d, 'exp:void', { id: e.id, reason: 'wrong amount' });
    expect(await fail(app.d, 'exp:void', { id: e.id, reason: 'again' })).toBe('ALREADY_VOID');
    expect(count("SELECT COUNT(*) FROM cash_transactions WHERE ref_type = 'expense' AND reverses_id IS NOT NULL")).toBe(1);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(0);
    // the generic reversal is idempotent too: nothing left to reverse
    expect(reverseDocument(makeCtx(app.d.db, null), 'expense', e.id, DATE, 'again')).toEqual({ stock: 0, ledger: 0, cash: 0 });
    expect(count("SELECT COUNT(*) FROM cash_transactions WHERE ref_type = 'expense'")).toBe(2);
    expect(count('SELECT COUNT(*) FROM audit_log WHERE action = ?', 'expense.void')).toBe(1);
    expectIntegrity(app);
  });

  it('a payment void is applied exactly once on the ledger and the cash', async () => {
    await start();
    const cust = await ok(app.d, 'customer:save', { name: 'Karim', phone: '', type: 'retail', creditLimit: 0, openingBalance: 500000, openingDate: DATE });
    const p = await ok(app.d, 'payment:save', { partyKind: 'customer', partyId: cust.id, amount: 100000, date: DATE, requestId: REQ_A });
    await ok(app.d, 'payment:void', { id: p.id, reason: 'bounced' });
    expect(await fail(app.d, 'payment:void', { id: p.id, reason: 'again' })).toBe('ALREADY_VOID');
    expect(count('SELECT balance FROM customers WHERE id = ?', cust.id)).toBe(500000);
    expect(count("SELECT COUNT(*) FROM party_ledger WHERE ref_type = 'payment' AND reverses_id IS NOT NULL")).toBe(1);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(0);
    expectIntegrity(app);
  });

  it('retrying a create with the same request id after its void does not bring the money event back', async () => {
    const { cat } = await start();
    const input = { categoryId: cat.id, amount: 40000, date: DATE, requestId: REQ_A };
    const e = await ok(app.d, 'exp:save', input);
    await ok(app.d, 'exp:void', { id: e.id, reason: 'mistake' });
    expect(await ok(app.d, 'exp:save', input)).toEqual(e);
    expect(count("SELECT COUNT(*) FROM expenses WHERE status = 'posted'")).toBe(0);
    expect(count('SELECT COALESCE(SUM(balance), 0) FROM money_accounts')).toBe(0);
  });

  it('the database itself refuses a second reversal of the same row (cash, ledger, stock)', async () => {
    const { cat } = await start();
    const cust = await ok(app.d, 'customer:save', { name: 'Karim', phone: '', type: 'retail', creditLimit: 0, openingBalance: 100000, openingDate: DATE });
    const e = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 1000, date: DATE });
    await ok(app.d, 'exp:void', { id: e.id, reason: 'x' });
    const p = await ok(app.d, 'payment:save', { partyKind: 'customer', partyId: cust.id, amount: 500, date: DATE });
    await ok(app.d, 'payment:void', { id: p.id, reason: 'x' });
    const cashRow = all<{ id: number; account_id: number }>(app.d.db, "SELECT id, account_id FROM cash_transactions WHERE ref_type = 'expense' AND reverses_id IS NULL")[0]!;
    expect(() => app.d.db.prepare("INSERT INTO cash_transactions(account_id, business_date, direction, amount, source, reverses_id, created_at) VALUES(?, ?, 'in', 1000, 'void_reversal', ?, 'x')").run(cashRow.account_id, DATE, cashRow.id)).toThrow(/UNIQUE/i);
    const ledgerRow = all<{ id: number }>(app.d.db, "SELECT id FROM party_ledger WHERE ref_type = 'payment' AND reverses_id IS NULL")[0]!;
    expect(() => app.d.db.prepare("INSERT INTO party_ledger(party_kind, party_id, entry_kind, amount, reverses_id, business_date, created_at) VALUES('customer', ?, 'void_reversal', 500, ?, ?, 'x')").run(cust.id, ledgerRow.id, DATE)).toThrow(/UNIQUE/i);
    const indexes = all<{ name: string }>(app.d.db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ux_%_reverses'").map((r) => r.name).sort();
    expect(indexes).toEqual(['ux_cash_reverses', 'ux_ledger_reverses', 'ux_mov_reverses']);
  });
});
