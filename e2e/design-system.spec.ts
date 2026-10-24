import { test, expect } from '@playwright/test';
import { launch, completeSetup } from './helpers';

test('runtime: node:sqlite runs in WAL mode with integrity ok', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page);
  await page.keyboard.press('Control+Shift+G');
  await page.waitForSelector('[data-testid="journal-mode"]');
  await expect(page.getByTestId('journal-mode')).toHaveText('wal');
  await expect(page.getByTestId('integrity')).toHaveText('ok');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

for (const lang of ['bn', 'en'] as const) {
  test(`style guide renders every component in ${lang} at 1366x768 with no console errors`, async () => {
    const { app, page, consoleErrors } = await launch();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1366, 768));
    await completeSetup(page, { lang });
    await page.keyboard.press('Control+Shift+G');
    await page.waitForSelector('[data-testid="style-guide"]');
    if (lang === 'en') await page.getByRole('button', { name: 'EN', exact: true }).first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await page.waitForSelector('[data-testid="sg-ready"]', { state: 'attached' });

    // every component class is on the page
    for (const sel of ['.p-btn.primary', '.p-btn.danger', '.p-input', '.p-select', '.p-textarea', '.p-check', '.p-switch', '.p-seg', '.p-badge.ok', '.p-tabs', '.p-table', '.p-stat', '.p-card', 'svg.chart', '.p-empty', '.p-skel', '.p-spinner', '.p-progress', '.stamp', '.check-draw', '.p-kbd']) {
      await expect(page.locator(sel).first(), sel).toBeAttached();
    }
    expect(await page.locator('svg.chart').count()).toBeGreaterThanOrEqual(2);

    // no horizontal overflow at the minimum screen size
    const overflow = await page.evaluate(() => {
      const m = document.querySelector('.main') as HTMLElement;
      return { w: window.innerWidth, h: window.innerHeight, sw: m.scrollWidth, cw: m.clientWidth, docw: document.documentElement.scrollWidth };
    });
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw);
    expect(overflow.docw).toBeLessThanOrEqual(overflow.w);

    // overlays: modal, drawer and confirm open and close with Esc
    const dialogs = [lang === 'bn' ? 'ডায়ালগ খুলুন' : 'Open modal', lang === 'bn' ? 'পাশের প্যানেল খুলুন' : 'Open drawer'];
    for (const name of dialogs) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    // toast with Undo
    await page.getByRole('button', { name: lang === 'bn' ? 'ফিরিয়ে নেওয়ার বার্তা দেখান' : 'Show toast with Undo' }).click();
    const undo = page.locator('.p-toast .p-btn');
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(page.locator('.p-toast', { hasText: lang === 'bn' ? 'ফিরিয়ে নেওয়া হয়েছে' : 'Undone' })).toBeVisible();

    // Bangla uses Bengali digits; English uses Latin digits
    const statText = await page.locator('.p-stat-value').nth(1).innerText();
    expect(/[০-৯]/.test(statText)).toBe(lang === 'bn');

    // animations Off removes motion durations
    await page.getByRole('button', { name: lang === 'bn' ? 'বন্ধ' : 'Off', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');

    expect(consoleErrors).toEqual([]);
    await app.close();
  });
}

test('no network requests leave the app', async () => {
  const { app, page } = await launch();
  const external: string[] = [];
  page.on('request', (r) => {
    if (!/^(file|data|blob|devtools):/.test(r.url())) external.push(r.url());
  });
  await page.reload();
  await completeSetup(page);
  await page.keyboard.press('Control+Shift+G');
  await page.waitForSelector('[data-testid="style-guide"]');
  expect(external).toEqual([]);
  await app.close();
});
