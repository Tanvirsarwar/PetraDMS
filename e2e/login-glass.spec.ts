import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launch, completeSetup, inv, signInPin } from './helpers';

const LONG = 'Mohammad Abdullah Al-Mamun Chowdhury (Sales)';

async function seedUsers(page: Page) {
  await inv(page, 'users:create', { username: 'mgr', displayName: 'Manager', role: 'manager', kind: 'pin', secret: '1111' });
  await inv(page, 'users:create', { username: 'pw', displayName: 'Password User', role: 'manager', kind: 'password', secret: 'secret-pass-1' });
  await inv(page, 'users:create', { username: 'stf', displayName: LONG, role: 'staff', kind: 'pin', secret: '2222' });
}
async function signOut(page: Page) {
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  await expect(page.getByTestId('login-logo')).toBeVisible();
}
const box = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });

test('sign-in: the packaged PETRA logo, PetraDMS / Made by Petra with no version, offline', async () => {
  const { app, page, consoleErrors } = await launch();
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await completeSetup(page, { lang: 'en' });
  await seedUsers(page);
  await signOut(page);

  // the logo is a local file inside the packaged page, fully decoded, with its own proportions
  const logo = page.getByTestId('login-logo');
  const info = await logo.evaluate((el: HTMLImageElement) => ({ src: el.currentSrc, ok: el.complete && el.naturalWidth > 0, nw: el.naturalWidth, nh: el.naturalHeight, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, alt: el.alt }));
  expect(info.src.startsWith('file:')).toBe(true);
  expect(info.src).toMatch(/\/assets\/petra-logo-[\w-]+\.png$/);
  expect(info.ok).toBe(true);
  expect(info.alt).toBe('PETRA Software Solutions');
  expect(Math.abs(info.w / info.h - info.nw / info.nh)).toBeLessThan(0.02);
  const dist = path.resolve('apps/desktop/dist/assets');
  expect(fs.readdirSync(dist).some((f) => /^petra-logo-.*\.png$/.test(f))).toBe(true);

  // product and maker, nothing else: two lines, no version, no dot
  await expect(page.getByTestId('footer-product')).toHaveText('PetraDMS');
  await expect(page.getByTestId('made-by')).toHaveText('Made by Petra');
  await expect(page.getByTestId('product-footer')).toHaveText(/^PetraDMS\s*Made by Petra$/);
  await expect(page.locator('body')).not.toContainText(/PetraDMS\s*[·\-–—]?\s*v?\d/);
  expect(await page.title()).toMatch(/(^|· )PetraDMS$/);
  // the shop's own identity stays the shop's
  await expect(page.getByTestId('login-brand')).toContainText('Rahim Traders');
  // and nothing was fetched from outside the app
  expect(requests.filter((u) => !/^(file|data|blob|devtools|chrome-extension):/.test(u))).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('sign-in: user selection, wrong PIN, wrong password, lockout, PIN and password sign-in all use the real flow', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seedUsers(page);
  await signOut(page);

  // four people, one tile each, the long name wraps inside its tile
  await expect(page.locator('[data-testid="user-list"] .user-tile')).toHaveCount(4);
  const tile = page.getByRole('button', { name: new RegExp('Mohammad') });
  const tb = await tile.evaluate((el) => ({ over: el.scrollWidth - el.clientWidth }));
  expect(tb.over).toBeLessThanOrEqual(1);

  // wrong PIN: an alert, the keypad stays usable
  await page.getByRole('button', { name: /^Manager\b/ }).first().click();
  await signInPin(page, '9999');
  await expect(page.getByTestId('login-error')).toContainText('attempts left');
  await expect(page.getByTestId('login-error')).toHaveAttribute('role', 'alert');
  // keyboard entry still works, then the right PIN signs in
  await page.keyboard.type('1111');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('account')).toContainText('Manager');
  await signOut(page);

  // password user: wrong, then right
  await page.getByRole('button', { name: /Password User/ }).click();
  await page.getByTestId('password').fill('nope');
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await page.getByTestId('password').fill('secret-pass-1');
  await expect(page.getByTestId('password')).toHaveAttribute('type', 'password');
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('account')).toContainText('Password User');
  await signOut(page);

  // five wrong PINs lock the account: the message says until when, and the pad and button are disabled
  await page.getByRole('button', { name: new RegExp('Mohammad') }).click();
  for (let i = 0; i < 5; i++) await signInPin(page, '0000');
  await expect(page.getByTestId('login-error')).toBeVisible();
  // open the locked person again: the locked notice shows and the pad and button are off
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: new RegExp('Mohammad') }).click();
  await expect(page.getByTestId('login-error')).toContainText(/locked|until/i);
  await expect(page.getByTestId('signin')).toBeDisabled();
  await expect(page.locator('.keypad .p-btn').first()).toBeDisabled();
  expect(consoleErrors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  await app.close();
});

