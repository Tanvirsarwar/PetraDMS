import { PetraError } from '@petra/core';
import { all, get, run } from './sql';
import { type Ctx, assertDateOpen, requireRow, tx } from './ctx';
import { nextDocNo } from './settings';
import { type PartyKind, postCash, postLedger, resolveAccount } from './ledger';
import { reverseDocument } from './reverse';
import { audit } from './audit';
import { postOnce } from './idempotency';

// ===== Payments (customer receipts, supplier payments, employee salary/advance) =====

export interface PaymentInput {
  partyKind: PartyKind;
  partyId: number;
  amount: number;
  date: string;
  accountId?: number | null;
  reference?: string;
  /** Optional link to an invoice; payments still apply to the party balance (khata model). */
  invoiceRefType?: 'sale' | 'purchase' | null;
  invoiceRefId?: number | null;
  purpose?: 'normal' | 'salary' | 'advance';
  note?: string;
  /** Client-chosen id: submitting the same one again returns the first payment instead of posting another. */
  requestId?: string;
}

const PARTY_TABLE: Record<PartyKind, string> = { customer: 'customers', supplier: 'suppliers', employee: 'employees' };

/** Receive from a customer (RCT) or pay a supplier / employee (PAY). */
export function postPayment(ctx: Ctx, input: PaymentInput): { id: number; docNo: string } {
  const { requestId, ...data } = input;
  return postOnce(ctx, 'payment', requestId, data, () => postPaymentOnce(ctx, input));
}

function postPaymentOnce(ctx: Ctx, input: PaymentInput): { id: number; docNo: string } {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new PetraError('INVALID_INPUT', 'amount must be a positive whole number of poisha', { field: 'amount' });
  const purpose = input.purpose ?? 'normal';
  if (input.partyKind === 'customer' && purpose !== 'normal') throw new PetraError('INVALID_INPUT', 'invalid payment purpose');
  if (input.partyKind === 'employee' && purpose === 'normal') throw new PetraError('INVALID_INPUT', 'choose salary or advance', { field: 'purpose' });
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    const party = requireRow(get<{ status: string }>(ctx.db, `SELECT status FROM ${PARTY_TABLE[input.partyKind]} WHERE id = ?`, input.partyId), input.partyKind, input.partyId);
    if (party.status !== 'active') throw new PetraError('INVALID_INPUT', `${input.partyKind} is archived`, { field: 'party' });
    const received = input.partyKind === 'customer';
    const docNo = nextDocNo(ctx, received ? 'RCT' : 'PAY');
    const accountId = resolveAccount(ctx, input.accountId);
    const id = run(
      ctx.db,
      `INSERT INTO payments(doc_no, party_kind, party_id, direction, purpose, amount, account_id, reference, invoice_ref_type, invoice_ref_id, business_date, status, note, user_id, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?)`,
      docNo, input.partyKind, input.partyId, received ? 'received' : 'given', purpose, input.amount, accountId, input.reference ?? '',
      input.invoiceRefType ?? null, input.invoiceRefId ?? null, input.date, input.note ?? '', ctx.userId, ctx.now()
    ).id;
    const entryKind = input.partyKind === 'employee' ? (purpose === 'advance' ? 'advance' : 'salary_paid') : 'payment';
    // customer: they paid, so they owe less (-). supplier/employee: we paid, so we owe less (-).
    postLedger(ctx, { partyKind: input.partyKind, partyId: input.partyId, kind: entryKind, amount: -input.amount, refType: 'payment', refId: id, date: input.date, note: docNo });
    postCash(ctx, {
      accountId, date: input.date, amount: received ? input.amount : -input.amount,
      source: input.partyKind === 'employee' ? (purpose === 'advance' ? 'advance' : 'salary') : 'payment',
      refType: 'payment', refId: id, partyKind: input.partyKind, partyId: input.partyId, note: input.reference
    });
    audit(ctx, { action: 'payment.create', entity: 'payment', entityId: id, after: { docNo, party: `${input.partyKind}:${input.partyId}`, amount: input.amount } });
    return { id, docNo };
  });
}

