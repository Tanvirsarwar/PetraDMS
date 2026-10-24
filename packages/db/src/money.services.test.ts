import { afterEach, describe, expect, it } from 'vitest';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs, type App } from './testApp';

let app: App;
afterEach(() => app?.close());

async function start() {
  app = makeApp();
  const users = await setupWithUsers(app.d);
  return users;
}

describe('money side (Phase 7 services)', () => {
  it('expenses: category, post, filter, void, staff refused, cash book and day figures agree', async () => {
    const users = await start();
    const cat = (await ok(app.d, 'exp:categories', { includeArchived: false }))[0]!;
    const e1 = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 150000, date: '2026-10-01', payee: 'Shop rent', note: '' });
    const e2 = await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 20000, date: '2026-10-01', payee: 'Tea', note: '' });
    expect(e1.docNo).toMatch(/^EXP/);
    let list = await ok(app.d, 'exp:list', { includeVoid: true });
    expect(list.total).toBe(170000);
    expect(list.byCategory[0]).toMatchObject({ categoryId: cat.id, total: 170000 });
    await ok(app.d, 'exp:void', { id: e2.id, reason: 'duplicate' });
    list = await ok(app.d, 'exp:list', { includeVoid: true });
    expect(list.total).toBe(150000);
    expect(list.rows.find((r) => r.id === e2.id)?.status).toBe('void');
    expect((await ok(app.d, 'exp:list', { includeVoid: false })).rows).toHaveLength(1);
    expect((await ok(app.d, 'exp:list', { includeVoid: true, search: 'rent' })).rows).toHaveLength(1);
    const book = await ok(app.d, 'cash:book', { from: '2026-10-01', to: '2026-10-01' });
    expect(book.closing).toBe(-150000);
    expect(book.rows.filter((r) => r.reversal)).toHaveLength(1);
    expect(book.rows.filter((r) => r.reversed)).toHaveLength(1);
    const day = await ok(app.d, 'day:status', {});
    expect(day.figures.expenses).toBe(150000);
    expect(day.figures.expectedCash).toBe(-150000);
    expect(await fail(app.d, 'exp:categorySave', { name: cat.name })).toBe('DUPLICATE');
    await signInAs(app.d, users.staff, 'staff');
    expect(await fail(app.d, 'exp:save', { categoryId: cat.id, amount: 100, date: '2026-10-01' })).toBe('PERMISSION');
    expect(await fail(app.d, 'cash:book', {})).toBe('PERMISSION');
    expect(await fail(app.d, 'day:status', {})).toBe('PERMISSION');
    await signInAs(app.d, users.owner, 'owner');
    await expectIntegrity(app);
  });

  it('employees and salary: sheet with bonus and deduction, pay, advance, balance, duplicate refused, void', async () => {
    await start();
    const a = await ok(app.d, 'emp:save', { name: 'Sumon', baseSalary: 1200000, jobTitle: 'Salesman' });
    const b = await ok(app.d, 'emp:save', { name: 'Rafiq', baseSalary: 900000 });
    await ok(app.d, 'emp:save', { name: 'Unpaid helper', baseSalary: 0 });
    const sheet = await ok(app.d, 'salary:generate', { month: '2026-10', date: '2026-10-01', adjustments: [{ employeeId: a.id, bonus: 100000, deduction: 50000 }] });
    expect(sheet).toMatchObject({ total: 1200000 + 100000 - 50000 + 900000, lines: 2 });
    expect(await fail(app.d, 'salary:generate', { month: '2026-10', date: '2026-10-01' })).toBe('DUPLICATE');
    const detail = await ok(app.d, 'salary:get', { id: sheet.id });
    expect(detail.rows.map((r) => r.net).sort((x, y) => x - y)).toEqual([900000, 1250000]);
    let emps = await ok(app.d, 'emp:list', { includeArchived: false });
    expect(emps.find((e) => e.id === a.id)?.balance).toBe(1250000);
    await ok(app.d, 'emp:pay', { employeeId: a.id, amount: 1000000, date: '2026-10-01', purpose: 'salary' });
    await ok(app.d, 'emp:pay', { employeeId: b.id, amount: 1000000, date: '2026-10-01', purpose: 'advance' });
    emps = await ok(app.d, 'emp:list', { includeArchived: false });
    expect(emps.find((e) => e.id === a.id)?.balance).toBe(250000);
    expect(emps.find((e) => e.id === b.id)?.balance).toBe(-100000); // advance beyond salary: the employee holds 1,000
    const ledger = await ok(app.d, 'party:ledger', { kind: 'employee', id: a.id });
    expect(ledger.rows.map((r) => r.kind)).toEqual(['salary_due', 'salary_paid']);
    expect(await fail(app.d, 'emp:archive', { id: a.id, archived: true })).toBe('INVALID_INPUT');
    await expectIntegrity(app);
    await ok(app.d, 'salary:void', { id: sheet.id, reason: 'wrong month' });
    expect((await ok(app.d, 'salary:list')).map((s) => s.status)).toEqual(['void']);
    await ok(app.d, 'salary:generate', { month: '2026-10', date: '2026-10-01' }); // allowed again after a void
    await expectIntegrity(app);
  });

  it('day closing: figures, shortfall booked, closed day locks postings, only the Owner reopens', async () => {
    const users = await start();
    const cat = (await ok(app.d, 'exp:categories', { includeArchived: false }))[0]!;
    const acc = (await ok(app.d, 'money:accounts'))[0]!;
    await ok(app.d, 'payment:save', { partyKind: 'customer', partyId: (await ok(app.d, 'customer:save', { name: 'Walk', phone: '', type: 'retail', creditLimit: 0, openingBalance: 500000, openingDate: '2026-09-30' })).id, amount: 300000, date: '2026-10-01', accountId: acc.id });
    await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 50000, date: '2026-10-01' });
    const status = await ok(app.d, 'day:status', { date: '2026-10-01' });
    expect(status.figures).toMatchObject({ openingCash: 0, collections: 300000, expenses: 50000, expectedCash: 250000 });
    expect(await fail(app.d, 'day:close', { date: '2026-10-03', actualCash: 0 })).toBe('INVALID_INPUT'); // future day
    const closed = await ok(app.d, 'day:close', { date: '2026-10-01', actualCash: 240000, note: 'counted twice' });
    expect(closed).toMatchObject({ difference: -10000, expectedCash: 250000 });
    const after = await ok(app.d, 'day:status', { date: '2026-10-01' });
    expect(after.closing).toMatchObject({ status: 'closed', actual: 240000, difference: -10000, note: 'counted twice' });
    expect(after.lastClosed).toBe('2026-10-01');
    expect(await fail(app.d, 'exp:save', { categoryId: cat.id, amount: 100, date: '2026-10-01' })).toBe('DAY_CLOSED');
    const hist = await ok(app.d, 'day:history', {});
    expect(hist).toHaveLength(1);
    await signInAs(app.d, users.manager, 'manager');
    expect(await fail(app.d, 'day:reopen', { date: '2026-10-01', reason: 'x' })).toBe('PERMISSION');
    await signInAs(app.d, users.owner, 'owner');
    await ok(app.d, 'day:reopen', { date: '2026-10-01', reason: 'missed an expense' });
    await ok(app.d, 'exp:save', { categoryId: cat.id, amount: 10000, date: '2026-10-01' });
    const second = await ok(app.d, 'day:close', { date: '2026-10-01', actualCash: 240000 });
    expect(second.expectedCash).toBe(240000);
    expect(second.difference).toBe(0);
    await expectIntegrity(app);
  });

  it('accounts: add bKash with opening balance, rename, default rules, hide only when empty', async () => {
    await start();
    const bk = await ok(app.d, 'money:accountSave', { name: 'bKash Personal', kind: 'bkash', openingBalance: 500000, date: '2026-10-01' });
    let accs = await ok(app.d, 'money:accounts');
    expect(accs.find((a) => a.id === bk.id)?.balance).toBe(500000);
    expect(await fail(app.d, 'money:accountSave', { name: 'bKash Personal', kind: 'bkash' })).toBe('DUPLICATE');
    expect(await fail(app.d, 'money:accountSave', { id: bk.id, name: 'bKash Personal', kind: 'bkash', active: false })).toBe('INVALID_INPUT'); // has money
    await ok(app.d, 'money:accountSave', { id: bk.id, name: 'bKash Shop', kind: 'bkash', isDefault: true });
    accs = await ok(app.d, 'money:accounts');
    expect(accs[0]).toMatchObject({ id: bk.id, name: 'bKash Shop', isDefault: true });
    const book = await ok(app.d, 'cash:book', { accountId: bk.id });
    expect(book).toMatchObject({ opening: 0, closing: 500000, totalIn: 500000 });
    await expectIntegrity(app);
  });
});
