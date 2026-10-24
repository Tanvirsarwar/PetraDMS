import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launch, completeSetup, inv } from './helpers';

// Layout audit: opens every page, row panel and "add" panel with demo data, at two window sizes and in both languages,
// and fails if anything is cut off, off-screen, or makes a panel scroll sideways. Opt-in (PETRA_LAYOUT_AUDIT=1),
// because font metrics differ between machines and it must never block the Windows installer build.
test.skip(!process.env.PETRA_LAYOUT_AUDIT, 'set PETRA_LAYOUT_AUDIT=1 to run the layout audit');
test.setTimeout(10 * 60_000);

// 1280x720 is a 1920x1080 screen at 150% Windows scaling (and stricter than a 1366x768 laptop); 1920x1080 at 100%
const SIZES = [{ w: 1280, h: 720 }, { w: 1920, h: 1080 }];

async function resize(app: ElectronApplication, w: number, h: number) {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(cw as number, ch as number);
  }, [w, h]);
}

/** Problems on the screen as it is now. Intentional scroll areas (a data table on a page) are allowed; panels are not. */
function scan(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = innerWidth;
    const out: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    };
    const label = (el: Element) => (el.getAttribute('data-testid') || el.getAttribute('aria-label') || (el.textContent ?? '').trim() || el.tagName).slice(0, 50);
    const where = (el: Element) => (el.closest('.p-drawer') ? 'panel' : el.closest('.p-modal') ? 'dialog' : 'page');
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2 && visible(el)) {
        // a page's own data table may scroll sideways on a small window; inside a panel or dialog nothing should
        if (where(el) !== 'page' || el === document.documentElement || el === document.body) out.push(`sideways scroll [${where(el)}] ${(el as HTMLElement).className || el.tagName} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const el of Array.from(document.querySelectorAll('button,input,select,textarea,a,label,th,td,h1,h2,h3,strong,.p-hint'))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 || r.left < -1) { out.push(`off-screen [${where(el)}] ${label(el)}`); continue; }
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible') continue;
        const ar = a.getBoundingClientRect();
        const scrolls = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 2;
        if (!scrolls && (r.right > ar.right + 1 || r.left < ar.left - 1)) out.push(`cut off [${where(el)}] ${label(el)}`);
        break;
      }
    }
    return [...new Set(out)];
  });
}

async function closeAll(page: Page) {
  for (let i = 0; i < 3; i++) {
    if ((await page.locator('.p-drawer, .p-modal').count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

test('layout audit: nothing cut off or scrolling sideways, on every page, panel and dialog', async () => {
  const { app, page } = await launch();
  await completeSetup(page, { lang: 'bn' });
  await inv(page, 'demo:load');
  await page.reload();
  await page.waitForSelector('nav');
  const problems: string[] = [];
  let checks = 0;
  let panels = 0;
  const check = async (what: string) => {
    await page.waitForTimeout(450);
    checks++;
    if ((await page.locator('.p-drawer, .p-modal').count()) > 0) panels++;
    for (const p of await scan(page)) problems.push(`${what}: ${p}`);
  };

  for (const lang of ['bn', 'en'] as const) {
    if (lang === 'en') { await page.getByRole('button', { name: 'EN', exact: true }).click(); await page.waitForTimeout(300); }
    for (const s of SIZES) {
      await resize(app, s.w, s.h);
      const tag = `${lang} ${s.w}x${s.h}`;
      const links = await page.locator('nav a').all();
      for (let i = 0; i < links.length; i++) {
        const link = page.locator('nav a').nth(i);
        const name = (await link.innerText()).trim();
        await link.click();
        await check(`${tag} ${name}`);
        // every tab of the page
        const tabs = await page.locator('[role="tab"]').count();
        for (let k = 0; k < tabs; k++) {
          const tab = page.locator('[role="tab"]').nth(k);
          if (!(await tab.isVisible())) continue;
          const tname = (await tab.innerText()).trim();
          await tab.click();
          await check(`${tag} ${name} > ${tname}`);
          // the first row's panel
          const row = page.locator('main tbody tr').first();
          if (await row.isVisible().catch(() => false)) {
            await row.click().catch(() => undefined);
            await check(`${tag} ${name} > ${tname} > first row`);
            await closeAll(page);
          }
          // "add" and "new" buttons open their panels or dialogs
          const adds = page.locator('main [data-testid^="add-"], main [data-testid^="new-"]');
          for (let j = 0; j < (await adds.count()); j++) {
            const b = adds.nth(j);
            if (!(await b.isVisible()) || !(await b.isEnabled())) continue;
            const id = await b.getAttribute('data-testid');
            await b.click().catch(() => undefined);
            await check(`${tag} ${name} > ${tname} > ${id}`);
            await closeAll(page);
          }
        }
      }
    }
  }
  // busy screens the crawl does not reach on its own, at the smallest size in both languages
  for (const lang of ['en', 'bn'] as const) {
    await page.getByRole('button', { name: lang === 'en' ? 'EN' : 'বাংলা', exact: true }).click();
    await resize(app, 1280, 720);
    await page.locator('nav a').nth(1).click();
    await page.locator('[role="tab"]').first().click();
    for (let k = 0; k < 4; k++) await page.locator('.pos-tile').nth(k).click();
    await check(`${lang} sale cart with 4 lines`);
    await page.getByTestId('pos-add-customer').click();
    await check(`${lang} sale > add customer`);
    await closeAll(page);
    await page.getByTestId('pos-customer').click();
    await check(`${lang} sale > choose customer`);
    await closeAll(page);
    await page.getByRole('button', { name: lang === 'en' ? 'Clear' : 'মুছুন', exact: true }).click().catch(() => undefined);
    await page.locator('[role="tab"]').nth(1).click();
    await page.locator('main tbody tr').first().click();
    await page.getByTestId('sale-return').click().catch(() => undefined);
    await check(`${lang} invoice > return`);
    await closeAll(page);
    await page.locator('nav a').nth(4).click();
    await page.getByTestId('add-product').click();
    await page.getByTestId('product-has-box').click();
    await page.getByTestId('product-box-pcs').fill('24');
    await page.getByTestId('product-more-packs').click();
    await page.getByTestId('add-dozen').click().catch(() => undefined);
    await check(`${lang} product editor with box and more packs`);
    await closeAll(page);
  }

  // control: put back the old narrow invoice panel with a non-wrapping footer; the scan must catch it
  await resize(app, 1280, 720);
  await page.locator('nav a').nth(1).click();
  await page.locator('[role="tab"]').nth(1).click();
  await page.locator('main tbody tr').first().click();
  await page.waitForTimeout(450);
  await page.addStyleTag({ content: '.p-drawer.wide{width:380px!important}.p-modal-f{flex-wrap:nowrap!important}' });
  const control = await scan(page);
  console.log(`CONTROL: ${control.length} problem(s) with the old layout\n${control.join('\n')}`);
  expect(control.length, 'the scan must catch the old cut-off footer').toBeGreaterThan(0);
  console.log(`\nLAYOUT AUDIT: ${checks} screens, ${panels} with a panel or dialog, ${problems.length} problem(s)\n${problems.join('\n')}`);
  await app.close();
  expect(panels, 'the audit must open panels and dialogs').toBeGreaterThan(20);
  expect(problems).toEqual([]);
});
