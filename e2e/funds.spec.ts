import { test, expect } from '@playwright/test';
import { launch, completeSetup, inv, navTo } from './helpers';

test('funds: the owner adds a DSR fund; a classified expense shows its fund in the cash book, once', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;

  await navTo(page, 'Expenses');
  await page.getByRole('tab', { name: 'Funds' }).click();
  await expect(page.getByText('No funds yet')).toBeVisible();
  await page.getByTestId('add-fund').click();
  await page.getByTestId('fund-code-input').fill('dsr');
  await page.getByTestId('fund-name').fill('DSR fund');
  await page.getByTestId('fund-save').click();
  await expect(page.getByTestId('fund-code')).toHaveText('DSR');

  // the same code again is refused with a clear message
  await page.getByTestId('add-fund').click();
  await page.getByTestId('fund-code-input').fill('DSR');
  await page.getByTestId('fund-name').fill('Another');
  await page.getByTestId('fund-save').click();
  await expect(page.getByTestId('fund-error')).toBeVisible();
  await page.keyboard.press('Escape');

  // one DSR expense and one ordinary expense; only the first carries the fund
  const [fund] = await inv<{ id: number }[]>(page, 'fund:list', { includeInactive: false });
  const cat = (await inv<{ id: number }[]>(page, 'exp:categories', { includeArchived: false }))[0]!;
  await inv(page, 'exp:save', { categoryId: cat.id, amount: 30000, date: today, payee: 'Fuel', fundId: fund!.id });
  await inv(page, 'exp:save', { categoryId: cat.id, amount: 5000, date: today, payee: 'Tea' });
  await page.getByRole('tab', { name: 'Cash book' }).click();
  await expect(page.getByRole('columnheader', { name: 'Fund' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Fuel' }).getByText('DSR', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Tea' }).getByText('DSR', { exact: true })).toHaveCount(0);
  const book = await inv<{ totalOut: number }>(page, 'cash:book', {});
  expect(book.totalOut).toBe(35000); // each expense counted once

  expect(consoleErrors).toEqual([]);
  await app.close();
});
