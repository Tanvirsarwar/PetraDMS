import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, completeSetup, inv, navTo, signInPin } from './helpers';
import { checkIntegrity, formatViolations } from '../packages/db/src/integrity';

const names = (page: Parameters<typeof inv>[0]) => inv<{ name: string }[]>(page, 'customer:list', { includeArchived: true }).then((l) => l.map((c) => c.name).sort());
const dbIntegrity = (dataDir: string) => {
  const db = new DatabaseSync(path.join(dataDir, 'data', 'petra.db'), { readOnly: true });
  const v = formatViolations(checkIntegrity(db as never));
  const quick = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  db.close();
  return { v, quick };
};

test('backup page: back up, second folder, restore by typing RESTORE, sign in again, data as it was, integrity', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await inv(page, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 100000 });
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-second-'));
  await inv(page, 'settings:save', { secondBackupDir: second });
  await page.reload();
  await navTo(page, 'Backup');
  await expect(page.getByTestId('backup-last')).toContainText('No backup has been made yet');
  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await expect(page.getByTestId('backup-last')).toContainText('Last backup');
  await expect(page.getByTestId('backup-second')).toContainText(second);
  await expect(page.getByText('Available')).toBeVisible();
  const file = fs.readdirSync(path.join(dataDir, 'backups')).find((f) => f.endsWith('.petrabak'))!;
  expect(fs.existsSync(path.join(second, file))).toBe(true);
  expect(fs.readFileSync(path.join(second, file)).subarray(0, 2).toString()).toBe('PK');

  await inv(page, 'customer:save', { name: 'Added Later', type: 'retail', creditLimit: 0, openingBalance: 0 });
  expect(await names(page)).toEqual(['Added Later', 'Karim Store']);

  await page.getByTestId('backup-restore').click();
  await expect(page.getByTestId('restore-summary')).toContainText('1 customers');
  await expect(page.getByTestId('restore-go')).toBeDisabled();
  await page.getByTestId('restore-confirm').fill('restore');
  await page.getByTestId('restore-go').click();
  // the session ends: back at sign-in (one user, so the keypad is shown straight away)
  await signInPin(page, '4321');
  await expect(page.getByTestId('account')).toContainText('Rahim');
  expect(await names(page)).toEqual(['Karim Store']);
  // the safety copy exists and the audit log recorded the restore
  await navTo(page, 'Backup');
  await expect(page.getByText('Before restore')).toBeVisible();
  await page.getByRole('tab', { name: 'Activity log' }).click();
  await page.getByTestId('audit-action').selectOption('backup.restore');
  await expect(page.getByTestId('audit-row')).toHaveCount(1);
  await page.getByTestId('audit-row').click();
  await expect(page.getByRole('dialog')).toContainText('backup.restore');
  await page.keyboard.press('Escape');
  expect(consoleErrors).toEqual([]);
  await app.close();
  const r = dbIntegrity(dataDir);
  expect(r).toEqual({ v: '', quick: 'ok' });
});

