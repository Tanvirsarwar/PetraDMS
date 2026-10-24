import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { launch, completeSetup } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

async function go(page: Page, name: string) {
  await page.locator('nav').getByRole('link', { name, exact: true }).click();
}

async function addProduct(page: Page, o: { sku: string; name: string; retail: string; wholesale: string; expiry?: boolean }) {
  await page.getByTestId('add-product').click();
  await page.getByTestId('product-sku').fill(o.sku);
  await page.getByTestId('product-name').fill(o.name);
  await page.getByTestId('product-retail').fill(o.retail);
  await page.getByTestId('product-wholesale').fill(o.wholesale);
  if (o.expiry) await page.getByRole('switch', { name: 'Track expiry dates' }).click();
  await page.getByTestId('product-save').click();
  await expect(page.getByRole('row', { name: new RegExp(o.sku) })).toBeVisible();
}

/** Products without a box are bought in pieces: the Pcs column of the bulk grid. */
async function addLine(page: Page, search: string, idx: number, qty: string, cost: string) {
  const picker = page.locator('input[role="combobox"]').last();
  await picker.fill(search);
  await picker.press('Enter');
  await page.getByTestId(`line-pcs-${idx}`).fill(qty);
  await page.getByTestId(`line-cost-${idx}`).fill(cost);
}

test('catalog and inbound: products, supplier, purchase with expiry, payment, void, adjustment, integrity I1-I3', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });

  // products, one with expiry tracking and a carton pack
  await go(page, 'Products');
  await addProduct(page, { sku: 'NDL-01', name: 'Shah Noodles 60g', retail: '12', wholesale: '10' });
  await addProduct(page, { sku: 'MLK-01', name: 'Milk Powder 500g', retail: '600', wholesale: '560', expiry: true });
  await expect(page.getByRole('row', { name: /NDL-01/ })).toContainText('Shah Noodles 60g');

  // supplier
  await go(page, 'Suppliers');
  await page.getByTestId('add-supplier').click();
  await page.getByTestId('supplier-name').fill('Shah Foods Ltd');
  await page.getByTestId('supplier-save').click();
  await expect(page.getByRole('row', { name: /Shah Foods Ltd/ })).toBeVisible();

  // purchase 1: noodles on credit
  await go(page, 'Purchases');
  await page.getByTestId('new-purchase').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: 'Shah Foods Ltd' });
  await addLine(page, 'NDL', 0, '100', '8');
  await expect(page.getByTestId('purchase-total')).toContainText('800');
  await page.getByTestId('purchase-paid').fill('300');
  await expect(page.getByTestId('purchase-due')).toContainText('500');
  await page.getByTestId('purchase-save').click();
  await expect(page.getByRole('row', { name: /PUR-/ })).toBeVisible();

  // purchase 2: milk powder needs an expiry before it can be saved
  await page.getByTestId('new-purchase').click();
  await addLine(page, 'MLK', 0, '10', '500');
  await expect(page.getByTestId('purchase-save')).toBeDisabled();
  await page.getByTestId('line-expiry-0').fill('31-12-2030');
  await page.getByTestId('line-batch-0').fill('B-77');
  await expect(page.getByTestId('purchase-save')).toBeEnabled();
  await page.getByTestId('purchase-save').click();
  await expect(page.getByRole('row', { name: /PUR-/ })).toHaveCount(2);

  // stock shows both and the expiry tab lists the batch
  await go(page, 'Inventory');
  await expect(page.getByTestId('stock-NDL-01')).toContainText('100');
  await expect(page.getByTestId('stock-MLK-01')).toContainText('10');
  await page.getByRole('tab', { name: 'Batches & expiry' }).click();
  await expect(page.getByRole('row', { name: /B-77/ })).toBeVisible();

  // adjustment: 5 noodles damaged, then undone
  await page.getByRole('tab', { name: 'Adjustments' }).click();
  await page.getByTestId('new-adjustment').click();
  await page.locator('input[role="combobox"]').last().fill('NDL');
  await page.locator('input[role="combobox"]').last().press('Enter');
  await page.getByTestId('adjust-kind').selectOption('damage');
  await page.getByTestId('adjust-qty').fill('5');
  await page.getByTestId('adjust-reason').fill('Water damage');
  await page.getByTestId('adjust-save').click();
  await expect(page.getByRole('row', { name: /ADJ-/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Stock' }).click();
  await expect(page.getByTestId('stock-NDL-01')).toContainText('95');

  // void the noodle purchase from its drawer
  await go(page, 'Purchases');
  await page.getByRole('row', { name: /PUR-/ }).first().click();
  await page.getByTestId('purchase-void').click();
  await page.getByTestId('void-reason').fill('Entered by mistake');
  await page.getByTestId('void-confirm').click();
  await expect(page.getByText('Cancelled').first()).toBeVisible();

  // the database invariants I1-I10 hold after all of this
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const violations = checkIntegrity(db);
  db.close();
  expect(formatViolations(violations)).toBe('');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('staff cannot see costs or the purchase screens', async () => {
  const { app, page } = await launch();
  await completeSetup(page, { lang: 'en' });
  await go(page, 'Settings');
  await page.getByRole('tab', { name: 'Users' }).click();
  await page.getByTestId('add-user').click();
  await page.getByTestId('user-name').fill('Karim');
  await page.getByTestId('user-username').fill('karim');
  await page.getByTestId('user-role').selectOption('staff');
  const pw = page.getByRole('dialog').locator('input[type="password"]');
  await pw.nth(0).fill('2222');
  await pw.nth(1).fill('2222');
  await page.getByTestId('user-save').click();
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  await page.getByRole('button', { name: /Karim/ }).click();
  for (const d of '2222') await page.locator('.keypad').getByRole('button', { name: d, exact: true }).click();
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('account')).toContainText('Karim');
  await expect(page.locator('nav').getByRole('link', { name: 'Buy', exact: true })).toHaveCount(0);
  await go(page, 'Stock');
  await expect(page.getByTestId('stock-search')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Stock value' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Movements' })).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = '#/products'; });
  await expect(page.getByRole('heading', { name: 'Products', level: 2 })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Average cost' })).toHaveCount(0);
  await app.close();
});
