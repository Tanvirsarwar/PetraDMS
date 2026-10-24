import { PetraError, type CashbookView, type DayClosingDto, type DayStatus, type EmployeeDto, type ExpenseCategoryDto, type ExpenseDto, type ExpenseList, type SalarySheetDetail, type SalarySheetDto } from '@petra/core';
import type { z } from 'zod';
import type { accountSaveInput, employeeSaveInput, expenseCategorySaveInput } from '@petra/core';
import { all, get, run, scalar } from '../sql';
import { type Ctx, lastClosedDate, requireRow, tx } from '../ctx';
import { audit } from '../audit';
import { createEmployee, createExpenseCategory, createMoneyAccount } from '../masters';
import { dayFigures } from '../dayclose';
import { docKey, docNumbers } from './docref';

type CategorySave = z.output<typeof expenseCategorySaveInput>;
type EmployeeSave = z.output<typeof employeeSaveInput>;
type AccountSave = z.output<typeof accountSaveInput>;

function dup(e: unknown, what: string): never {
  if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) throw new PetraError('DUPLICATE', `${what} already exists`, { what });
  throw e;
}

// ===== Expense categories and expenses =====
export function listExpenseCategories(ctx: Ctx, includeArchived: boolean): ExpenseCategoryDto[] {
  return all<{ id: number; name: string; name_bn: string; status: 'active' | 'archived'; used: number }>(
    ctx.db,
    `SELECT c.id, c.name, c.name_bn, c.status, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id AND e.status = 'posted') AS used
       FROM expense_categories c WHERE (? OR c.status = 'active') ORDER BY c.name COLLATE NOCASE`,
    includeArchived ? 1 : 0
  ).map((c) => ({ id: c.id, name: c.name, nameBn: c.name_bn, status: c.status, used: c.used }));
}

export function saveExpenseCategory(ctx: Ctx, i: CategorySave): number {
  if (!i.id) {
    try {
      return createExpenseCategory(ctx, i.name, i.nameBn);
    } catch (e) {
      return dup(e, 'expense category');
    }
  }
  const catId = i.id;
  requireRow(get(ctx.db, 'SELECT id FROM expense_categories WHERE id = ?', catId), 'expense category', catId);
  try {
    run(ctx.db, 'UPDATE expense_categories SET name = ?, name_bn = ?, status = ? WHERE id = ?', i.name, i.nameBn, i.archived ? 'archived' : 'active', catId);
  } catch (e) {
    dup(e, 'expense category');
  }
  audit(ctx, { action: 'expense_category.update', entity: 'expense_category', entityId: catId, after: { name: i.name, archived: i.archived } });
  return catId;
}

export function listExpenses(ctx: Ctx, f: { from?: string; to?: string; categoryId?: number; accountId?: number; search?: string; includeVoid: boolean }): ExpenseList {
  const q = (f.search ?? '').trim().toLowerCase();
  const rows = all<{
    id: number; doc_no: string; business_date: string; category_id: number; cname: string; cname_bn: string; amount: number; account_id: number; aname: string;
    payee: string; note: string; status: 'posted' | 'void'; void_reason: string | null; uname: string | null;
  }>(
    ctx.db,
    `SELECT e.id, e.doc_no, e.business_date, e.category_id, c.name AS cname, c.name_bn AS cname_bn, e.amount, e.account_id, a.name AS aname, e.payee, e.note, e.status, e.void_reason, u.display_name AS uname
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN money_accounts a ON a.id = e.account_id LEFT JOIN users u ON u.id = e.user_id
      WHERE (? IS NULL OR e.business_date >= ?) AND (? IS NULL OR e.business_date <= ?) AND (? IS NULL OR e.category_id = ?) AND (? IS NULL OR e.account_id = ?)
        AND (? OR e.status = 'posted')
      ORDER BY e.business_date DESC, e.id DESC LIMIT 5000`,
    f.from ?? null, f.from ?? null, f.to ?? null, f.to ?? null, f.categoryId ?? null, f.categoryId ?? null, f.accountId ?? null, f.accountId ?? null, f.includeVoid ? 1 : 0
  ).filter((r) => !q || r.doc_no.toLowerCase().includes(q) || r.payee.toLowerCase().includes(q) || r.note.toLowerCase().includes(q) || r.cname.toLowerCase().includes(q));
  const dtos: ExpenseDto[] = rows.map((r) => ({
    id: r.id, docNo: r.doc_no, date: r.business_date, categoryId: r.category_id, categoryName: r.cname, categoryNameBn: r.cname_bn, amount: r.amount, accountId: r.account_id,
    accountName: r.aname, payee: r.payee, note: r.note, status: r.status, voidReason: r.void_reason, userName: r.uname ?? ''
  }));
  const by = new Map<number, { categoryId: number; name: string; nameBn: string; total: number }>();
  let total = 0;
  for (const r of dtos) {
    if (r.status !== 'posted') continue;
    total += r.amount;
    const cur = by.get(r.categoryId) ?? { categoryId: r.categoryId, name: r.categoryName, nameBn: r.categoryNameBn, total: 0 };
    cur.total += r.amount;
    by.set(r.categoryId, cur);
  }
  return { rows: dtos, total, byCategory: [...by.values()].sort((a, b) => b.total - a.total) };
}

