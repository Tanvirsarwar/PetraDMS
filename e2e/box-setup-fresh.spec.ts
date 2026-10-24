import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { ProductDto } from '../packages/core/src';
import { launch, completeSetup, inv, navTo } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

const integrity = (dataDir: string) => {
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = formatViolations(checkIntegrity(db as never));
  db.close();
  return v;
};

test('product editor: the panel fits the window and a box is set with "pcs in 1 box" and box prices', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await navTo(page, 'Products');
  await page.getByTestId('add-product').click();
  await page.getByTestId('product-sku').fill('AMA-1G');
  await page.getByTestId('product-name').fill('Ama Classic 1 g');
  await page.getByTestId('product-retail').fill('10');
  await page.getByTestId('product-wholesale').fill('9');

  await page.getByTestId('product-has-box').click();
  await page.getByTestId('product-box-pcs').fill('12');
  await expect(page.getByTestId('product-box-equals')).toHaveText('1 Box = 12 pcs');
  await expect(page.getByText('Empty: ৳120 (12 × the pcs price)')).toBeVisible();
  await page.getByTestId('product-box-retail').fill('110');

  // every box field is inside the window: nothing is cut off on the right
  const width = await page.evaluate(() => window.innerWidth);
  for (const id of ['product-box-pcs', 'product-box-retail', 'product-box-wholesale']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(width);
  }
  await page.getByTestId('product-save').click();
  await expect(page.getByTestId('product-save')).toBeHidden();

  const p = (await inv<ProductDto[]>(page, 'catalog:products', { includeArchived: false })).find((x) => x.sku === 'AMA-1G')!;
  const box = p.packs.find((k) => k.factor === 12)!;
  expect(box).toMatchObject({ name: 'Box', priceRetail: 11_000, priceWholesale: null });
  // a box added here also becomes the default unit for selling and buying
  expect(p.defaultSalePackId).toBe(box.id);
  expect(p.defaultPurchasePackId).toBe(box.id);

  // reopening shows the same simple fields; "more packs" opens the full table
  await page.getByRole('row', { name: /AMA-1G/ }).click();
  await expect(page.getByTestId('product-box-pcs')).toHaveValue('12');
  await page.getByTestId('product-more-packs').click();
  await expect(page.getByTestId('pack-table')).toBeVisible();
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});

test('start fresh: with a backup the old shop is gone, setup opens again, and the backup is listed', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en', business: 'Old Traders' });
  await inv(page, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 0 });
  await navTo(page, 'Backup');
  await page.getByTestId('fresh-open').click();
  await expect(page.getByTestId('fresh-backup-yes')).toBeChecked();
  await expect(page.getByTestId('fresh-go')).toBeDisabled();
  await page.getByTestId('fresh-confirm').fill('delete');
  await page.getByTestId('fresh-go').click();

  // back to the first-time setup, as on a new computer
  await completeSetup(page, { lang: 'en', business: 'New Traders' });
  expect(await inv<unknown[]>(page, 'customer:list', { includeArchived: true })).toEqual([]);
  await navTo(page, 'Backup');
  await expect(page.getByText('Before starting fresh')).toBeVisible();
  expect(fs.readdirSync(path.join(dataDir, 'backups')).some((f) => f.endsWith('-pre-reset.petrabak'))).toBe(true);

  // without a backup, clearing old files: nothing of either shop is left in the backups folder
  await page.getByTestId('fresh-open').click();
  await page.getByTestId('fresh-backup-no').check();
  await page.getByTestId('fresh-wipe').check();
  await expect(page.getByText('No copy of the old shop will be left on this computer.')).toBeVisible();
  await page.getByTestId('fresh-confirm').fill('DELETE');
  await page.getByTestId('fresh-go').click();
  await completeSetup(page, { lang: 'en', business: 'Third Traders' });
  expect(fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.petrabak'))).toEqual([]);

  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});

