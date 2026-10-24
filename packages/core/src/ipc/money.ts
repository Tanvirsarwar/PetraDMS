import { z } from 'zod';
import { ch, dateStr, none } from './define';

// ===== DTOs =====
export interface ExpenseCategoryDto {
  id: number;
  name: string;
  nameBn: string;
  status: 'active' | 'archived';
  /** Number of posted expenses in this category, so the editor can warn before archiving. */
  used: number;
}

export interface ExpenseDto {
  id: number;
  docNo: string;
  date: string;
  categoryId: number;
  categoryName: string;
  categoryNameBn: string;
  amount: number;
  accountId: number;
  accountName: string;
  payee: string;
  note: string;
  status: 'posted' | 'void';
  voidReason: string | null;
  userName: string;
}

export interface ExpenseList {
  rows: ExpenseDto[];
  /** Sum of posted (not void) rows in the filter. */
  total: number;
  byCategory: { categoryId: number; name: string; nameBn: string; total: number }[];
}

export interface EmployeeDto {
  id: number;
  name: string;
  nameBn: string;
  phone: string;
  jobTitle: string;
  baseSalary: number;
  /** Positive: the business owes the employee. Negative: the employee holds an advance. */
  balance: number;
  joinedOn: string | null;
  status: 'active' | 'archived';
}

export interface SalarySheetDto {
  id: number;
  month: string;
  date: string;
  total: number;
  lines: number;
  status: 'posted' | 'void';
  voidReason: string | null;
}

export interface SalaryLineDto {
  employeeId: number;
  name: string;
  nameBn: string;
  base: number;
  bonus: number;
  deduction: number;
  net: number;
}

export interface SalarySheetDetail extends SalarySheetDto {
  rows: SalaryLineDto[];
}

export interface FundDto {
  id: number;
  code: string;
  name: string;
  nameBn: string;
  kind: 'dsr';
  active: boolean;
  /** Cash movements classified to this fund, reversals included. */
  movements: number;
}

export interface CashbookRow {
  id: number;
  date: string;
  accountId: number;
  accountName: string;
  source: string;
  /** Signed poisha: positive in, negative out. */
  amount: number;
  balanceAfter: number;
  note: string;
  refNo: string;
  reversal: boolean;
  reversed: boolean;
  /** Fund the movement is classified to (null: ordinary business money). */
  fundId: number | null;
  fundCode: string | null;
}

export interface CashbookView {
  accountId: number | null;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  rows: CashbookRow[];
}

export interface DayClosingDto {
  id: number;
  date: string;
  opening: number;
  collections: number;
  expenses: number;
  expected: number;
  actual: number;
  difference: number;
  status: 'closed' | 'reopened';
  note: string;
  closedBy: string;
  closedAt: string;
  reopenReason: string | null;
}

export interface DayStatus {
  date: string;
  figures: { openingCash: number; collections: number; expenses: number; expectedCash: number };
  closing: DayClosingDto | null;
  /** Latest closed date, or null when no day has been closed yet. */
  lastClosed: string | null;
  /** Days before today that were never closed (a gentle reminder, not a block). */
  unclosedBefore: number;
}

// ===== Inputs =====
const poisha = z.number().int().min(0).max(9_000_000_000_000);
const posPoisha = z.number().int().positive().max(9_000_000_000_000);
const posId = z.number().int().positive();

export const fundSaveInput = z.object({
  id: posId.optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/, 'use 2 to 12 letters, digits, - or _'),
  name: z.string().trim().min(1).max(60),
  nameBn: z.string().trim().max(60).default(''),
  active: z.boolean().default(true)
});
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const reason = z.string().trim().min(1).max(300);
/** Optional id chosen by the screen when a form opens; sending it again (double click, retry) never posts twice. */
export const requestId = z.string().min(8).max(64).optional();
const range = z.object({ from: dateStr.optional(), to: dateStr.optional() });

export const expenseSaveInput = z.object({
  categoryId: posId,
  amount: posPoisha,
  date: dateStr,
  accountId: posId.nullable().default(null),
  payee: z.string().trim().max(80).default(''),
  note: z.string().trim().max(300).default(''),
  /** Fund (DSR) the expense is paid from; null for an ordinary business expense. */
  fundId: posId.nullable().default(null),
  requestId
});

