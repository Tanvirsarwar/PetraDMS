import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { launch, completeSetup, inv, navTo } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

/** `n` products in boxes of 24 linked to one company, each with a remembered cost per box. */
async function company(page: Page, n: number): Promise<{ supplierId: number }> {
  const sup = await inv<{ id: number }>(page, 'catalog:supplierSave', { name: 'Akij Food' });
  const ids: number[] = [];
  for (let i = 1; i <= n; i++) {
    const r = await inv<{ id: number }>(page, 'catalog:productSave', { sku: `AK-${String(i).padStart(3, '0')}`, name: `Akij Item ${String(i).padStart(3, '0')}`, baseUnit: 'pcs', priceRetail: 5_000, priceWholesale: 4_800, priceDealer: 4_600, packs: [{ name: 'Box', factor: 24 }] });
    ids.push(r.id);
  }
  await inv(page, 'supplier:link', { supplierId: sup.id, productIds: ids });
  const list = await inv<{ id: number; packs: { id: number; factor: number }[] }[]>(page, 'catalog:products', { includeArchived: false });
  for (const p of list) await inv(page, 'supplier:linkEdit', { supplierId: sup.id, productId: p.id, defaultPackId: p.packs.find((k) => k.factor === 24)!.id, lastCost: 96_000 });
  await page.reload();
  return { supplierId: sup.id };
}

/**
 * Keys are pressed at a person's pace (the app treats a burst of keys under 40 ms apart as a barcode scanner and
 * holds those characters back until it knows), so every key here has a short pause after it.
 */
const key = async (page: Page, k: string) => {
  if (k.length === 1 || /^[\w.]+$/.test(k) && !/^(Enter|Tab|Arrow\w+|Escape)$/.test(k)) await page.keyboard.type(k, { delay: 70 });
  else await page.keyboard.press(k);
  await page.waitForTimeout(70);
};

test('keyboard only: a 30-line company invoice with Enter and the arrow keys, saved with Ctrl+S', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await company(page, 30);
  await navTo(page, 'Purchases');
  await page.getByTestId('new-purchase').focus();
  await page.keyboard.press('Enter');
  // choose the company from the keyboard: focus the list and type its first letters
  await page.getByTestId('purchase-supplier').focus();
  await key(page, 'Akij');
  await key(page, 'Tab'); // leaving the list commits the choice on every platform
  await expect(page.getByTestId('purchase-lines').locator('tbody tr')).toHaveCount(30);

  // row 0 by Enter: Box -> Pcs -> Cost -> Discount -> Free box -> Free pcs, then on to the next row's Box
  await page.getByTestId('line-box-0').focus();
  await key(page, '5');
  await key(page, 'Enter');
  await expect(page.getByTestId('line-pcs-0')).toBeFocused();
  await key(page, '6');
  await key(page, 'Enter');
  await expect(page.getByTestId('line-cost-0')).toBeFocused();
  await expect(page.getByTestId('line-cost-0')).toHaveValue('960'); // the company's last cost per box is already there
  await key(page, 'Enter');
  await expect(page.getByTestId('line-disc-0')).toBeFocused();
  await key(page, '2.5');
  await key(page, 'Enter');
  await expect(page.getByTestId('line-freebox-0')).toBeFocused();
  await key(page, 'Enter');
  await expect(page.getByTestId('line-freepcs-0')).toBeFocused();
  await key(page, '3');
  await key(page, 'Enter');
  await expect(page.getByTestId('line-box-1')).toBeFocused();

  // rows 1..29 by the arrow key: a box quantity per row
  for (let i = 1; i < 30; i++) {
    await key(page, String((i % 4) + 1));
    if (i < 29) await key(page, 'ArrowDown');
  }
  await expect(page.getByTestId('line-box-29')).toBeFocused();
  // ArrowUp goes back up the same column
  await key(page, 'ArrowUp');
  await expect(page.getByTestId('line-box-28')).toBeFocused();
  await expect(page.getByTestId('purchase-counts')).toContainText('Lines: 30');

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('purchase-saved')).toBeVisible();
  const list = await inv<{ id: number; itemCount: number }[]>(page, 'purchase:list', {});
  // 30 paid lines plus the free pieces of row 0
  expect(list[0]!.itemCount).toBe(31);
  const d = await inv<{ items: { qty: number; looseQty: number; kind: string; discKind: string | null; discValue: number }[] }>(page, 'purchase:get', { id: list[0]!.id });
  expect(d.items[0]).toMatchObject({ qty: 5, looseQty: 6, kind: 'normal', discKind: 'pct', discValue: 250 });
  expect(d.items.find((x) => x.kind === 'free')).toMatchObject({ qty: 3, looseQty: 0 }); // pieces alone are stored on the piece unit
  expect(consoleErrors).toEqual([]);
  await app.close();
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  expect(formatViolations(checkIntegrity(db))).toBe('');
  db.close();
});

test('bulk grid: a company with 500 linked products opens quickly and typing stays smooth at 1366x768', async () => {
  test.setTimeout(240_000);
  const { app, page, consoleErrors } = await launch();
  await page.setViewportSize({ width: 1366, height: 768 });
  await completeSetup(page, { lang: 'en' });
  // 500 products through one IPC round each would be slow to seed; the CSV import makes them in one go
  const csv = ['SKU,Name,Retail,Pcs per box,Company', ...Array.from({ length: 500 }, (_, i) => `BG-${String(i).padStart(3, '0')},Bulk Item ${String(i).padStart(3, '0')},50,24,Bulk Co`)].join('\r\n');
  const m = (await inv<{ mapping: Record<string, number | null> }>(page, 'import:preview', { kind: 'products', text: csv })).mapping;
  const r = await inv<{ created: number }>(page, 'import:run', { kind: 'products', text: csv, mapping: m, dryRun: false, skipBad: false });
  expect(r.created).toBe(500);
  await page.reload();
  await navTo(page, 'Purchases');
  await page.getByTestId('new-purchase').click();

  const t0 = Date.now();
  await page.getByTestId('purchase-supplier').selectOption({ label: 'Bulk Co' });
  await expect(page.getByTestId('purchase-lines').locator('tbody tr')).toHaveCount(500);
  const openMs = Date.now() - t0;

  // typing into a row re-draws only that row: time from keystroke to the line amount and the bill total updating
  const times: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.getByTestId(`line-cost-${i}`).fill('1200');
    const k = Date.now();
    await page.getByTestId(`line-box-${i}`).fill('2');
    await expect(page.getByTestId(`line-amount-${i}`)).toHaveText('৳2,400.00');
    times.push(Date.now() - k);
  }
  await expect(page.getByTestId('purchase-total')).toHaveText('৳28,800.00');
  const worst = Math.max(...times);
  console.log(`500-row grid: opened in ${openMs} ms, keystroke to update worst ${worst} ms`);
  expect(openMs).toBeLessThan(5_000);
  expect(worst).toBeLessThan(500);
  // the page itself never scrolls sideways; the grid scrolls inside its own box
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  // "only rows with a quantity" narrows the grid to what is on the invoice
  await page.getByTestId('grid-only-qty').check();
  await expect(page.getByTestId('purchase-lines').locator('tbody tr')).toHaveCount(12);
  expect(consoleErrors).toEqual([]);
  await app.close();
});