export function voidPayment(ctx: Ctx, paymentId: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void a payment');
  tx(ctx, () => {
    const p = requireRow(get<{ id: number; status: string; business_date: string }>(ctx.db, 'SELECT id, status, business_date FROM payments WHERE id = ?', paymentId), 'payment', paymentId);
    if (p.status === 'void') throw new PetraError('ALREADY_VOID', 'this payment is already void');
    assertDateOpen(ctx, p.business_date);
    reverseDocument(ctx, 'payment', paymentId, p.business_date, `Void: ${reason}`);
    run(ctx.db, "UPDATE payments SET status = 'void', void_reason = ? WHERE id = ?", reason, paymentId);
    audit(ctx, { action: 'payment.void', entity: 'payment', entityId: paymentId, reason });
  });
}

/** Opening dues / manual correction on a party ledger (Owner). Positive follows the party's balance sign. */
export function postPartyAdjustment(ctx: Ctx, input: { partyKind: PartyKind; partyId: number; amount: number; date: string; kind: 'opening' | 'adjustment'; note: string }): number {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new PetraError('INVALID_INPUT', 'amount must be a non-zero whole number of poisha', { field: 'amount' });
  if (input.kind === 'adjustment' && !input.note.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required for an adjustment');
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    const id = postLedger(ctx, { partyKind: input.partyKind, partyId: input.partyId, kind: input.kind, amount: input.amount, date: input.date, note: input.note });
    audit(ctx, { action: `ledger.${input.kind}`, entity: input.partyKind, entityId: input.partyId, after: { amount: input.amount }, reason: input.note });
    return id;
  });
}

// ===== Expenses =====

export interface ExpenseInput {
  categoryId: number;
  amount: number;
  date: string;
  accountId?: number | null;
  payee?: string;
  note?: string;
  /** Fund this expense is paid from (DSR). Null or absent: an ordinary business expense. */
  fundId?: number | null;
  /** Client-chosen id: submitting the same one again returns the first expense instead of posting another. */
  requestId?: string;
}

export function postExpense(ctx: Ctx, input: ExpenseInput): { id: number; docNo: string } {
  const { requestId, ...data } = input;
  return postOnce(ctx, 'expense', requestId, data, () => postExpenseOnce(ctx, input));
}

function postExpenseOnce(ctx: Ctx, input: ExpenseInput): { id: number; docNo: string } {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new PetraError('INVALID_INPUT', 'amount must be a positive whole number of poisha', { field: 'amount' });
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    requireRow(get(ctx.db, "SELECT id FROM expense_categories WHERE id = ? AND status = 'active'", input.categoryId), 'expense category', input.categoryId);
    const accountId = resolveAccount(ctx, input.accountId);
    const docNo = nextDocNo(ctx, 'EXP');
    const id = run(
      ctx.db,
      "INSERT INTO expenses(doc_no, category_id, amount, account_id, payee, note, business_date, status, user_id, created_at) VALUES(?,?,?,?,?,?,?,'posted',?,?)",
      docNo, input.categoryId, input.amount, accountId, input.payee ?? '', input.note ?? '', input.date, ctx.userId, ctx.now()
    ).id;
    postCash(ctx, { accountId, date: input.date, amount: -input.amount, source: 'expense', refType: 'expense', refId: id, note: input.payee, fundId: input.fundId ?? null });
    audit(ctx, { action: 'expense.create', entity: 'expense', entityId: id, after: { docNo, amount: input.amount, ...(input.fundId ? { fundId: input.fundId } : {}) } });
    return { id, docNo };
  });
}

export function voidExpense(ctx: Ctx, expenseId: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void an expense');
  tx(ctx, () => {
    const e = requireRow(get<{ id: number; status: string; business_date: string }>(ctx.db, 'SELECT id, status, business_date FROM expenses WHERE id = ?', expenseId), 'expense', expenseId);
    if (e.status === 'void') throw new PetraError('ALREADY_VOID', 'this expense is already void');
    assertDateOpen(ctx, e.business_date);
    reverseDocument(ctx, 'expense', expenseId, e.business_date, `Void: ${reason}`);
    run(ctx.db, "UPDATE expenses SET status = 'void', void_reason = ? WHERE id = ?", reason, expenseId);
    audit(ctx, { action: 'expense.void', entity: 'expense', entityId: expenseId, reason });
  });
}