test('backup page: activity log filters, support file contains no business data, health is shown', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await inv(page, 'customer:save', { name: 'Confidential Trader', phone: '01788888888', type: 'retail', creditLimit: 0, openingBalance: 0 });
  await inv(page, 'settings:save', { taxBp: 500 });
  await navTo(page, 'Backup');
  await page.getByRole('tab', { name: 'Activity log' }).click();
  // the log loads after the tab opens, so wait for it instead of reading the count the instant the tab is clicked
  await expect.poll(() => page.getByTestId('audit-row').count(), { message: 'audit log rows' }).toBeGreaterThan(1);
  await page.getByTestId('audit-action').selectOption('settings.save');
  await expect(page.getByTestId('audit-row')).toHaveCount(1);
  await page.getByTestId('audit-action').selectOption('');
  await page.getByTestId('audit-search').fill('taxBp');
  await expect(page.getByTestId('audit-row')).toHaveCount(1);
  await page.getByTestId('audit-search').fill('no-such-text-anywhere');
  await expect(page.getByTestId('audit-row')).toHaveCount(0);
  await expect(page.getByTestId('audit-total')).toContainText('0 to 0 of 0');

  await page.getByRole('tab', { name: 'Support' }).click();
  await expect(page.getByTestId('health-integrity')).toHaveText('Healthy');
  await page.getByTestId('diag-export').click();
  await expect.poll(() => fs.readdirSync(path.join(dataDir, 'exports')).filter((f) => f.startsWith('diagnostics-')).length).toBe(1);
  const zip = fs.readFileSync(path.join(dataDir, 'exports', fs.readdirSync(path.join(dataDir, 'exports'))[0]!));
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  expect(zip.toString('latin1')).not.toContain('Confidential Trader');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('backup: only the Owner sees it; closing the program makes a backup; a damaged file is restored automatically on the next start', async () => {
  const first = await launch();
  const { dataDir } = first;
  await completeSetup(first.page, { lang: 'en' });
  await inv(first.page, 'users:create', { username: 'mgr', displayName: 'Mahin', role: 'manager', kind: 'pin', secret: '1111' });
  await inv(first.page, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 0 });
  await first.app.close(); // a changed database is backed up when the program closes
  const closeBackups = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('-close.petrabak'));
  expect(closeBackups).toHaveLength(1);

  // second run: add more, then the next close backs up again; the manager sees no Backup entry
  const second = await launch({ dataDir });
  await signInPin(second.page, '4321', 'Rahim');
  await inv(second.page, 'customer:save', { name: 'Newer Entry', type: 'retail', creditLimit: 0, openingBalance: 0 });
  await second.page.getByTestId('account').click();
  await second.page.getByTestId('signout').click();
  await signInPin(second.page, '1111', 'Mahin');
  await expect(second.page.locator('nav').getByRole('link', { name: 'Backup' })).toHaveCount(0);
  expect((await second.page.evaluate(() => (window as unknown as { petra: { invoke: (c: string) => Promise<{ ok?: boolean }> } }).petra.invoke('backup:list').then(() => 'allowed', (e: Error) => String(e.message)))).includes('PERMISSION')).toBe(true);
  await second.app.close();
  expect(fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('-close.petrabak')).length).toBeGreaterThanOrEqual(1);

  // damage the database file the way a failing disk or a bad shutdown could
  const dbFile = path.join(dataDir, 'data', 'petra.db');
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
  const bytes = fs.readFileSync(dbFile);
  for (let i = 4096; i < bytes.length - 4096; i += 4096) bytes.fill(0xab, i + 100, i + 300);
  fs.writeFileSync(dbFile, bytes);

  const third = await launch({ dataDir });
  await signInPin(third.page, '4321', 'Rahim'); // the app opened normally: it recovered before anything read the file
  await expect(third.page.getByTestId('recovery-banner')).toBeVisible();
  await expect(third.page.getByTestId('recovery-banner')).toContainText('restored automatically');
  expect(fs.readdirSync(path.join(dataDir, 'data')).some((f) => f.startsWith('petra.db.corrupt-'))).toBe(true);
  const kept = await names(third.page);
  expect(kept).toContain('Karim Store');
  await third.page.getByTestId('recovery-dismiss').click();
  await expect(third.page.getByTestId('recovery-banner')).toHaveCount(0);
  await third.app.close();
  expect(dbIntegrity(dataDir)).toEqual({ v: '', quick: 'ok' });
});

test('upgrade: the released v1 database opens in the app, signs in, and shows its data', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-old-'));
  fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
  fs.copyFileSync(path.resolve('packages/db/fixtures/petra-v1.db'), path.join(dataDir, 'data', 'petra.db'));
  const { app, page, consoleErrors } = await launch({ dataDir });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await signInPin(page, '4321', 'Rahim');
  await expect(page.getByTestId('account')).toContainText('Rahim');
  expect(await names(page)).toEqual(['Karim Store', 'Rahim Mart']);
  await navTo(page, 'Products');
  await expect(page.getByRole('row', { name: /Marks Milk/ })).toBeVisible();
  await navTo(page, 'Backup');
  // opening it ran the v1.1 migration, which first made an automatic "Before upgrade" copy of the v1 shop
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await expect(page.getByRole('row', { name: /Before upgrade/ })).toBeVisible();
  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('backup-row')).toHaveCount(2);
  expect(consoleErrors).toEqual([]);
  await app.close();
  expect(dbIntegrity(dataDir)).toEqual({ v: '', quick: 'ok' });
});
