import { PetraError } from '@petra/core';
import type { Dispatcher } from './dispatcher';
import { currentBusinessDate } from './coreServices';
import { loadSettings } from '../settings';
import { postExpense, postPayment, voidExpense, generateSalarySheet, voidSalarySheet } from '../money';
import { closeDay, reopenDay } from '../dayclose';
import { listFunds, saveFund } from '../funds';
import {
  archiveEmployee, cashBook, dayHistory, dayStatus, getSalarySheet, listEmployees, listExpenseCategories, listExpenses, listSalarySheets, saveAccount, saveEmployee, saveExpenseCategory
} from './moneyApp';

/** Phase 7: expenses, employees and salary, money accounts, cash book and day closing. Every channel needs Manager or above. */
export function registerMoneyServices(d: Dispatcher): void {
  const today = (ctx: Parameters<typeof currentBusinessDate>[0]) => currentBusinessDate(ctx, loadSettings(ctx.db));

  d.register('exp:categories', ({ ctx, input }) => listExpenseCategories(ctx, input.includeArchived));
  d.register('exp:categorySave', ({ ctx, input }) => ({ id: saveExpenseCategory(ctx, input) }));
  d.register('exp:list', ({ ctx, input }) => listExpenses(ctx, input));
  d.register('fund:list', ({ ctx, input }) => listFunds(ctx, input.includeInactive));
  d.register('fund:save', ({ ctx, input }) => ({ id: saveFund(ctx, input) }));
  d.register('exp:save', ({ ctx, input }) => postExpense(ctx, input));
  d.register('exp:void', ({ ctx, input }) => {
    voidExpense(ctx, input.id, input.reason);
    return null;
  });

  d.register('emp:list', ({ ctx, input }) => listEmployees(ctx, input.includeArchived));
  d.register('emp:save', ({ ctx, input }) => ({ id: saveEmployee(ctx, input) }));
  d.register('emp:archive', ({ ctx, input }) => {
    archiveEmployee(ctx, input.id, input.archived);
    return null;
  });
  d.register('emp:pay', ({ ctx, input }) => postPayment(ctx, { partyKind: 'employee', partyId: input.employeeId, amount: input.amount, date: input.date, accountId: input.accountId, purpose: input.purpose, note: input.note, requestId: input.requestId }));

  d.register('salary:list', ({ ctx }) => listSalarySheets(ctx));
  d.register('salary:get', ({ ctx, input }) => getSalarySheet(ctx, input.id));
  d.register('salary:generate', ({ ctx, input }) => generateSalarySheet(ctx, input));
  d.register('salary:void', ({ ctx, input }) => {
    voidSalarySheet(ctx, input.id, input.reason);
    return null;
  });

  d.register('money:accountSave', ({ ctx, input }) => ({ id: saveAccount(ctx, input, today(ctx)) }));
  d.register('cash:book', ({ ctx, input }) => cashBook(ctx, input));

  d.register('day:status', ({ ctx, input }) => dayStatus(ctx, input.date ?? today(ctx)));
  d.register('day:close', ({ ctx, input }) => {
    if (input.date > today(ctx)) throw new PetraError('INVALID_INPUT', 'a day that has not started cannot be closed', { field: 'date' });
    return closeDay(ctx, input);
  });
  d.register('day:reopen', ({ ctx, input }) => {
    reopenDay(ctx, input.date, input.reason);
    return null;
  });
  d.register('day:history', ({ ctx, input }) => dayHistory(ctx, input.limit));
}
