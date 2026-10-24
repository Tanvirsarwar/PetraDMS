import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { launch, completeSetup, inv, navTo } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

const CSV = ['SKU,Name,Retail', 'BULK-1,Bulk One,10', 'BULK-2,Bulk Two,20', 'BULK-3,Bulk Three,30'].join('\r\n');

test('products: import 3, tick two, delete them permanently, one is left, integrity holds', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });

  const preview = await inv<{ mapping: Record<string, number | null> }>(page, 'import:preview', { kind: 'products', text: CSV });
  await inv(page, 'import:run', { kind: 'products', text: CSV, mapping: preview.mapping, dryRun: false, skipBad: false });
  await page.reload();
  await navTo(page, 'Products');
  await expect(page.getByTestId('select-row')).toHaveCount(3);

  // nothing selected: no bar. Ticking a checkbox must not open the editor.
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select Bulk One' }).check();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select Bulk Two' }).check();
  await expect(page.getByTestId('bulk-count')).toContainText('2 selected');

  await page.getByTestId('bulk-delete').click();
  await expect(page.getByTestId('bulk-can-delete')).toContainText('2 can be deleted');
  await expect(page.getByTestId('bulk-delete-go')).toBeDisabled();
  await page.getByTestId('bulk-delete-confirm').fill('DELETE');
  await page.getByTestId('bulk-delete-go').click();

  await expect(page.getByTestId('select-row')).toHaveCount(1);
  await expect(page.getByRole('row', { name: /BULK-3/ })).toBeVisible();
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0); // selection cleared
  await expect(page.getByText('2 deleted.')).toBeVisible();

  expect(consoleErrors).toEqual([]);
  await app.close();
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = formatViolations(checkIntegrity(db as never));
  const left = db.prepare('SELECT sku FROM products').all() as { sku: string }[];
  db.close();
  expect(v).toBe('');
  expect(left.map((r) => r.sku)).toEqual(['BULK-3']);
});