// ===== Employees and salary =====
export function listEmployees(ctx: Ctx, includeArchived: boolean): EmployeeDto[] {
  return all<{ id: number; name: string; name_bn: string; phone: string; job_title: string; base_salary: number; balance: number; joined_on: string | null; status: 'active' | 'archived' }>(
    ctx.db, 'SELECT id, name, name_bn, phone, job_title, base_salary, balance, joined_on, status FROM employees WHERE (? OR status = \'active\') ORDER BY name COLLATE NOCASE', includeArchived ? 1 : 0
  ).map((e) => ({ id: e.id, name: e.name, nameBn: e.name_bn, phone: e.phone, jobTitle: e.job_title, baseSalary: e.base_salary, balance: e.balance, joinedOn: e.joined_on, status: e.status }));
}

export function saveEmployee(ctx: Ctx, i: EmployeeSave): number {
  if (!i.id) return createEmployee(ctx, { name: i.name, nameBn: i.nameBn, phone: i.phone, jobTitle: i.jobTitle, baseSalary: i.baseSalary, joinedOn: i.joinedOn ?? undefined });
  const empId = i.id;
  requireRow(get(ctx.db, 'SELECT id FROM employees WHERE id = ?', empId), 'employee', empId);
  run(ctx.db, 'UPDATE employees SET name = ?, name_bn = ?, phone = ?, job_title = ?, base_salary = ?, joined_on = ?, updated_at = ? WHERE id = ?', i.name, i.nameBn, i.phone, i.jobTitle, i.baseSalary, i.joinedOn, ctx.now(), empId);
  audit(ctx, { action: 'employee.update', entity: 'employee', entityId: empId, after: { name: i.name, baseSalary: i.baseSalary } });
  return empId;
}

export function archiveEmployee(ctx: Ctx, id: number, archived: boolean): void {
  tx(ctx, () => {
    const e = requireRow(get<{ balance: number }>(ctx.db, 'SELECT balance FROM employees WHERE id = ?', id), 'employee', id);
    if (archived && e.balance !== 0) throw new PetraError('INVALID_INPUT', 'settle the employee balance before archiving', { field: 'balance' });
    run(ctx.db, 'UPDATE employees SET status = ?, updated_at = ? WHERE id = ?', archived ? 'archived' : 'active', ctx.now(), id);
    audit(ctx, { action: archived ? 'employee.archive' : 'employee.restore', entity: 'employee', entityId: id });
  });
}

export function listSalarySheets(ctx: Ctx): SalarySheetDto[] {
  return all<{ id: number; month: string; business_date: string; total: number; status: 'posted' | 'void'; void_reason: string | null; lines: number }>(
    ctx.db, 'SELECT s.id, s.month, s.business_date, s.total, s.status, s.void_reason, (SELECT COUNT(*) FROM salary_lines l WHERE l.sheet_id = s.id) AS lines FROM salary_sheets s ORDER BY s.month DESC, s.id DESC'
  ).map((s) => ({ id: s.id, month: s.month, date: s.business_date, total: s.total, lines: s.lines, status: s.status, voidReason: s.void_reason }));
}

export function getSalarySheet(ctx: Ctx, id: number): SalarySheetDetail {
  const s = listSalarySheets(ctx).find((x) => x.id === id);
  if (!s) throw new PetraError('NOT_FOUND', 'salary sheet not found', { what: 'salary sheet' });
  const rows = all<{ employee_id: number; name: string; name_bn: string; base: number; bonus: number; deduction: number; net: number }>(
    ctx.db, 'SELECT l.employee_id, e.name, e.name_bn, l.base, l.bonus, l.deduction, l.net FROM salary_lines l JOIN employees e ON e.id = l.employee_id WHERE l.sheet_id = ? ORDER BY e.name COLLATE NOCASE', id
  ).map((r) => ({ employeeId: r.employee_id, name: r.name, nameBn: r.name_bn, base: r.base, bonus: r.bonus, deduction: r.deduction, net: r.net }));
  return { ...s, rows };
}

