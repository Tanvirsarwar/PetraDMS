import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { launch, completeSetup, inv, navTo } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

async function seed(page: Page) {
  const cust = await inv<{ id: number }>(page, 'customer:save', { name: 'Karim Store', phone: '01711111111', type: 'wholesale', creditLimit: 0, openingBalance: 0 });
  const sup = await inv<{ id: number }>(page, 'catalog:supplierSave', { name: 'Marks Ltd' });
  const milk = await inv<{ id: number }>(page, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk 500g', baseUnit: 'pcs', priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, favourite: true });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  await inv(page, 'purchase:save', { supplierId: sup.id, date: today, lines: [{ productId: milk.id, qty: 100, unitCost: 40000 }], paid: 0 });
  await page.reload();
  return { cust, milk };
}

test('documents post once: a double-clicked Save on the sale, the sale return and the stock adjustment', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const { milk } = await seed(page);

  // sale: double click on Save
  await navTo(page, 'Sales');
  await page.getByTestId('pos-search').fill('Marks');
  await page.getByTestId('pos-search').press('Enter');
  await page.getByTestId('pos-qty-0').fill('10');
  await page.getByTestId('pos-save').dblclick();
  await expect(page.getByTestId('pos-done')).toBeVisible();
  await expect(page.getByTestId('done-docno')).toHaveText('INV-000001');
  const sales = await inv<{ id: number }[]>(page, 'sale:list', {});
  expect(sales).toHaveLength(1);

  // sale return: double click on Return
  await page.getByTestId('pos-new').click();
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await page.getByRole('row', { name: /INV-000001/ }).click();
  await page.getByTestId('sale-return').click();
  await page.getByTestId('sret-qty-1').fill('2');
  await page.getByTestId('return-save').dblclick();
  await expect(page.getByText('Return recorded')).toBeVisible();
  await expect(page.getByTestId('return-save')).toBeHidden();
  const detail = await inv<{ returns: { id: number }[] }>(page, 'sale:get', { id: sales[0]!.id });
  expect(detail.returns).toHaveLength(1);

  // stock adjustment: double click on Save
  await page.keyboard.press('Escape');
  await expect(page.locator('.p-scrim')).toHaveCount(0);
  await navTo(page, 'Inventory');
  await page.getByRole('tab', { name: 'Adjustments' }).click();
  await page.getByTestId('new-adjustment').click();
  await page.locator('input[role="combobox"]').last().fill('MLK');
  await page.locator('input[role="combobox"]').last().press('Enter');
  await page.getByTestId('adjust-kind').selectOption('damage');
  await page.getByTestId('adjust-qty').fill('3');
  await page.getByTestId('adjust-reason').fill('Broken in transit');
  await page.getByTestId('adjust-save').dblclick();
  await expect.poll(async () => (await inv<unknown[]>(page, 'stock:adjustments', {})).length).toBe(1);

  const products = await inv<{ id: number; stockQty: number }[]>(page, 'catalog:products', { includeArchived: false });
  // 100 bought - 10 sold + 2 returned - 3 damaged
  expect(products.find((p) => p.id === milk.id)!.stockQty).toBe(89);

  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = checkIntegrity(db);
  db.close();
  expect(formatViolations(v)).toBe('');
  expect(consoleErrors).toEqual([]);
  await app.close();
});