test('sale screen: "+ Add customer" saves a full customer and puts it on the sale; categories tab renames and archives', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await navTo(page, 'Sales');
  await page.getByTestId('pos-add-customer').click();
  await page.getByTestId('quick-cust-name').fill('Rahim Store');
  await page.getByTestId('quick-cust-phone').fill('01711111111');
  await page.getByTestId('quick-cust-address').fill('Bondor Bazar, Sylhet');
  await page.getByTestId('quick-cust-type').selectOption('wholesale');
  await page.getByTestId('quick-cust-save').click();
  await expect(page.getByTestId('pos-customer')).toHaveText('Rahim Store');
  const c = (await inv<{ name: string; address: string; type: string; phone: string }[]>(page, 'customer:list', { includeArchived: false }))[0]!;
  expect(c).toMatchObject({ name: 'Rahim Store', address: 'Bondor Bazar, Sylhet', type: 'wholesale', phone: '01711111111' });

  await navTo(page, 'Products');
  await page.getByRole('tab', { name: 'Categories and brands' }).click();
  await page.getByTestId('add-category').click();
  await page.getByTestId('lookup-name').fill('Milk powder');
  await page.getByTestId('lookup-save').click();
  const cat = (await inv<{ categories: { id: number; name: string; status: string }[] }>(page, 'catalog:lookups')).categories[0]!;
  await page.getByTestId(`category-rename-${cat.id}`).click();
  await page.getByTestId('lookup-name').fill('Powder milk');
  await page.getByTestId('lookup-save').click();
  await expect(page.getByTestId('lookups-tab')).toContainText('Powder milk');
  await page.getByTestId(`category-archive-${cat.id}`).click();
  await expect.poll(async () => (await inv<{ categories: { status: string }[] }>(page, 'catalog:lookups')).categories[0]!.status).toBe('archived');

  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});

test('purchase: "+ Set box" on a row saves the box on the product and the row switches to boxes', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await inv(page, 'catalog:productSave', { sku: 'AMA-MP-1KG', name: 'Ama Milk Powder 1 kg', baseUnit: 'pcs', priceRetail: 90_000, priceWholesale: 85_000, priceDealer: 85_000, minPrice: 0, packs: [], barcodes: [] });
  await navTo(page, 'Purchases');
  await page.getByTestId('new-purchase').click();
  const rows = page.getByTestId('purchase-lines').locator('tbody tr');
  if ((await rows.count()) === 0) {
    await page.getByPlaceholder('Type name, SKU or scan').fill('AMA-MP-1KG');
    await page.getByPlaceholder('Type name, SKU or scan').press('Enter');
  }
  await expect(page.getByTestId('line-box-0')).toBeDisabled();
  await page.getByTestId('line-cost-0').fill('700');
  await page.getByTestId('line-pack-0').selectOption('new-box');
  await page.getByTestId('setbox-factor').fill('12');
  await expect(page.getByText('1 Box = 12 pcs')).toBeVisible();
  await page.getByTestId('setbox-save').click();

  // the row is now in boxes, and the cost per piece became the cost per box
  await expect(page.getByTestId('line-box-0')).toBeEnabled();
  await expect(page.getByTestId('line-cost-0')).toHaveValue('8400');
  await page.getByTestId('line-box-0').fill('2');
  // a cash purchase (no company) is paid in full, as the screen fills in
  await expect(page.getByTestId('purchase-save')).toBeEnabled();
  await page.getByTestId('purchase-save').click();
  await expect(page.getByTestId('purchase-saved')).toBeVisible();
  const p = (await inv<{ sku: string; stockQty: number; packs: { factor: number; id: number }[]; defaultSalePackId: number | null }[]>(page, 'catalog:products', { includeArchived: false })).find((x) => x.sku === 'AMA-MP-1KG')!;
  expect(p.stockQty).toBe(24);
  expect(p.defaultSalePackId).toBe(p.packs.find((k) => k.factor === 12)!.id);

  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});
