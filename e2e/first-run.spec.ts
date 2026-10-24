import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launch, completeSetup, signInPin } from './helpers';

test('fresh install: wizard, recovery code, sign out, sign in, wrong PIN, lockout, recovery', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  const code = await completeSetup(page, { lang: 'en' });
  expect(code).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);

  // lands inside the app as Owner
  await expect(page.getByTestId('account')).toContainText('Rahim');
  await page.locator('nav').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible();

  // the database was created in the chosen folder with the owner and defaults
  expect(fs.existsSync(path.join(dataDir, 'data', 'petra.db'))).toBe(true);

  // sign out, then wrong PIN twice, then correct PIN
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  await page.waitForSelector('[data-testid="pin-dots"]');
  await signInPin(page, '1111');
  await expect(page.getByTestId('login-error')).toContainText('Wrong PIN');
  await signInPin(page, '2222');
  await expect(page.getByTestId('login-error')).toContainText('Wrong PIN');
  await signInPin(page, '4321');
  await expect(page.getByTestId('account')).toContainText('Rahim');

  // five wrong attempts lock the account
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  for (let i = 0; i < 5; i++) await signInPin(page, '9999');
  await expect(page.getByTestId('login-error')).toContainText('Locked');
  await expect(page.getByTestId('signin')).toBeDisabled();

  // recovery code resets the Owner PIN
  await page.getByTestId('forgot').click();
  await page.getByTestId('recover-code').fill(code);
  const pw = page.getByRole('dialog').locator('input[type="password"]');
  await pw.nth(0).fill('7777');
  await pw.nth(1).fill('7777');
  await page.getByTestId('recover-submit').click();
  await page.waitForSelector('[data-testid="recovery-code"]');
  const code2 = (await page.getByTestId('recovery-code').innerText()).trim();
  expect(code2).not.toBe(code);
  await page.getByTestId('recover-done').click();
  await expect(page.getByTestId('account')).toContainText('Rahim');

  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('wizard can move the data folder before anything is stored', async () => {
  const { app, page } = await launch();
  await page.waitForSelector('[data-testid="wizard-step-1"]');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-newroot-'));
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('biz-name').fill('Moved Co');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('owner-name').fill('Owner');
  await page.getByTestId('owner-username').fill('owner');
  const pw = page.locator('[data-testid="wizard-step-3"] input[type="password"]');
  await pw.nth(0).fill('123456');
  await pw.nth(1).fill('123456');
  await page.getByTestId('wizard-next').click();
  await page.evaluate((p) => window.petra.invoke('setup:applyDataDir', { path: p }), target);
  expect(fs.existsSync(path.join(target, 'data', 'petra.db'))).toBe(true);
  await app.close();
});

test('staff cannot reach settings; roles are enforced in the main process', async () => {
  const { app, page } = await launch();
  await completeSetup(page, { lang: 'en' });
  await page.locator('nav').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Users' }).click();
  await page.getByTestId('add-user').click();
  await page.getByTestId('user-username').fill('sara');
  await page.getByTestId('user-name').fill('Sara');
  await page.getByTestId('user-role').selectOption('staff');
  const pw = page.getByRole('dialog').locator('input[type="password"]');
  await pw.nth(0).fill('2468');
  await pw.nth(1).fill('2468');
  await page.getByTestId('user-save').click();
  await expect(page.getByRole('cell', { name: /Sara/ })).toBeVisible();
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  await signInPin(page, '2468', 'Sara');
  await expect(page.getByTestId('account')).toContainText('Sara');
  // staff default to Simple mode and have no Settings entry
  await expect(page.getByTestId('mode-toggle')).toContainText('full');
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  // a direct call to an owner-only channel is refused by the main process
  const denied = await page.evaluate(() => window.petra.invoke('users:list').then(() => 'allowed', (e: Error) => e.message));
  expect(denied).toContain('PERMISSION');
  await app.close();
});
