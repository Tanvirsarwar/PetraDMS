import { test, expect, type Page } from '@playwright/test';
import { launch, completeSetup, inv, navTo } from './helpers';

const panelOpen = (page: Page) => page.getByTestId('dock-panel');
const isOpen = async (page: Page) => (await panelOpen(page).getAttribute('data-open')) === 'true';

/** Keys at a person's pace: the app treats a fast burst as a barcode scanner. */
async function typeSlow(page: Page, s: string) {
  await page.keyboard.type(s, { delay: 60 });
}

for (const lang of ['en', 'bn'] as const) {
  test(`dock in ${lang}: opens and closes with its buttons, Esc and Alt+C / Alt+G, never takes the focus, never overflows`, async () => {
    const { app, page, consoleErrors } = await launch();
    await page.setViewportSize({ width: 1366, height: 768 });
    await completeSetup(page, { lang });
    await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
    await page.reload();
    await expect(page.getByTestId('dock')).toBeVisible();
    await expect(page.getByTestId('dock-calc')).toHaveAttribute('aria-label', lang === 'bn' ? 'ক্যালকুলেটর' : 'Calculator');
    expect(await isOpen(page)).toBe(false);

    // button: open, second click closes
    await page.getByTestId('dock-calc').click();
    await expect(panelOpen(page)).toHaveAttribute('data-open', 'true');
    await expect(page.getByTestId('dock-calculator')).toBeVisible();
    await page.getByTestId('dock-calc').click();
    await expect(panelOpen(page)).toHaveAttribute('data-open', 'false');
    await expect(page.getByTestId('dock-calculator')).toBeHidden();

    // Alt+C / Alt+G toggle; the games button switches the panel to games
    await page.keyboard.press('Alt+KeyC');
    await expect(panelOpen(page)).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Alt+KeyG');
    await expect(page.getByTestId('dock-games-panel')).toBeVisible();
    await expect(page.getByTestId('dock-calculator')).toBeHidden();
    await page.keyboard.press('Alt+KeyG');
    await expect(panelOpen(page)).toHaveAttribute('data-open', 'false');

    // Esc closes it when the keyboard is in the panel, and the close button too
    await page.getByTestId('dock-calc').click();
    await page.getByTestId('dock-calculator').click();
    await page.keyboard.press('Escape');
    await expect(panelOpen(page)).toHaveAttribute('data-open', 'false');
    await page.getByTestId('dock-calc').click();
    await page.getByTestId('dock-close').click();
    await expect(panelOpen(page)).toHaveAttribute('data-open', 'false');

    // opening it while typing in a page field leaves the keyboard in that field
    await navTo(page, lang === 'bn' ? 'বিক্রয়' : 'Sales');
    const search = page.getByTestId('pos-search');
    await search.focus();
    await typeSlow(page, 'ab');
    await page.keyboard.press('Alt+KeyC');
    await expect(panelOpen(page)).toHaveAttribute('data-open', 'true');
    await expect(search).toBeFocused();
    await typeSlow(page, 'c');
    await expect(search).toHaveValue('abc');
    await expect(page.getByTestId('dcalc-expr')).toHaveText(lang === 'bn' ? '০' : '0');
    // Esc in the page field belongs to the page, not the dock
    await search.press('Escape');
    expect(await isOpen(page)).toBe(true);

    // the panel overlays: no page overflow at 1366x768, on the dashboard, POS, purchases and settings, with the dock open
    for (const route of ['/', '/sales', '/purchases', '/settings']) {
      await page.evaluate((h) => { window.location.hash = h; }, `#${route}`);
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${route} overflow`).toBeLessThanOrEqual(1);
      const box = await page.getByTestId('dock-panel').boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(1366);
    }
    // it sits under dialogs: the account dialog covers it
    await page.getByTestId('account').click({ trial: true });
    await page.getByTestId('account').click();
    const z = await page.evaluate(() => [Number(getComputedStyle(document.querySelector('.p-scrim')!).zIndex), Number(getComputedStyle(document.querySelector('.dock-panel')!).zIndex)]);
    expect(z[0]).toBeGreaterThan(z[1]!);
    await page.keyboard.press('Escape');
    // hidden when printing
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('dock')).toBeHidden();
    await expect(page.getByTestId('dock-panel')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    expect(consoleErrors).toEqual([]);
    await app.close();
  });
}

test('dock calculator: exact decimals, brackets and percent from the keyboard and the keys, five results kept, copy result', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
  await page.reload();
  await expect(page.getByTestId('dock')).toBeVisible();
  await page.keyboard.press('Alt+KeyC');
  const calc = page.getByTestId('dock-calculator');
  await calc.click(); // the keyboard goes to the calculator only after a click into it
  await typeSlow(page, '0.1+0.2');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dcalc-result')).toHaveText('= 0.3');
  await page.keyboard.press('Delete');
  await typeSlow(page, '(2+3)*4');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dcalc-result')).toHaveText('= 20');
  // the on-screen keys: 1250 + 15 % = 1437.5
  for (const k of ['C', '1', '2', '5', '0', 'plus', '1', '5', 'pct', 'eq']) await page.getByTestId(`dcalc-${k}`).click();
  await expect(page.getByTestId('dcalc-result')).toHaveText('= 1437.5');
  // a bad sum says so instead of guessing
  await page.getByTestId('dcalc-C').click();
  await calc.focus();
  await typeSlow(page, '5/0');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dcalc-result')).toHaveText('Cannot divide by zero');
  await page.keyboard.press('Delete');
  await typeSlow(page, '2*');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dcalc-result')).toHaveText('Check the sum');
  // backspace, then three more sums: only the last five results stay
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dcalc-result')).toHaveText('= 2');
  for (const s of ['1+1', '9*9', '7-10']) {
    await page.keyboard.press('Delete');
    await typeSlow(page, s);
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('dcalc-history').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('dcalc-history').locator('li').first()).toContainText('-3');
  // copy result puts the answer on the clipboard; nothing is typed into any page field
  await page.getByTestId('dcalc-copy').click();
  await expect(page.getByTestId('dcalc-copied')).toHaveText('Result copied.');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('-3');
  // the sum survives closing and reopening the panel
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+KeyC');
  await expect(page.getByTestId('dcalc-result')).toHaveText('= -3');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('dock games: keys reach a game only when it has the keyboard, games pause when the panel closes, the Owner can hide games or the whole dock', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
  await page.reload();
  await page.getByTestId('dock-games').click();
  await expect(page.getByRole('button', { name: '2048' })).toBeVisible();
  await page.getByRole('button', { name: '2048' }).click();
  const board = page.getByTestId('g2048-board');
  const tiles = () => board.locator('[data-v]').evaluateAll((els) => els.map((e) => e.getAttribute('data-v')).join(','));
  await page.getByTestId('game-2048').focus();
  // some direction always moves a fresh board
  const before = await tiles();
  for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(k);
  await expect.poll(tiles).not.toBe(before);

  // with a page field focused, arrow keys stay with the page and the board does not move
  await navTo(page, 'Sales');
  const now = await tiles();
  await page.getByTestId('pos-search').focus();
  for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(k);
  expect(await tiles()).toBe(now);
  await expect(page.getByTestId('pos-search')).toBeFocused();

  // snake starts paused, runs, and pauses again when the panel closes
  await page.getByRole('button', { name: 'Snake' }).click();
  await expect(page.getByTestId('snake-paused')).toBeVisible();
  await page.getByTestId('game-snake').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('snake-paused')).toBeHidden();
  await page.getByTestId('dock-close').click();
  await page.getByTestId('dock-games').click();
  await expect(page.getByTestId('snake-paused')).toBeVisible();

  // memory: two cards open, a pair or not, and the move counter moves
  await page.getByRole('button', { name: 'Memory' }).click();
  await page.getByTestId('memory-card-0').click();
  await page.getByTestId('memory-card-1').click();
  await expect(page.getByTestId('memory-moves')).toHaveText('1');

  // Settings: games off leaves only the calculator, and Alt+G does nothing
  await inv(page, 'settings:save', { dockGames: false });
  await page.reload();
  await expect(page.getByTestId('dock-calc')).toBeVisible();
  await expect(page.getByTestId('dock-games')).toHaveCount(0);
  await page.keyboard.press('Alt+KeyG');
  expect(await isOpen(page)).toBe(false);
  // the Owner switches it in Settings > Appearance; the games switch is off and the dock switch is on
  await navTo(page, 'Settings');
  await page.getByRole('tab', { name: 'Language and look' }).click();
  await expect(page.getByTestId('set-dock-games')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('set-dock-games').click();
  await expect(page.getByTestId('dock-games')).toBeVisible();
  // the whole dock off
  await page.getByTestId('set-dock-calc').click();
  await expect(page.getByTestId('dock')).toHaveCount(0);
  await page.keyboard.press('Alt+KeyC');
  await expect(page.getByTestId('dock-panel')).toHaveCount(0);
  await page.getByTestId('set-dock-calc').click();
  await expect(page.getByTestId('dock')).toBeVisible();

  // staff see the dock but cannot change the setting (the main process refuses)
  await inv(page, 'users:create', { username: 'stf', displayName: 'Staff', role: 'staff', kind: 'pin', secret: '2222' });
  await page.getByTestId('account').click();
  await page.getByTestId('signout').click();
  const users = await inv<{ id: number; role: string }[]>(page, 'auth:users');
  const staff = users.find((u) => u.role === 'staff')!;
  await inv(page, 'auth:login', { userId: staff.id, secret: '2222' });
  await page.reload();
  await expect(page.getByTestId('dock')).toBeVisible();
  const refused = await page.evaluate(() => (window as unknown as { petra: { invoke: (c: string, i: unknown) => Promise<unknown> } }).petra.invoke('settings:save', { dockGames: false }).then(() => 'saved', (e: Error) => e.message));
  expect(refused).toContain('"code":"PERMISSION"');
  await expect(page.getByTestId('dock-games')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('dock panel: dragged by its header, remembered after a reload, kept on screen', async () => {
  const { app, page, consoleErrors } = await launch();
  await page.setViewportSize({ width: 1366, height: 768 });
  await completeSetup(page, { lang: 'en' });
  await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
  await page.reload();
  await page.getByTestId('dock-calc').click();
  await page.getByTestId('dock-calculator').waitFor();
  await page.waitForTimeout(400); // let the opening fade finish
  const head = page.getByTestId('dock-drag');
  const a = (await head.boundingBox())!;
  await page.mouse.move(a.x + 60, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x - 300, a.y + 150, { steps: 8 });
  await page.mouse.up();
  const b = (await head.boundingBox())!;
  expect(Math.round(b.x - a.x)).toBeLessThan(-300);
  expect(Math.round(b.y - a.y)).toBeGreaterThan(100);
  await page.reload();
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-open', 'true'); // open state remembered
  const c = (await head.boundingBox())!;
  expect(Math.abs(c.x - b.x)).toBeLessThan(2);
  expect(Math.abs(c.y - b.y)).toBeLessThan(2);
  // dragging far off screen is clamped
  await page.mouse.move(c.x + 60, c.y + 10);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps: 5 });
  await page.mouse.up();
  const d = (await page.getByTestId('dock-panel').boundingBox())!;
  expect(d.x).toBeGreaterThanOrEqual(0);
  expect(d.y).toBeGreaterThanOrEqual(0);
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('Animations Off removes every transition; Reduced keeps fades and drops movement; Full has both', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
  const probe = () => page.evaluate(() => {
    const btn = document.querySelector('.p-btn')!;
    const card = document.querySelector('.dock-card')!;
    const st = getComputedStyle(btn);
    const root = getComputedStyle(document.documentElement);
    return {
      motion: document.documentElement.dataset.motion,
      btnTransition: st.transitionDuration.split(',').map((x) => parseFloat(x)).reduce((m, x) => Math.max(m, x), 0),
      cardTransition: getComputedStyle(card).transitionDuration.split(',').map((x) => parseFloat(x)).reduce((m, x) => Math.max(m, x), 0),
      lift: root.getPropertyValue('--move-lift').trim(),
      rise: root.getPropertyValue('--move-rise').trim()
    };
  });
  for (const animations of ['full', 'reduced', 'off'] as const) {
    await page.evaluate((a) => localStorage.setItem('petra.ui.v1', JSON.stringify({ lang: 'en', mode: 'full', animations: a, fontSize: 'normal', contrast: false })), animations);
    await page.reload();
    await expect(page.getByTestId('dock')).toBeVisible();
    const p = await probe();
    if (animations === 'off') {
      expect(p).toMatchObject({ motion: 'off', btnTransition: 0, cardTransition: 0, lift: '0px', rise: '0px' });
    } else if (animations === 'reduced') {
      expect(p.motion).toBe('reduced');
      expect(p.btnTransition).toBeGreaterThan(0);
      expect(p).toMatchObject({ lift: '0px', rise: '0px' });
    } else {
      // the container may itself ask for reduced motion; Full then becomes Reduced (prefers-reduced-motion is honoured)
      const os = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      expect(p.motion).toBe(os ? 'reduced' : 'full');
      expect(p.btnTransition).toBeGreaterThan(0);
      if (!os) expect(p.lift).toBe('-2px');
    }
  }
  expect(consoleErrors).toEqual([]);
  await app.close();
});
