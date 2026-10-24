import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { launch, completeSetup, inv, navTo, signInPin } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

async function seed(page: Page) {
  const area = await inv<{ id: number }>(page, 'area:save', { name: 'Zindabazar' });
  const cust = await inv<{ id: number }>(page, 'customer:save', { name: 'Karim Store', phone: '01711111111', areaId: area.id, type: 'wholesale', creditLimit: 0, openingBalance: 245000 });
  const sup = await inv<{ id: number }>(page, 'catalog:supplierSave', { name: 'Marks Ltd' });
  const milk = await inv<{ id: number }>(page, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk 500g', nameBn: 'মার্কস দুধ', baseUnit: 'pcs', priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, minPrice: 48000, favourite: true });
  const tea = await inv<{ id: number }>(page, 'catalog:productSave', { sku: 'TEA', name: 'Sylon Tea 400g', baseUnit: 'pcs', priceRetail: 45000, priceWholesale: 42000, priceDealer: 40000, favourite: true });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  await inv(page, 'purchase:save', { supplierId: sup.id, date: today, lines: [{ productId: milk.id, qty: 100, unitCost: 40000 }, { productId: tea.id, qty: 50, unitCost: 33000 }], paid: 0 });
  await page.reload();
  return { cust, milk, tea };
}

test('POS: golden invoice, draft restore, detail, PDF with Bangla, return, void, integrity', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);
  await navTo(page, 'Sales');

  // draft: add a line, wait for the autosave, reload the window, the cart comes back
  await page.getByTestId('pos-search').fill('Marks');
  await page.getByTestId('pos-search').press('Enter');
  await expect(page.getByTestId('cart-line-0')).toBeVisible();
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByTestId('cart-line-0')).toBeVisible();
  await expect(page.getByText('Your unsaved sale was restored.')).toBeVisible();

  // customer by keyboard (F3), wholesale price list applies
  await page.keyboard.press('F3');
  await page.getByTestId('cust-search').fill('Karim');
  await page.getByTestId('cust-search').press('Enter');
  await expect(page.getByTestId('pos-cust-due')).toContainText('2,450');
  await page.getByTestId('pos-qty-0').fill('10');
  await page.getByTestId('pos-search').fill('Sylon');
  await page.getByTestId('pos-search').press('Enter');
  await page.getByTestId('pos-qty-1').fill('5');
  await page.getByTestId('pos-disc-1').fill('10');
  await page.getByTestId('pos-bonus-1').click();
  await page.getByTestId('pos-inv-disc').fill('5');
  await page.getByTestId('pos-paid').fill('2000');

  // 10 x 520 = 5,200 + (5 x 420 - 10% = 1,890) = 7,090; 5% = 354.50; total 6,735.50; due 4,735.50
  await expect(page.getByTestId('pos-subtotal')).toContainText('7,090');
  await expect(page.getByTestId('pos-total')).toContainText('6,735.50');
  await expect(page.getByTestId('pos-due')).toContainText('4,735.50');
  await page.getByTestId('pos-save').click();
  await expect(page.getByTestId('pos-done')).toBeVisible();
  await expect(page.getByTestId('done-docno')).toHaveText('INV-000001');

  // PDF from the done dialog (Bangla fonts embedded), written to the invoices folder
  await page.getByTestId('print-pdf').click();
  const pdf = path.join(dataDir, 'invoices', 'INV-000001.pdf');
  await expect.poll(() => fs.existsSync(pdf), { timeout: 20_000 }).toBe(true);
  const bytes = fs.readFileSync(pdf);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(8_000);
  await page.getByTestId('pos-new').click();

  // invoices tab: detail with the khata footer
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await page.getByRole('row', { name: /INV-000001/ }).click();
  await expect(page.getByTestId('detail-total')).toContainText('6,735.50');
  await expect(page.getByTestId('detail-prev')).toContainText('2,450');
  await expect(page.getByTestId('detail-curr')).toContainText('7,185.50');
  await expect(page.getByTestId('detail-profit')).toContainText('755.50'); // 6,735.50 - (10x400 + 6x330 = 5,980)... see below

  // return 2 milk, refunded against the due
  await page.getByTestId('sale-return').click();
  await page.getByTestId('sret-qty-1').fill('2');
  await page.getByTestId('return-save').click();
  await expect(page.getByText('Return recorded')).toBeVisible();

  // void is refused while a return stands, then works after the return is undone
  await page.getByTestId('sale-void').click();
  await page.getByTestId('void-reason').fill('Wrong customer');
  await page.getByTestId('void-confirm').click();
  await expect(page.getByRole('alert').filter({ hasText: 'returns' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.getByTestId('sale-void').click();
  await page.getByTestId('void-reason').fill('Wrong customer');
  await page.getByTestId('void-confirm').click();
  await expect(page.getByText('Cancelled').first()).toBeVisible();

  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = checkIntegrity(db);
  db.close();
  expect(formatViolations(v)).toBe('');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('POS: staff need manager approval below the minimum price; staff see no cost', async () => {
  const { app, page } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);
  await inv(page, 'users:create', { username: 'mgr', displayName: 'Mahin', role: 'manager', kind: 'pin', secret: '1111' });
  await inv(page, 'users:create', { username: 'stf', displayName: 'Sumon', role: 'staff', kind: 'pin', secret: '2222' });
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  await signInPin(page, '2222', 'Sumon');
  await expect(page.getByTestId('account')).toContainText('Sumon');
  await navTo(page, 'Sell');

  await page.getByTestId('pos-search').fill('Marks');
  await page.getByTestId('pos-search').press('Enter');
  await page.getByTestId('pos-price-0').fill('400'); // below the 480 minimum
  await page.getByTestId('pos-save').click();
  await expect(page.getByTestId('approve-secret')).toBeVisible();
  await page.getByTestId('approve-user').selectOption({ label: 'Mahin (Manager)' });
  await page.getByTestId('approve-secret').fill('9999');
  await page.getByTestId('approve-go').click();
  await expect(page.getByTestId('approve-error')).toBeVisible();
  await page.getByTestId('approve-secret').fill('1111');
  await page.getByTestId('approve-go').click();
  await expect(page.getByTestId('pos-done')).toBeVisible();
  await page.getByTestId('pos-new').click();

  // staff never see cost or profit in the invoice list or detail
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await expect(page.getByRole('columnheader', { name: 'Profit' })).toHaveCount(0);
  await page.getByRole('row', { name: /INV-000001/ }).click();
  await expect(page.getByTestId('detail-profit')).toHaveCount(0);
  await expect(page.getByTestId('sale-void')).toHaveCount(0);
  await app.close();
});