// ===== Money accounts =====
export function saveAccount(ctx: Ctx, i: AccountSave, today: string): number {
  return tx(ctx, () => {
    if (!i.id) {
      try {
        return createMoneyAccount(ctx, { name: i.name, nameBn: i.nameBn, kind: i.kind, openingBalance: i.openingBalance, date: i.date ?? today, isDefault: i.isDefault });
      } catch (e) {
        return dup(e, 'account');
      }
    }
    const accId = i.id;
    const a = requireRow(get<{ balance: number; kind: string; is_default: number }>(ctx.db, 'SELECT balance, kind, is_default FROM money_accounts WHERE id = ?', accId), 'account', accId);
    if (!i.active) {
      if (a.balance !== 0) throw new PetraError('INVALID_INPUT', 'move the money out of this account before hiding it', { field: 'active' });
      if (a.is_default === 1 || i.isDefault) throw new PetraError('INVALID_INPUT', 'the default account cannot be hidden', { field: 'active' });
      if (a.kind === 'cash' && scalar(ctx.db, "SELECT COUNT(*) FROM money_accounts WHERE kind = 'cash' AND active = 1") <= 1) throw new PetraError('INVALID_INPUT', 'keep at least one cash account', { field: 'active' });
    }
    if (i.isDefault) run(ctx.db, 'UPDATE money_accounts SET is_default = 0');
    try {
      run(ctx.db, 'UPDATE money_accounts SET name = ?, name_bn = ?, active = ?, is_default = ? WHERE id = ?', i.name, i.nameBn, i.active ? 1 : 0, i.isDefault ? 1 : a.is_default, accId);
    } catch (e) {
      dup(e, 'account');
    }
    audit(ctx, { action: 'account.update', entity: 'money_account', entityId: accId, after: { name: i.name, active: i.active } });
    return accId;
  });
}

// ===== Cash book =====
export function cashBook(ctx: Ctx, f: { from?: string; to?: string; accountId?: number }): CashbookView {
  const acc = f.accountId ?? null;
  const opening = f.from ? scalar(ctx.db, 'SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE business_date < ? AND (? IS NULL OR account_id = ?)', [f.from, acc, acc]) : 0;
  const rows = all<{ id: number; business_date: string; account_id: number; aname: string; source: string; amount: number; note: string; ref_type: string | null; ref_id: number | null; reverses_id: number | null; reversed: number; fund_id: number | null; fund_code: string | null }>(
    ctx.db,
    `SELECT t.id, t.business_date, t.account_id, a.name AS aname, t.source, t.amount, t.note, t.ref_type, t.ref_id, t.reverses_id,
            EXISTS(SELECT 1 FROM cash_transactions r WHERE r.reverses_id = t.id) AS reversed, t.fund_id, f.code AS fund_code
       FROM cash_transactions t JOIN money_accounts a ON a.id = t.account_id LEFT JOIN funds f ON f.id = t.fund_id
      WHERE (? IS NULL OR t.business_date >= ?) AND (? IS NULL OR t.business_date <= ?) AND (? IS NULL OR t.account_id = ?)
      ORDER BY t.business_date, t.id`,
    f.from ?? null, f.from ?? null, f.to ?? null, f.to ?? null, acc, acc
  );
  const docs = docNumbers(ctx.db, rows.map((r) => ({ refType: r.ref_type, refId: r.ref_id })));
  let running = opening;
  let totalIn = 0;
  let totalOut = 0;
  const out = rows.map((r) => {
    running += r.amount;
    if (r.amount >= 0) totalIn += r.amount;
    else totalOut += -r.amount;
    return { id: r.id, date: r.business_date, accountId: r.account_id, accountName: r.aname, source: r.source, amount: r.amount, balanceAfter: running, note: r.note, refNo: docs.get(docKey(r.ref_type, r.ref_id)) ?? '', reversal: r.reverses_id !== null, reversed: r.reversed === 1, fundId: r.fund_id, fundCode: r.fund_code };
  });
  return { accountId: acc, opening, totalIn, totalOut, closing: running, rows: out };
}

// ===== Day closing =====
interface ClosingDb {
  id: number; business_date: string; opening_cash: number; collections: number; expenses: number; expected_cash: number; actual_cash: number; difference: number;
  status: 'closed' | 'reopened'; note: string; closed_at: string; reopen_reason: string | null; closer: string | null;
}

const toClosing = (r: ClosingDb): DayClosingDto => ({
  id: r.id, date: r.business_date, opening: r.opening_cash, collections: r.collections, expenses: r.expenses, expected: r.expected_cash, actual: r.actual_cash, difference: r.difference,
  status: r.status, note: r.note, closedBy: r.closer ?? '', closedAt: r.closed_at, reopenReason: r.reopen_reason
});

const CLOSING_SQL = 'SELECT d.*, u.display_name AS closer FROM day_closings d LEFT JOIN users u ON u.id = d.closed_by';

export function dayStatus(ctx: Ctx, date: string): DayStatus {
  const row = get<ClosingDb>(ctx.db, `${CLOSING_SQL} WHERE d.business_date = ?`, date);
  const last = lastClosedDate(ctx.db);
  const unclosedBefore = scalar(
    ctx.db,
    `SELECT COUNT(DISTINCT business_date) FROM cash_transactions WHERE business_date < ? AND business_date > COALESCE(?, '') AND source != 'opening'`,
    [date, last]
  );
  return { date, figures: dayFigures(ctx, date), closing: row ? toClosing(row) : null, lastClosed: last, unclosedBefore };
}

export function dayHistory(ctx: Ctx, limit: number): DayClosingDto[] {
  return all<ClosingDb>(ctx.db, `${CLOSING_SQL} ORDER BY d.business_date DESC LIMIT ?`, limit).map(toClosing);
}
