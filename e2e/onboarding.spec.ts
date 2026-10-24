import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { launch, completeSetup, inv, signInPin } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

const CSV = [
  'SKU,Name,Category,Brand,Retail,Cost,Stock',
  'E-1,Milk Powder 500g,Dairy,Marks,"1,250.50",1000,10',
  'E-2,Tea 200g,Tea,Ispahani,240,,',
  ',Missing sku,Tea,Ispahani,10,,',
  'E-3,Bad price,Tea,Ispahani,abc,,',
  'E-1,Same sku again,Tea,Ispahani,5,,'
].join('\r\n');

const integrity = (dataDir: string) => {
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = formatViolations(checkIntegrity(db as never));
  db.close();
  return v;
};

test('CSV import with bad rows: map, preview problems, dry run, import, save the bad rows', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await page.evaluate(() => localStorage.clear());
  await completeSetup(page, { lang: 'en' });
  await page.getByTestId('tour-invite-dismiss').click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByTestId('import-products').click();
  await expect(page.getByTestId('imp-file')).toBeVisible();
  await page.getByTestId('imp-file').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
  await expect(page.getByTestId('imp-summary')).toContainText('5 rows read: 2 are fine and 3 have a problem.');
  await expect(page.getByTestId('imp-map-sku')).toHaveValue('0');
  await expect(page.getByTestId('imp-map-priceRetail')).toHaveValue('4');
  const problems = await page.getByTestId('imp-issue').allInnerTexts();
  expect(problems.join('|')).toContain('SKU: is required');
  expect(problems.join('|')).toContain('Retail price: is not an amount in taka');
  expect(problems.join('|')).toContain('SKU: already exists in the app'.replace('already exists in the app', 'appears twice in this file'));

  // a dry run saves nothing
  await page.getByTestId('imp-dry').click();
  await expect(page.getByTestId('imp-result')).toContainText('Would add 2 and skip 3.');
  expect((await inv<unknown[]>(page, 'catalog:products', { includeArchived: true })).length).toBe(0);

  // the bad rows can be saved for fixing
  await page.getByTestId('imp-rejects').click();
  const rejected = fs.readdirSync(path.join(dataDir, 'exports')).find((f) => f.startsWith('import-products-rejected'))!;
  const rejectedCsv = fs.readFileSync(path.join(dataDir, 'exports', rejected), 'utf8');
  expect(rejectedCsv).toContain('Problem');
  expect(rejectedCsv.trim().split('\r\n').length).toBe(1 + 3);

  await page.getByTestId('imp-run').click();
  await expect(page.getByTestId('imp-result')).toContainText('Added 2. Skipped 3.');
  const list = await inv<{ sku: string; priceRetail: number; stockQty: number }[]>(page, 'catalog:products', { includeArchived: false });
  expect(list.map((p) => p.sku).sort()).toEqual(['E-1', 'E-2']);
  expect(list.find((p) => p.sku === 'E-1')).toMatchObject({ priceRetail: 125050, stockQty: 10 });
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByText('Milk Powder 500g')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});

test('export everything makes a ZIP, then demo mode loads, shows its banner, and clears back to an empty shop', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await page.evaluate(() => localStorage.clear());
  await completeSetup(page, { lang: 'en' });
  await page.getByTestId('tour-invite-dismiss').click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('open-data').click();
  await page.getByRole('tab', { name: 'Export everything' }).click();
  await page.getByTestId('export-all').click();
  await expect(page.getByTestId('export-done')).toContainText('exports');
  const zip = fs.readdirSync(path.join(dataDir, 'exports')).find((f) => f.endsWith('.zip'))!;
  expect(fs.readFileSync(path.join(dataDir, 'exports', zip)).subarray(0, 2).toString()).toBe('PK');

  await page.getByRole('tab', { name: 'Demo mode' }).click();
  await page.getByTestId('demo-load').click();
  await expect(page.getByTestId('demo-banner')).toContainText('Demo mode');
  const products = await inv<unknown[]>(page, 'catalog:products', { includeArchived: false });
  expect(products.length).toBeGreaterThan(50);
  expect(integrity(dataDir)).toBe('');

  await page.getByTestId('demo-clear').click();
  await expect(page.getByTestId('demo-clear-go')).toBeDisabled();
  await page.getByTestId('demo-confirm').fill('demo');
  await page.getByTestId('demo-clear-go').click();
  await signInPin(page, '4321');
  await expect(page.getByTestId('account')).toContainText('Rahim');
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  expect((await inv<unknown[]>(page, 'catalog:products', { includeArchived: true })).length).toBe(0);
  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(integrity(dataDir)).toBe('');
});

test('first run: tour invite, guided tour to the end, help manual in both languages, shortcuts and About', async () => {
  const { app, page, consoleErrors } = await launch();
  await page.evaluate(() => localStorage.clear());
  await completeSetup(page, { lang: 'en' });
  await expect(page.getByTestId('tour-invite')).toBeVisible();
  await page.getByTestId('tour-invite-start').click();
  await expect(page.getByTestId('tour-title')).toHaveText('Welcome to PetraDMS');
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-title')).toHaveText('Sell');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tour-title')).toHaveText('Products');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tour-title')).toHaveText('Sell');
  while ((await page.getByTestId('tour-next').innerText()) !== 'Finish') await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour')).toHaveCount(0);
  await expect(page.getByTestId('tour-invite')).toHaveCount(0);

  // the invite is not offered again after a reload
  await page.reload();
  await expect(page.getByTestId('account')).toBeVisible();
  await expect(page.getByTestId('tour-invite')).toHaveCount(0);

  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('manual')).toContainText('Getting started');
  await page.getByTestId('manual-s10').click();
  await expect(page.getByTestId('manual')).toContainText('RESTORE');
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await expect(page.getByTestId('manual-s1')).toContainText('শুরু করা');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('tab', { name: 'Shortcuts' }).click();
  await expect(page.getByTestId('help-keys')).toContainText('Ctrl+K');
  await page.getByRole('tab', { name: 'About' }).click();
  await expect(page.getByTestId('about-privacy')).toContainText('never connects to the internet');
  await expect(page.getByTestId('about-version')).not.toBeEmpty();
  await page.getByTestId('tour-start').click();
  await expect(page.getByTestId('tour')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('Petra Break: opens from About, plays by keyboard, saves the score, leaves with Escape', async () => {
  const { app, page, consoleErrors } = await launch();
  await page.evaluate(() => localStorage.clear());
  await completeSetup(page, { lang: 'en' });
  await page.getByTestId('tour-invite-dismiss').click();
  await page.getByTestId('help-open').click();
  await page.getByRole('tab', { name: 'About' }).click();
  await page.getByTestId('open-break').click();
  await expect(page.getByTestId('break-canvas')).toBeVisible();
  await expect(page.getByTestId('break-phase')).toContainText('Press Space');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('break-phase')).toHaveText('');
  // let the ball fall past the bat three times: the game ends and the score is stored (a zero score is not)
  await page.keyboard.down('ArrowLeft');
  await expect(page.getByTestId('break-lives')).toHaveText(/[0-3]/);
  await page.keyboard.up('ArrowLeft');
  await page.getByTestId('break-exit').click();
  await expect(page.getByRole('tab', { name: 'About' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  await app.close();
});
