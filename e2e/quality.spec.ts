import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { launch, completeSetup, inv } from './helpers';

/** Every screen a person can reach, as a hash route. */
const ROUTES = ['/', '/sales', '/customers', '/purchases', '/inventory', '/products', '/suppliers', '/expenses', '/employees', '/people', '/money', '/reports', '/backup', '/settings', '/data', '/help'];

async function demoShop(page: Page) {
  await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
  await inv(page, 'demo:load');
  await page.reload();
}

for (const lang of ['en', 'bn'] as const) {
  test(`route sweep at 1366x768 in ${lang}: no console errors, no overflow, no raw keys or placeholders`, async () => {
    const { app, page, consoleErrors } = await launch();
    await page.setViewportSize({ width: 1366, height: 768 });
    await completeSetup(page, { lang });
    await demoShop(page);
    const problems: string[] = [];
    for (const r of ROUTES) {
      await page.evaluate((h) => { window.location.hash = h; }, `#${r}`);
      await page.waitForTimeout(450);
      const info = await page.evaluate(() => {
        const main = document.querySelector('main') ?? document.body;
        const text = (main as HTMLElement).innerText;
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rawKey: text.match(/\b[a-z]{2,12}\.[a-zA-Z]{2,24}(?:\.[a-zA-Z]{2,24})?\b(?=[\s]|$)/g)?.filter((k) => /^(pos|nav|common|err|word|data|rep|cat|inv|set|help|money|people|bak|dash|cust|sup|exp|emp|pur|prod)\./.test(k)) ?? [],
          bad: text.match(/\b(undefined|NaN|\[object Object\]|TODO|lorem)\b/i)?.[0] ?? null,
          hasContent: text.trim().length > 20,
          // type rules (D23): no weight above 600 anywhere; in the Bangla UI none above 400 on Bangla text. A Bangla name
          // inside the English UI may sit in a 500/600 element, but Tiro Bangla has Regular only and font-synthesis is
          // off, so it is still drawn Regular (checked below).
          synthesis: getComputedStyle(document.documentElement).fontSynthesis,
          heavy: [...document.querySelectorAll('body *')].filter((el) => {
            const own = [...el.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim());
            if (!own) return false;
            const w = Number(getComputedStyle(el).fontWeight);
            const bangla = /[\u0980-\u09FF]/.test([...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(''));
            return w > 600 || (bangla && w > 400 && document.documentElement.lang === 'bn');
          }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}:${getComputedStyle(el).fontWeight}`)
        };
      });
      if (info.overflowX > 1) problems.push(`${r}: horizontal overflow ${info.overflowX}px`);
      if (info.rawKey.length) problems.push(`${r}: raw keys ${info.rawKey.join(',')}`);
      if (info.bad) problems.push(`${r}: shows "${info.bad}"`);
      if (!info.hasContent) problems.push(`${r}: empty screen`);
      if (info.heavy.length) problems.push(`${r}: heavy type ${info.heavy.join(', ')}`);
      if (info.synthesis !== 'none') problems.push(`${r}: font-synthesis ${info.synthesis}`);
    }
    expect(problems).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await app.close();
  });
}

test('keyboard only: a whole sale without the mouse, and every page reachable by Tab', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
  await inv(page, 'demo:load');
  await page.reload();
  await page.evaluate(() => { window.location.hash = '#/sales'; });
  await expect(page.getByTestId('pos-search')).toBeVisible();

  // F4 to the product box, type, Enter adds the line
  await expect(page.getByRole('option').first()).toBeVisible(); // products loaded
  await page.keyboard.press('F4');
  await expect(page.getByTestId('pos-search')).toBeFocused();
  await page.keyboard.type('ama milk 1 kg', { delay: 30 });
  await expect(page.getByTestId('pos-search')).toHaveValue('ama milk 1 kg');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cart-line-0')).toBeVisible();
  // pay in full from the keyboard, then save with Ctrl+S
  await page.keyboard.press('F8');
  await page.keyboard.type('5000');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('pos-done')).toBeVisible();
  await expect(page.getByTestId('done-docno')).toHaveText(/INV-\d{6}/);
  // F2 starts the next sale; focus goes straight back to the product box
  await page.keyboard.press('F2');
  await expect(page.getByTestId('pos-done')).toBeHidden();
  await expect(page.getByTestId('pos-search')).toBeFocused();

  // every sidebar entry is reached with the Tab key, shows a visible focus ring, and opens with Enter
  const links = page.locator('nav a');
  const n = await links.count();
  expect(n).toBeGreaterThanOrEqual(10);
  await links.first().focus();
  for (let i = 0; i < n; i++) {
    await expect(links.nth(i), `Tab order: nav item ${i} has focus`).toBeFocused();
    // the ring may fade in over a few frames, so wait for it rather than read it the instant focus lands
    await expect.poll(() => links.nth(i).evaluate((el) => {
      const st = getComputedStyle(el);
      return st.outlineStyle !== 'none' || st.boxShadow !== 'none';
    }), { message: `focus ring on nav item ${i}`, timeout: 2000 }).toBe(true);
    const href = (await links.nth(i).getAttribute('href')) ?? '';
    await page.keyboard.press('Enter');
    // wait for the route itself, not just any heading: a page that focuses its own search box (Sell) must have
    // finished arriving before the next Tab, or it takes the focus back from the menu
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`));
    await expect(page.locator('main h1, main h2, main [data-testid="pos-search"]').first()).toBeVisible();
    if (i < n - 1) {
      // routing may move focus into the page; real users Tab back, so return to the item the way a user would
      await links.nth(i).focus();
      await page.keyboard.press('Tab');
    }
  }
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('start-up time and memory: window ready in under 4 s, resident memory under 350 MB when idle', async () => {
  const t0 = Date.now();
  const { app, page } = await launch();
  await page.waitForSelector('[data-testid="wizard-step-1"]');
  const startMs = Date.now() - t0;
  await completeSetup(page, { lang: 'en' });
  await page.evaluate(() => localStorage.setItem('petra.tour.done', '1'));
  await inv(page, 'demo:load');
  await page.reload();
  await page.evaluate(() => { window.location.hash = '#/reports'; });
  await page.waitForTimeout(3000); // idle
  const procs = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, ws: m.memory.workingSetSize / 1024, priv: (m.memory.privateBytes ?? 0) / 1024 })));
  // Resident sizes count Electron's shared libraries once per process. Proportional set size (PSS) counts every page once,
  // which is what the machine really spends. On Windows the same role is played by private bytes (what Task Manager calls memory); the working set there also counts shared pages in every process.
  const pss = (pid: number): number | null => {
    try {
      const m = /^Pss:\s+(\d+) kB/m.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
      return m ? Number(m[1]) / 1024 : null;
    } catch { return null; }
  };
  const parts = procs.map((p) => ({ ...p, pss: pss(p.pid) }));
  const rss = parts.reduce((x, p) => x + p.ws, 0);
  const mb = parts.reduce((x, p) => x + (p.pss ?? (p.priv > 0 ? p.priv : p.ws)), 0);
  console.log(`cold start ${startMs} ms; memory ${Math.round(mb)} MB proportional (${Math.round(rss)} MB summed resident); ${parts.map((p) => `${p.type} ${Math.round(p.pss ?? (p.priv > 0 ? p.priv : p.ws))}`).join(', ')}`);
  expect(startMs).toBeLessThan(4000);
  expect(mb).toBeLessThan(350);
  await app.close();
});