test('sign-in: Owner recovery works from the new screen', async () => {
  const { app, page } = await launch();
  const code = await completeSetup(page, { lang: 'en' });
  await signOut(page);
  await page.getByTestId('forgot').click();
  await page.getByTestId('recover-code').fill(code);
  const pins = page.locator('.p-modal input[type="password"]');
  await pins.nth(0).fill('7766');
  await pins.nth(1).fill('7766');
  await page.getByTestId('recover-submit').click();
  await page.waitForSelector('[data-testid="recovery-code"]');
  await page.getByTestId('recover-done').click();
  await expect(page.getByTestId('account')).toContainText('Rahim');
  await signOut(page);
  await signInPin(page, '7766');
  await expect(page.getByTestId('account')).toContainText('Rahim');
  await app.close();
});

for (const lang of ['en', 'bn'] as const) {
  test(`sign-in in ${lang}: centred, nothing clipped and no sideways scroll at 1366x768, 1024x640 and 1180x700; language switch always visible`, async () => {
    const { app, page } = await launch();
    await completeSetup(page, { lang });
    await seedUsers(page);
    await signOut(page);
    for (const [w, h] of [[1366, 768], [1024, 640], [1180, 700]] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const stage of ['list', 'pin'] as const) {
        if (stage === 'pin') await page.getByRole('button', { name: /^Manager\b/ }).first().click();
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => {
          const p = document.querySelector('.login-glass')!.getBoundingClientRect();
          const sw = document.querySelector('.login-top')!.getBoundingClientRect();
          return { panelL: p.left, panelR: p.right, panelT: p.top, panelB: p.bottom, swL: sw.left, swR: sw.right, swT: sw.top, swB: sw.bottom, vw: innerWidth, vh: innerHeight, hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        const where = `${lang} ${w}x${h} ${stage}`;
        expect(m.hscroll, where).toBeLessThanOrEqual(1);
        expect(Math.abs((m.panelL + m.panelR) / 2 - m.vw / 2), `${where} centred`).toBeLessThan(4);
        expect(m.panelT, where).toBeGreaterThanOrEqual(0);
        expect(m.panelB, `${where} bottom (footer visible without scrolling)`).toBeLessThanOrEqual(m.vh + 1);
        expect(m.swR, where).toBeLessThanOrEqual(m.vw);
        expect(m.swT, where).toBeGreaterThanOrEqual(0);
        await expect(page.getByTestId('made-by')).toBeInViewport();
        await expect(page.locator('.login-top').getByRole('button', { name: lang === 'bn' ? 'EN' : 'বাংলা' })).toBeVisible();
        if (stage === 'pin') await page.getByRole('button', { name: lang === 'bn' ? 'পিছনে' : 'Back', exact: true }).click();
      }
    }
    // the language switch really switches, and the screen keeps its shape
    await page.locator('.login-top').getByRole('button', { name: lang === 'bn' ? 'EN' : 'বাংলা' }).click();
    await expect(page.getByTestId('made-by')).toHaveText(lang === 'bn' ? 'Made by Petra' : 'প্রস্তুতকারক: Petra');
    await app.close();
  });
}

test('sign-in: keyboard focus is clearly visible, and reduced motion keeps the screen usable', async () => {
  const { app, page } = await launch();
  await completeSetup(page, { lang: 'en' });
  await seedUsers(page);
  await signOut(page);
  const ring = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).boxShadow);
  // Tab into the first user tile: a 4 px cyan ring
  let focused = '';
  for (let i = 0; i < 8 && !focused.includes('user-tile'); i++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? '');
  }
  expect(focused).toContain('user-tile');
  expect(await ring('.user-tile:focus-visible')).toContain('rgb(103, 232, 249)');
  // a keypad button and the primary button too
  await page.getByRole('button', { name: /^Manager\b/ }).first().click();
  await page.locator('.keypad .p-btn').first().focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  expect(await ring('.keypad .p-btn:focus-visible')).toContain('rgb(103, 232, 249)');
  // reduced motion: the picture stays, the movement stops, the panel is untouched
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByTestId('login-logo')).toBeVisible();
  expect(await page.locator('.s3-ribbon').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  const b = await box(page, '.login-glass');
  expect(b.bottom - b.top).toBeGreaterThan(300);
  await app.close();
});