// ===== Salary =====

export interface SalaryAdjustment { employeeId: number; bonus?: number; deduction?: number }

/**
 * "Generate salary sheet" (section 5.12): one `salary_due` ledger entry per active employee for the month.
 * Salary expense in the profit report is taken from these sheets by month.
 */
export function generateSalarySheet(ctx: Ctx, input: { month: string; date: string; adjustments?: SalaryAdjustment[] }): { id: number; total: number; lines: number } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new PetraError('INVALID_INPUT', 'month must look like 2026-10', { field: 'month' });
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    if (get(ctx.db, "SELECT id FROM salary_sheets WHERE month = ? AND status = 'posted'", input.month)) throw new PetraError('DUPLICATE', 'a salary sheet for this month already exists', { what: 'salary sheet' });
    const emps = all<{ id: number; base_salary: number }>(ctx.db, "SELECT id, base_salary FROM employees WHERE status = 'active' ORDER BY id");
    const adj = new Map((input.adjustments ?? []).map((a) => [a.employeeId, a]));
    const sheetId = run(ctx.db, "INSERT INTO salary_sheets(month, business_date, total, status, user_id, created_at) VALUES(?,?,0,'posted',?,?)", input.month, input.date, ctx.userId, ctx.now()).id;
    let total = 0;
    let count = 0;
    for (const e of emps) {
      const a = adj.get(e.id);
      const bonus = a?.bonus ?? 0;
      const deduction = a?.deduction ?? 0;
      if (!Number.isSafeInteger(bonus) || bonus < 0 || !Number.isSafeInteger(deduction) || deduction < 0) throw new PetraError('INVALID_INPUT', 'bonus and deduction must be non-negative whole numbers', { field: 'bonus' });
      const net = e.base_salary + bonus - deduction;
      if (net < 0) throw new PetraError('INVALID_INPUT', 'deduction is more than the salary', { field: 'deduction' });
      if (e.base_salary === 0 && bonus === 0 && deduction === 0) continue;
      run(ctx.db, 'INSERT INTO salary_lines(sheet_id, employee_id, base, bonus, deduction, net) VALUES(?,?,?,?,?,?)', sheetId, e.id, e.base_salary, bonus, deduction, net);
      if (net !== 0) postLedger(ctx, { partyKind: 'employee', partyId: e.id, kind: 'salary_due', amount: net, refType: 'salary_sheet', refId: sheetId, date: input.date, note: input.month });
      total += net;
      count++;
    }
    if (count === 0) throw new PetraError('INVALID_INPUT', 'no employee has a salary to pay', { field: 'employees' });
    run(ctx.db, 'UPDATE salary_sheets SET total = ? WHERE id = ?', total, sheetId);
    audit(ctx, { action: 'salary_sheet.create', entity: 'salary_sheet', entityId: sheetId, after: { month: input.month, total, lines: count } });
    return { id: sheetId, total, lines: count };
  });
}

export function voidSalarySheet(ctx: Ctx, sheetId: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void a salary sheet');
  tx(ctx, () => {
    const s = requireRow(get<{ id: number; status: string; business_date: string }>(ctx.db, 'SELECT id, status, business_date FROM salary_sheets WHERE id = ?', sheetId), 'salary sheet', sheetId);
    if (s.status === 'void') throw new PetraError('ALREADY_VOID', 'this salary sheet is already void');
    assertDateOpen(ctx, s.business_date);
    reverseDocument(ctx, 'salary_sheet', sheetId, s.business_date, `Void: ${reason}`);
    run(ctx.db, "UPDATE salary_sheets SET status = 'void', void_reason = ? WHERE id = ?", reason, sheetId);
    audit(ctx, { action: 'salary_sheet.void', entity: 'salary_sheet', entityId: sheetId, reason });
  });
}
