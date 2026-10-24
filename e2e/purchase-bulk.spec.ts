import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { launch, completeSetup, inv, navTo } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

interface Seeded { supplierId: number; ids: number[]; today: string }

/** Twelve Marks products sold in boxes of 24 (the last three in boxes of 12), one with expiry tracking, and the company. */
async function seed(page: Page): Promise<Seeded> {
  const brand = await inv<{ id: number }>(page, 'catalog:lookupSave', { kind: 'brand', name: 'Marks' });
  const ids: number[] = [];
  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, '0');
    const r = await inv<{ id: number }>(page, 'catalog:productSave', {
      sku: `MRK-${n}`, name: `Marks Item ${n}`, brandId: brand.id, baseUnit: 'pcs', trackExpiry: i === 12,
      priceRetail: 6000, priceWholesale: 5500, priceDealer: 5200, packs: [{ name: 'Box', factor: i > 9 ? 12 : 24 }]
    });
    ids.push(r.id);
  }
  const sup = await inv<{ id: number }>(page, 'catalog:supplierSave', { name: 'Marks Ltd' });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  await page.reload();
  return { supplierId: sup.id, ids, today };
}

const integrity = (dataDir: string): string => {
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = formatViolations(checkIntegrity(db));
  db.close();
  return v;
};

