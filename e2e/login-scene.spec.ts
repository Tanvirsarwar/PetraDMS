import { test, expect } from '@playwright/test';
import { launch, completeSetup, signInPin } from './helpers';

test('sign-in screen: flowing backdrop moves slowly, never blocks the PIN pad, and stills under reduced motion', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();

  const scene = page.getByTestId('scene3d');
  await expect(scene).toBeAttached();
  await expect(scene).toHaveAttribute('aria-hidden', 'true');
  const anim = () => page.locator('.s3-ribbon').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(await anim()).toBe('s3-sway-a');

  // the backdrop must not swallow clicks: sign in through the pad
  await expect(page.getByTestId('pin-dots')).toBeVisible();
  // reduced motion (OS setting) keeps the picture but stops the movement
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(scene).toBeAttached();
  expect(await anim()).toBe('none');
  expect(await page.locator('.s3-ribbon').last().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

  await signInPin(page, '4321');
  await expect(page.getByTestId('account')).toContainText('Rahim');
  expect(consoleErrors).toEqual([]);
  await app.close();
});
