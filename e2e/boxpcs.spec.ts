import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { launch, completeSetup, inv, navTo } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

/** A milk sold by the box of 24 (its own box prices and box barcode), with 10 boxes in stock, and a customer. */
async function seed(page: Page) {
  const p = await inv<{ id: number }>(page, 'catalog:productSave', {
    sku: 'MLK-24', name: 'Marks Milk 25g', nameBn: 'মার্কস দুধ ২৫গ্রাম', baseUnit: 'pcs', priceRetail: 5_500, priceWholesale: 5_000, priceDealer: 4_800, minPrice: 0,
    packs: [{ name: 'Box', nameBn: 'বক্স', factor: 24, priceRetail: 130_000, priceWholesale: 118_000, barcode: '7700000000024' }], barcodes: ['7700000000001'],
    defaultSaleFactor: 24, defaultPurchaseFactor: 24, reorderLevel: 24 * 20
  });
  const sup = await inv<{ id: number }>(page, 'catalog:supplierSave', { name: 'Marks Ltd' });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  const list = await inv<{ id: number; packs: { id: number; factor: number }[] }[]>(page, 'catalog:products', { includeArchived: false });
  const box = list[0]!.packs.find((k) => k.factor === 24)!.id;
  await inv(page, 'purchase:save', { supplierId: sup.id, date: today, lines: [{ productId: p.id, packId: box, qty: 10, looseQty: 0, unitCost: 100_000 }], paid: 0 });
  await inv(page, 'customer:save', { name: 'Karim Store', phone: '01711111111', type: 'wholesale', creditLimit: 0 });
  await page.reload();
  return { productId: p.id };
}

const integrity = (dataDir: string) => {
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = formatViolations(checkIntegrity(db));
  db.close();
  return v;
};

test('box + pcs: stock in boxes, POS "2b5" with box and piece prices, box barcode, invoice, return 1 box + 3 pcs', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);

  // stock reads as boxes and pieces everywhere
  await navTo(page, 'Inventory');
  await expect(page.getByTestId('stock-MLK-24')).toHaveText('10 Box');

  // POS: the product starts in its default unit (Box); "2b5" fills 2 boxes and 5 pieces
  await navTo(page, 'Sales');
  await page.getByTestId('pos-search').fill('MLK');
  await page.getByTestId('pos-search').press('Enter');
  await expect(page.getByTestId('cart-line-0')).toContainText('Marks Milk');
  await page.getByTestId('pos-qty-0').fill('2b5');
  await expect(page.getByTestId('pos-qty-0')).toHaveValue('2');
  await expect(page.getByTestId('pos-pcs-0')).toHaveValue('5');
  await expect(page.getByTestId('pos-price-0')).toHaveValue('1300');
  await expect(page.getByTestId('pos-pcsprice-0')).toHaveValue('55');
  await expect(page.getByTestId('pos-amount-0')).toHaveText('৳2,875.00'); // 2 x 1,300 + 5 x 55
  await expect(page.getByTestId('pos-total-0')).toHaveText('= 53 pcs'); // 2 x 24 + 5

  // the box's own barcode adds a whole box to a new line
  await page.getByTestId('pos-search').focus();
  await page.keyboard.type('7700000000024', { delay: 4 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pos-qty-0')).toHaveValue('3');

  // a wholesale customer re-prices both parts
  await page.keyboard.press('F3');
  await page.getByTestId('cust-search').fill('Karim');
  await page.getByTestId('cust-search').press('Enter');
  await expect(page.getByTestId('pos-price-0')).toHaveValue('1180');
  await expect(page.getByTestId('pos-pcsprice-0')).toHaveValue('50');
  await expect(page.getByTestId('pos-total')).toHaveText('৳3,790.00'); // 3 x 1,180 + 5 x 50
  await page.getByTestId('pos-save').click();
  await expect(page.getByTestId('pos-done')).toBeVisible();
  await page.getByTestId('pos-new').click();

  await navTo(page, 'Inventory');
  await expect(page.getByTestId('stock-MLK-24')).toHaveText('6 Box 19 pcs'); // 240 - 77 = 163

  // the invoice detail and the return in box + pcs
  await navTo(page, 'Sales');
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await page.getByRole('row', { name: /INV-000001/ }).click();
  // the box line and its loose pieces show as one row with the piece count
  await expect(page.getByTestId('detail-qty-1')).toHaveText('3 Box + 5 pcs (77 pcs total)');
  await page.getByTestId('sale-return').click();
  await expect(page.getByTestId('sret-left-1')).toHaveText('3 Box + 5 pcs');
  await page.getByTestId('sret-box-1').fill('1');
  await page.getByTestId('sret-qty-1').fill('3');
  await page.getByTestId('return-save').click();
  await expect(page.getByText('Return recorded')).toBeVisible();
  await page.keyboard.press('Escape');
  await navTo(page, 'Inventory');
  await expect(page.getByTestId('stock-MLK-24')).toHaveText('7 Box 22 pcs'); // 163 + 27 = 190

  // a stock adjustment is typed in boxes + pieces too: 1 box + 2 pcs damaged = 26 pieces
  await page.getByRole('tab', { name: 'Adjustments' }).click();
  await page.getByTestId('new-adjustment').click();
  await page.locator('input[role="combobox"]').last().fill('MLK');
  await page.locator('input[role="combobox"]').last().press('Enter');
  await page.getByTestId('adjust-kind').selectOption('damage');
  await page.getByTestId('adjust-box').fill('1');
  await page.getByTestId('adjust-qty').fill('2');
  await expect(page.getByText('= 1 Box + 2 pcs (26 pcs total)')).toBeVisible();
  await page.getByTestId('adjust-reason').fill('Torn box');
  await page.getByTestId('adjust-save').click();
  await expect(page.getByRole('row', { name: /ADJ-/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Stock' }).click();
  await expect(page.getByTestId('stock-MLK-24')).toHaveText('6 Box 20 pcs'); // 190 - 26 = 164

  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});
