import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launch, completeSetup, inv, navTo, signInPin } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

async function seed(page: import('@playwright/test').Page) {
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  const area = await inv<{ id: number }>(page, 'area:save', { name: 'Zindabazar' });
  const cust = await inv<{ id: number }>(page, 'customer:save', { name: 'Karim Store', phone: '01711111111', areaId: area.id, type: 'wholesale', creditLimit: 0, openingBalance: 245000, openingDate: today });
  const sup = await inv<{ id: number }>(page, 'catalog:supplierSave', { name: 'Marks Ltd' });
  const milk = await inv<{ id: number }>(page, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk 500g', baseUnit: 'pcs', priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, minPrice: 48000, favourite: true });
  await inv(page, 'purchase:save', { supplierId: sup.id, date: today, lines: [{ productId: milk.id, qty: 100, unitCost: 40000 }], paid: 0 });
  // 10 milk at 520 = 5,200 net sales, 4,000 cost, 1,200 profit; 2,000 paid, 3,200 due
  await inv(page, 'sale:save', { date: today, customerId: cust.id, lines: [{ productId: milk.id, qty: 10 }], paid: 200000 });
  const cat = (await inv<{ id: number }[]>(page, 'exp:categories', { includeArchived: false }))[0]!;
  await inv(page, 'exp:save', { categoryId: cat.id, amount: 15000, date: today });
  return today;
}

test('dashboard and reports: figures, quick actions, CSV, Excel, PDF, integrity', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const today = await seed(page);
  await page.reload();

  // Owner lands on the dashboard with the six quick actions
  await expect(page.getByTestId('quick-actions').getByRole('button')).toHaveCount(6);
  await expect(page.getByTestId('dash-today-sales')).toContainText('5,200');
  await expect(page.getByTestId('dash-today-profit')).toContainText('1,200');
  await expect(page.getByTestId('dash-month-net')).toContainText('1,050'); // 1,200 profit - 150 expense
  await expect(page.getByTestId('dash-cash')).toContainText('1,850'); // 2,000 received at the counter - 150 expense
  await page.getByTestId('qa-customer').click();
  await expect(page.getByTestId('customer-name')).toBeVisible();
  await page.keyboard.press('Escape');

  // reports
  await navTo(page, 'Reports');
  await expect(page.locator('tbody tr').filter({ hasText: 'Net sales' })).toContainText('5,200');
  await expect(page.locator('tbody tr').filter({ hasText: 'Net profit' })).toContainText('1,050');
  await page.getByTestId('report-pick').selectOption('aging');
  await expect(page.locator('tbody tr').filter({ hasText: 'Karim Store' })).toContainText('5,650');
  await expect(page.locator('tfoot')).toContainText('5,650');
  await page.getByTestId('report-pick').selectOption('collection');
  await expect(page.locator('tbody tr').filter({ hasText: 'Zindabazar' })).toContainText('Karim Store');

  // CSV, Excel and PDF land in the exports folder
  await page.getByTestId('report-pick').selectOption('aging');
  await expect(page.locator('tfoot')).toContainText('5,650');
  const exp = path.join(dataDir, 'exports');
  await page.getByTestId('report-csv').click();
  await expect.poll(() => fs.existsSync(path.join(exp, `aging-${today}.csv`))).toBe(true);
  const csv = fs.readFileSync(path.join(exp, `aging-${today}.csv`), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('Karim Store');
  expect(csv).toContain('5650.00');
  await page.getByTestId('report-xlsx').click();
  await expect.poll(() => fs.existsSync(path.join(exp, `aging-${today}.xlsx`))).toBe(true);
  expect(fs.readFileSync(path.join(exp, `aging-${today}.xlsx`)).subarray(0, 2).toString()).toBe('PK');
  await page.getByTestId('report-pick').selectOption('summary');
  await page.getByTestId('report-pdf').click();
  await expect.poll(() => fs.existsSync(path.join(exp, `summary-${today}.pdf`))).toBe(true);
  expect(fs.readFileSync(path.join(exp, `summary-${today}.pdf`)).subarray(0, 5).toString()).toBe('%PDF-');

  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = checkIntegrity(db);
  db.close();
  expect(formatViolations(v)).toBe('');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('reports: staff see only safe reports, never profit', async () => {
  const { app, page } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);
  await inv(page, 'users:create', { username: 'stf', displayName: 'Sumon', role: 'staff', kind: 'pin', secret: '2222' });
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  await signInPin(page, '2222', 'Sumon');
  await expect(page.getByTestId('account')).toContainText('Sumon');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByTestId('report-pick')).toBeVisible();
  const options = await page.getByTestId('report-pick').locator('option').allTextContents();
  expect(options).toContain('Due aging');
  expect(options).not.toContain('Profit by product');
  expect(options).not.toContain('Cash book');
  await expect(page.locator('tbody tr').filter({ hasText: 'Net sales' })).toContainText('5,200');
  await expect(page.getByText('Net profit')).toHaveCount(0);
  await expect(page.getByText('Cost of goods sold')).toHaveCount(0);
  await expect(page.getByTestId('report-csv')).toHaveCount(0);
  await app.close();
});
