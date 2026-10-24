import { test, expect } from '@playwright/test';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launch, completeSetup, inv, navTo, signInPin } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

test('money side: expense, void, employee, salary sheet, pay, cash book, close day, reopen, integrity', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  // 50,000 of cash comes in from a customer so the drawer has something in it
  const cust = await inv<{ id: number }>(page, 'customer:save', { name: 'Karim Store', phone: '01711111111', type: 'wholesale', creditLimit: 0, openingBalance: 6000000, openingDate: today });
  await inv(page, 'payment:save', { partyKind: 'customer', partyId: cust.id, amount: 5000000, date: today });
  await page.reload();

  // expenses: add two, void one
  await navTo(page, 'Expenses');
  await page.getByTestId('add-expense').click();
  await page.getByTestId('exp-amount').fill('1500');
  await page.getByTestId('exp-payee').fill('Shop rent');
  await page.getByTestId('exp-save').click();
  await expect(page.getByRole('row').filter({ hasText: 'Shop rent' })).toBeVisible();
  await page.getByTestId('add-expense').click();
  await page.getByTestId('exp-amount').fill('2000');
  await page.getByTestId('exp-payee').fill('Tea and snacks');
  await page.getByTestId('exp-save').click();
  await expect(page.getByRole('row').filter({ hasText: 'Tea and snacks' })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Tea and snacks' }).getByRole('button', { name: 'Void' }).click();
  await page.getByTestId('exp-void-reason').fill('Entered twice');
  await page.getByTestId('exp-void-confirm').click();
  await expect(page.getByRole('row').filter({ hasText: 'Tea and snacks' }).getByText('Void')).toBeVisible();
  await expect(page.locator('.p-stat').filter({ hasText: 'Total expenses' })).toContainText('1,500');

  // an employee with a monthly salary, a salary sheet for this month, then pay it
  await navTo(page, 'Employees');
  await page.getByTestId('add-employee').click();
  await page.getByTestId('emp-name').fill('Sumon');
  await page.getByTestId('emp-salary').fill('12000');
  await page.getByTestId('emp-save').click();
  await page.getByRole('tab', { name: 'Salary sheets' }).click();
  await page.getByTestId('sal-generate').click();
  await page.getByTestId('sal-confirm').click();
  await expect(page.getByRole('row').filter({ hasText: today.slice(0, 7) })).toBeVisible();
  await page.getByRole('tab', { name: 'Employees' }).click();
  await page.getByRole('row').filter({ hasText: 'Sumon' }).click();
  await expect(page.getByTestId('emp-balance')).toContainText('12,000');
  await page.getByTestId('emp-pay').click();
  await page.getByTestId('emp-pay-amount').fill('12000');
  await page.getByTestId('emp-pay-save').click();
  await expect(page.getByTestId('emp-balance')).toContainText('0');
  await expect(page.getByTestId('emp-balance')).not.toContainText('12,000');
  await page.keyboard.press('Escape');

  // cash book: 50,000 in, 1,500 + 12,000 out
  await navTo(page, 'Expenses');
  await page.getByRole('tab', { name: 'Cash book' }).click();
  await expect(page.getByTestId('cash-closing')).toContainText('36,500');

  // close the day with 500 missing
  await page.getByRole('tab', { name: 'Close day' }).click();
  await expect(page.getByTestId('day-expected')).toContainText('36,500');
  await page.getByTestId('day-counted').fill('36000');
  await expect(page.getByTestId('day-diff')).toContainText('Short');
  await page.getByTestId('day-close').click();
  await page.getByTestId('day-confirm').click();
  await expect(page.getByTestId('day-closed-diff')).toContainText('500');
  await expect(inv(page, 'exp:save', { categoryId: 1, amount: 100, date: today })).rejects.toThrow();

  // only the Owner reopens; a posting is then allowed and the day can be closed again
  await page.getByTestId('day-reopen').click();
  await page.getByTestId('day-reopen-reason').fill('Forgot the delivery charge');
  await page.getByTestId('day-reopen-confirm').click();
  await expect(page.getByTestId('day-counted')).toBeVisible();
  await inv(page, 'exp:save', { categoryId: 1, amount: 10000, date: today });
  await page.getByTestId('day-counted').fill('35900');
  await page.getByTestId('day-close').click();
  await page.getByTestId('day-confirm').click();
  await expect(page.getByTestId('day-closed-diff')).toContainText('500');

  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = checkIntegrity(db);
  db.close();
  expect(formatViolations(v)).toBe('');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('money side: staff cannot reach expenses, salary, cash book or day closing', async () => {
  const { app, page } = await launch();
  await completeSetup(page, { lang: 'en' });
  await inv(page, 'users:create', { username: 'stf', displayName: 'Sumon', role: 'staff', kind: 'pin', secret: '2222' });
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  await signInPin(page, '2222', 'Sumon');
  await expect(page.getByTestId('account')).toContainText('Sumon');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'People' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Money' })).toHaveCount(0);
  for (const ch of ['exp:list', 'emp:list', 'salary:list', 'cash:book', 'day:status']) {
    await expect(inv(page, ch, ch === 'exp:list' ? { includeVoid: true } : ch === 'emp:list' ? { includeArchived: false } : ch === 'cash:book' ? {} : undefined)).rejects.toThrow();
  }
  await nav.getByRole('link', { name: 'People' }).click();
  await expect(page.getByRole('tab', { name: 'Customers' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Employees' })).toHaveCount(0);
  await app.close();
});
