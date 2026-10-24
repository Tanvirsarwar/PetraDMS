import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launch, completeSetup, inv, navTo } from './helpers';

async function seed(page: Page) {
  const cust = await inv<{ id: number }>(page, 'customer:save', { name: 'Karim Store', phone: '01711111111', type: 'wholesale', creditLimit: 0, openingBalance: 0 });
  const sup = await inv<{ id: number }>(page, 'catalog:supplierSave', { name: 'Marks Ltd' });
  const milk = await inv<{ id: number }>(page, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk 500g', nameBn: 'মার্কস দুধ', baseUnit: 'pcs', priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, minPrice: 48000, barcodes: ['8901111111111'] });
  const tea = await inv<{ id: number }>(page, 'catalog:productSave', { sku: 'TEA', name: 'Sylon Tea 400g', baseUnit: 'pcs', priceRetail: 45000, priceWholesale: 42000, priceDealer: 40000 });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  await inv(page, 'purchase:save', { supplierId: sup.id, date: today, lines: [{ productId: milk.id, qty: 100, unitCost: 40000 }, { productId: tea.id, qty: 50, unitCost: 33000 }], paid: 0 });
  await page.reload();
  return { cust, milk, tea };
}

const winState = (app: Awaited<ReturnType<typeof launch>>['app']) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    const b = w.getBounds();
    return { width: b.width, height: b.height, top: w.isAlwaysOnTop() };
  });

