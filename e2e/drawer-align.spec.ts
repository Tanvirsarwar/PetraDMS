import { test, expect } from '@playwright/test';
import { launch, completeSetup, navTo } from './helpers';

test('side panels (add product, add supplier): text starts on the left, panel sits above the top bar', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });

  await navTo(page, 'Products');
  await page.getByTestId('add-product').click();
  const drawer = page.getByRole('dialog', { name: 'Add product' });
  await expect(drawer).toBeVisible();
  const align = (loc: ReturnType<typeof page.locator>) => loc.evaluate((el) => getComputedStyle(el).textAlign);
  expect(['left', 'start']).toContain(await align(drawer.locator('label', { hasText: 'Name (English)' }).first()));
  expect(['left', 'start']).toContain(await align(drawer.locator('.p-hint').first()));
  // the panel is the top layer: the point where the top bar's account button sits belongs to the panel
  const covered = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="account"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.p-scrim');
  });
  expect(covered).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  await navTo(page, 'Suppliers');
  await page.getByTestId('add-supplier').click();
  const sup = page.getByRole('dialog').first();
  await expect(sup).toBeVisible();
  expect(['left', 'start']).toContain(await align(sup.locator('label').first()));
  expect(consoleErrors).toEqual([]);
  await app.close();
});