export const expenseCategorySaveInput = z.object({
  id: posId.optional(),
  name: z.string().trim().min(1).max(60),
  nameBn: z.string().trim().max(60).default(''),
  archived: z.boolean().default(false)
});

export const employeeSaveInput = z.object({
  id: posId.optional(),
  name: z.string().trim().min(1).max(80),
  nameBn: z.string().trim().max(80).default(''),
  phone: z.string().trim().max(20).default(''),
  jobTitle: z.string().trim().max(60).default(''),
  baseSalary: poisha.default(0),
  joinedOn: dateStr.nullable().default(null)
});

export const employeePayInput = z.object({
  employeeId: posId,
  amount: posPoisha,
  date: dateStr,
  purpose: z.enum(['salary', 'advance']),
  accountId: posId.nullable().default(null),
  note: z.string().trim().max(300).default(''),
  requestId
});

export const salaryGenerateInput = z.object({
  month,
  date: dateStr,
  adjustments: z.array(z.object({ employeeId: posId, bonus: poisha.default(0), deduction: poisha.default(0) })).max(500).default([])
});

export const accountSaveInput = z.object({
  id: posId.optional(),
  name: z.string().trim().min(1).max(40),
  nameBn: z.string().trim().max(40).default(''),
  kind: z.enum(['cash', 'bank', 'bkash', 'nagad', 'other']).default('other'),
  /** Only used when the account is created. */
  openingBalance: poisha.default(0),
  date: dateStr.optional(),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true)
});

export const moneyChannels = {
  'exp:categories': ch<ExpenseCategoryDto[]>()(z.object({ includeArchived: z.boolean().default(false) }), { access: 'manager' }),
  'exp:categorySave': ch<{ id: number }>()(expenseCategorySaveInput, { access: 'manager', write: true }),
  'exp:list': ch<ExpenseList>()(range.extend({ categoryId: posId.optional(), accountId: posId.optional(), search: z.string().max(60).optional(), includeVoid: z.boolean().default(true) }), { access: 'manager' }),
  'exp:save': ch<{ id: number; docNo: string }>()(expenseSaveInput, { access: 'manager', write: true }),
  'exp:void': ch()(z.object({ id: posId, reason }), { access: 'manager', write: true }),

  'emp:list': ch<EmployeeDto[]>()(z.object({ includeArchived: z.boolean().default(false) }), { access: 'manager' }),
  'emp:save': ch<{ id: number }>()(employeeSaveInput, { access: 'manager', write: true }),
  'emp:archive': ch()(z.object({ id: posId, archived: z.boolean() }), { access: 'manager', write: true }),
  'emp:pay': ch<{ id: number; docNo: string }>()(employeePayInput, { access: 'manager', write: true }),

  'salary:list': ch<SalarySheetDto[]>()(none, { access: 'manager' }),
  'salary:get': ch<SalarySheetDetail>()(z.object({ id: posId }), { access: 'manager' }),
  'salary:generate': ch<{ id: number; total: number; lines: number }>()(salaryGenerateInput, { access: 'manager', write: true }),
  'salary:void': ch()(z.object({ id: posId, reason }), { access: 'manager', write: true }),

  'money:accountSave': ch<{ id: number }>()(accountSaveInput, { access: 'owner', write: true }),
  'fund:list': ch<FundDto[]>()(z.object({ includeInactive: z.boolean().default(false) }), { access: 'manager' }),
  'fund:save': ch<{ id: number }>()(fundSaveInput, { access: 'owner', write: true }),
  'cash:book': ch<CashbookView>()(range.extend({ accountId: posId.optional() }), { access: 'manager' }),

  'day:status': ch<DayStatus>()(z.object({ date: dateStr.optional() }), { access: 'manager' }),
  'day:close': ch<{ id: number; difference: number; expectedCash: number }>()(z.object({ date: dateStr, actualCash: poisha, note: z.string().trim().max(300).default('') }), { access: 'manager', write: true }),
  'day:reopen': ch()(z.object({ date: dateStr, reason }), { access: 'owner', write: true }),
  'day:history': ch<DayClosingDto[]>()(z.object({ limit: z.number().int().min(1).max(366).default(60) }), { access: 'manager' })
};