test('search palette: Ctrl+K finds by typo and Bangla, opens the record; shortcuts and cheat-sheet', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const { milk } = await seed(page);
  await expect(page.getByTestId('account')).toBeVisible();

  await page.keyboard.press('Control+k');
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await input.fill('sylom tea');
  await expect(page.getByTestId('palette-hit-0')).toContainText('Sylon Tea 400g');
  await input.fill('দুধ');
  await expect(page.getByTestId('palette-hit-0')).toContainText('Marks Milk 500g');
  await expect(page.getByTestId('palette-foot')).toContainText('ms');
  await input.fill('zzzzzq');
  await expect(page.getByTestId('palette-empty')).toBeVisible();
  await input.fill('karim');
  await expect(page.getByTestId('palette-hit-0')).toContainText('Karim Store');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/customers$/);
  await expect(page.getByRole('dialog', { name: 'Karim Store' })).toBeVisible();
  await page.keyboard.press('Escape');

  // a product opens its editor
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('8901111111111');
  await expect(page.getByTestId('palette-hit-0')).toContainText('Marks Milk');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/products$/);
  await expect(page.getByTestId('product-sku')).toHaveValue('MLK');
  await page.keyboard.press('Escape');

  // the query itself is fast
  const r = await inv<{ ms: number; hits: unknown[] }>(page, 'search:query', { q: 'marks', limit: 20 });
  expect(r.ms).toBeLessThan(50);
  expect(milk.id).toBeGreaterThan(0);

  // F2 goes to a new sale; ? shows the cheat-sheet, but not while typing
  await page.keyboard.press('F2');
  await expect(page).toHaveURL(/#\/sales$/);
  await page.getByTestId('pos-search').fill('?');
  await expect(page.getByTestId('cheatsheet')).toHaveCount(0);
  await page.getByTestId('pos-search').fill('');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  await expect(page.getByTestId('cheatsheet')).toBeVisible();
  await expect(page.getByTestId('cheatsheet')).toContainText('Ctrl+K');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cheatsheet')).toHaveCount(0);

  // F5 starts receiving a payment
  await page.keyboard.press('F5');
  await expect(page.getByTestId('cust-search')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('calculator: F7 works from the keyboard and puts the result into the field you were in', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);
  await navTo(page, 'Sales');
  await page.getByTestId('pos-search').fill('Marks');
  await page.getByTestId('pos-search').press('Enter');
  await page.keyboard.press('F3');
  await page.getByTestId('cust-search').fill('Karim');
  await page.getByTestId('cust-search').press('Enter');
  await expect(page.getByTestId('cust-search')).toHaveCount(0);
  await expect(page.getByTestId('pos-cust-due')).toBeVisible();
  await page.getByTestId('pos-paid').focus();
  await page.keyboard.press('F7');
  await expect(page.getByTestId('calculator')).toBeFocused();
  await page.keyboard.type('12*5');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('calc-display')).toHaveText('60');
  await page.keyboard.type('+10%'); // percent of the running amount: 60 + 10% = 66
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('calc-display')).toHaveText('66');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('calc-float')).toHaveCount(0);
  await expect(page.getByTestId('pos-paid')).toHaveValue(/^66(\.00)?$/);
  await expect(page.getByTestId('pos-paid')).toBeFocused();

  // memory and buttons by mouse, Esc closes without touching the field
  await page.keyboard.press('F7');
  await page.getByTestId('calc-5').click();
  await page.getByTestId('calc-0').click();
  await page.getByTestId('calc-M+').click();
  await page.getByTestId('calc-C').click();
  await page.getByTestId('calc-MR').click();
  await expect(page.getByTestId('calc-display')).toHaveText('50');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('calc-float')).toHaveCount(0);
  await expect(page.getByTestId('pos-paid')).toHaveValue(/^66(\.00)?$/);
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('barcode scan: adds the product in a sale, opens search elsewhere, rejects slow typing', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);
  await navTo(page, 'Sales');
  const search = page.getByTestId('pos-search');
  await search.focus();
  await page.keyboard.type('8901111111111', { delay: 4 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cart-line-0')).toContainText('Marks Milk');
  await expect(search).toHaveValue('');
  // the same product again adds one more instead of a new row
  await page.keyboard.type('8901111111111', { delay: 4 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pos-qty-0')).toHaveValue('2');
  // a quantity far beyond any real shop is refused as a typing mistake instead of breaking the screen
  await page.getByTestId('pos-qty-0').fill('99999999999999');
  await expect(page.getByTestId('screen-error')).toHaveCount(0);
  await expect(page.getByTestId('pos-qty-0')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('pos-qty-0').fill('');
  await expect(page.getByTestId('screen-error')).toHaveCount(0);
  await expect(page.getByTestId('pos-save')).toBeDisabled();
  await page.getByTestId('pos-qty-0').fill('2');
  await expect(page.getByTestId('pos-qty-0')).toHaveValue('2');
  // an unknown code is explained
  await page.keyboard.type('0000099999', { delay: 4 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('No product has the code 0000099999')).toBeVisible();

  // human typing is not a scan
  await search.fill('');
  await page.keyboard.type('Sylon', { delay: 120 });
  await expect(page.getByTestId('palette-input')).toHaveCount(0);

  // elsewhere a scan opens the search box with the code
  await navTo(page, 'Customers');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.type('8901111111111', { delay: 4 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette-input')).toHaveValue('8901111111111');
  await expect(page.getByTestId('palette-hit-0')).toContainText('Marks Milk');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('compact mode: Ctrl+Shift+M shrinks to an always-on-top panel and back; quick payment and figures work', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const { cust } = await seed(page);
  const before = await winState(app);
  expect(before.top).toBe(false);
  expect(before.width).toBeGreaterThan(900);

  await page.keyboard.press('Control+Shift+m');
  await expect(page.getByTestId('compact-panel')).toBeVisible();
  await expect.poll(() => winState(app)).toMatchObject({ width: 360, height: 520, top: true });
  await expect(page.getByTestId('compact-stats')).toContainText('Sales today');
  await expect(page.getByTestId('compact-stats')).toContainText('Cash in drawer');

  // the calculator works in the small panel
  await page.getByTestId('calc-7').click();
  await page.getByTestId('calc-*').click();
  await page.getByTestId('calc-6').click();
  await page.getByTestId('calc-=').click();
  await expect(page.getByTestId('calc-display')).toHaveText('42');

  // quick payment opens the same flow as F5
  await page.getByTestId('compact-pay').click();
  await expect(page.getByTestId('cust-search')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(cust.id).toBeGreaterThan(0);

  // quick sale leaves compact mode and opens the sale screen
  await page.getByTestId('compact-sale').click();
  await expect.poll(() => winState(app)).toMatchObject({ top: false });
  await expect(page).toHaveURL(/#\/sales$/);
  await expect.poll(async () => (await winState(app)).width).toBeGreaterThan(900);
  await expect(page.getByTestId('compact-panel')).toHaveCount(0);

  // the shortcut toggles it again and Full window restores
  await page.keyboard.press('Control+Shift+m');
  await expect(page.getByTestId('compact-panel')).toBeVisible();
  await page.getByTestId('compact-expand').click();
  await expect.poll(() => winState(app)).toMatchObject({ top: false });
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('labels: a barcode label sheet is written as a PDF from the product editor', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seed(page);
  await navTo(page, 'Products');
  await page.getByRole('row', { name: /Marks Milk/ }).click();
  await page.getByTestId('product-labels').click();
  await page.getByTestId('labels-copies').fill('9');
  await page.getByTestId('labels-pdf').click();
  const pdf = path.join(dataDir, 'invoices', 'labels.pdf');
  await expect.poll(() => fs.existsSync(pdf), { timeout: 20_000 }).toBe(true);
  expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  expect(consoleErrors).toEqual([]);
  await app.close();
});