test('company purchase: link 12 products, bulk-enter box + pcs with free goods, prices, GRN PDF, return 1 box + 3 pcs, void, integrity', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);

  // Suppliers > Products: tick all twelve and link them
  await navTo(page, 'Suppliers');
  await page.getByRole('row', { name: /Marks Ltd/ }).click();
  await page.getByRole('tab', { name: 'Products' }).click();
  await page.getByTestId('link-products').click();
  await page.getByTestId('add-many-search').fill('MRK');
  await page.getByTestId('add-many-all').click();
  await page.getByTestId('add-many-go').click();
  await expect(page.getByTestId('linked-count')).toContainText('12 products linked');
  await page.keyboard.press('Escape');

  // New purchase: the company's twelve products are already in the grid
  await navTo(page, 'Purchases');
  await page.getByTestId('new-purchase').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: 'Marks Ltd' });
  await expect(page.getByTestId('purchase-lines').locator('tbody tr')).toHaveCount(12);
  await page.getByTestId('purchase-ref').fill('MK-1001');

  // row 0: 5 Box + 6 Pcs at 1,200 a box (6,000 + 6 x 50)
  await page.getByTestId('line-box-0').fill('5');
  await page.getByTestId('line-pcs-0').fill('6');
  await page.getByTestId('line-cost-0').fill('1200');
  await expect(page.getByTestId('line-amount-0')).toHaveText('৳6,300.00');
  await expect(page.getByTestId('line-after-0')).toHaveText('5 Box 6 pcs');
  // row 1: 2 Box at 600 with 1 free box and a 10% discount
  await page.getByTestId('line-box-1').fill('2');
  await page.getByTestId('line-cost-1').fill('600');
  await page.getByTestId('line-disc-1').fill('10');
  await page.getByTestId('line-freebox-1').fill('1');
  await expect(page.getByTestId('line-amount-1')).toHaveText('৳1,080.00');
  await expect(page.getByTestId('line-after-1')).toHaveText('3 Box');
  // row 2: 7 loose pieces at 1,200 a box -> 350
  await page.getByTestId('line-pcs-2').fill('7');
  await page.getByTestId('line-cost-2').fill('1200');
  // the expiry product needs a batch and a date
  await page.getByTestId('line-box-11').fill('1');
  await page.getByTestId('line-cost-11').fill('480');
  await expect(page.getByTestId('purchase-save')).toBeDisabled();
  await expect(page.getByTestId('purchase-problems')).toBeVisible();
  await page.getByTestId('line-batch-11').fill('B-12');
  await page.getByTestId('line-expiry-11').fill('31-12-2030');
  await page.getByTestId('purchase-freight').fill('100');
  // 6,300 + 1,080 + 350 + 480 + 100 freight
  await expect(page.getByTestId('purchase-total')).toHaveText('৳8,310.00');
  await expect(page.getByTestId('purchase-counts')).toContainText('Lines: 4');
  await expect(page.getByTestId('purchase-counts')).toContainText('Boxes: 9');
  await expect(page.getByTestId('purchase-counts')).toContainText('Pieces: 13');
  await page.getByTestId('purchase-paid').fill('0');
  await expect(page.getByTestId('purchase-due')).toHaveText('৳8,310.00');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('purchase-saved')).toBeVisible();

  const list = await inv<{ id: number; sku: string; stockQty: number; stockValue: number }[]>(page, 'catalog:products', { includeArchived: false });
  const by = (sku: string) => list.find((p) => p.sku === sku)!;
  expect(by('MRK-01').stockQty).toBe(126);
  expect(by('MRK-02').stockQty).toBe(72); // 2 bought + 1 free box
  expect(by('MRK-03').stockQty).toBe(7);
  // the whole bill, freight included, is now stock value
  expect(list.reduce((a, p) => a + (p.stockValue ?? 0), 0)).toBe(831_000);

  // the same company invoice number again is caught before saving
  await page.getByTestId('new-purchase').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: 'Marks Ltd' });
  await page.getByTestId('purchase-ref').fill('mk-1001');
  await expect(page.getByTestId('purchase-dup')).toContainText('PUR-');
  await page.getByTestId('purchase-discard').click();

  // the GRN shows box + pcs and free goods, and saves as a PDF
  await page.getByRole('row', { name: /PUR-/ }).first().click();
  await expect(page.getByTestId('detail-qty-1')).toHaveText('5 Box + 6 pcs');
  await expect(page.getByTestId('purchase-detail-lines')).toContainText('Free');
  await page.getByTestId('print-pdf').click();
  await expect.poll(() => fs.existsSync(path.join(dataDir, 'invoices', 'GRN-PUR-000001.pdf'))).toBe(true);

  // return 1 box + 3 pcs of the first product to the company
  await page.getByTestId('purchase-return').click();
  await expect(page.getByTestId('return-left-MRK-01')).toHaveText('5 Box + 6 pcs');
  await page.getByTestId('return-box-MRK-01').fill('1');
  await page.getByTestId('return-pcs-MRK-01').fill('3');
  await expect(page.getByTestId('return-credit-total')).toContainText('1,350');
  await page.getByTestId('return-save').click();
  await expect.poll(async () => (await inv<{ sku: string; stockQty: number }[]>(page, 'catalog:products', { includeArchived: false })).find((p) => p.sku === 'MRK-01')!.stockQty).toBe(99);
  expect(integrity(dataDir)).toBe('');

  // a purchase with a live return cannot be cancelled; undo the return, then cancel the purchase
  await page.getByTestId('purchase-void').click();
  await page.getByTestId('void-reason').fill('Wrong company');
  await page.getByTestId('void-confirm').click();
  await expect(page.getByRole('alert').filter({ hasText: 'returns' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.getByTestId('purchase-void').click();
  await page.getByTestId('void-reason').fill('Wrong company');
  await page.getByTestId('void-confirm').click();
  await expect(page.getByText('Cancelled').first()).toBeVisible();
  const after = await inv<{ sku: string; stockQty: number; stockValue: number }[]>(page, 'catalog:products', { includeArchived: false });
  expect(after.every((p) => p.stockQty === 0 && p.stockValue === 0)).toBe(true);

  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});

test('company purchase: prices after saving, and the draft comes back after a reload', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const s = await seed(page);
  await inv(page, 'supplier:link', { supplierId: s.supplierId, productIds: s.ids.slice(0, 3) });

  await navTo(page, 'Purchases');
  await page.getByTestId('new-purchase').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: 'Marks Ltd' });
  await page.getByTestId('line-box-0').fill('3');
  await page.getByTestId('line-cost-0').fill('1000');
  await page.waitForTimeout(900);
  await page.reload();
  await page.getByTestId('new-purchase').click();
  await expect(page.getByText('Your unsaved purchase was restored.')).toBeVisible();
  await expect(page.getByTestId('line-box-0')).toHaveValue('3');
  await expect(page.getByTestId('line-cost-0')).toHaveValue('1000');
  await page.getByTestId('purchase-save').click();
  await expect(page.getByTestId('purchase-saved')).toBeVisible();

  await page.getByTestId('prices-open').click();
  await expect(page.getByTestId('prices-table')).toContainText('MRK-01');
  await page.getByTestId('prices-retail-MRK-01').fill('1500');
  await expect(page.getByTestId('prices-on-MRK-01')).toBeChecked();
  await page.getByTestId('prices-apply').click();
  await expect(page.getByTestId('prices-table')).toHaveCount(0);
  const p = (await inv<{ sku: string; priceRetail: number; packs: { factor: number; priceRetail: number | null }[] }[]>(page, 'catalog:products', { includeArchived: false })).find((x) => x.sku === 'MRK-01')!;
  expect(p.packs.find((k) => k.factor === 24)?.priceRetail).toBe(150_000);
  expect(p.priceRetail).toBe(6_250); // 1,500 / 24 pieces
  // the draft is gone once the purchase is saved
  expect((await inv<{ payload: string | null }>(page, 'purchase:draftGet')).payload).toBeNull();
  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});
