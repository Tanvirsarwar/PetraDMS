import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launch, completeSetup, inv, navTo } from './helpers';

const LONG = 'Messrs Rahim Brothers Trading and Distribution Company of Greater Sylhet Division Limited, Zindabazar Branch';
const LONG_BN = 'মেসার্স রহিম ব্রাদার্স ট্রেডিং অ্যান্ড ডিস্ট্রিবিউশন কোম্পানি বৃহত্তর সিলেট বিভাগ লিমিটেড জিন্দাবাজার শাখা';

/** Where the trader block and the product footer sit in the sidebar, and whether anything spills over. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const side = document.querySelector('.sidebar') as HTMLElement;
    const name = document.querySelector('.sidebar [data-testid="trader-name"]') as HTMLElement;
    const lh = parseFloat(getComputedStyle(name).lineHeight) || 20;
    return {
      brand: box('.sidebar [data-testid="trader-brand"]'),
      nav: box('.sidebar nav'),
      powered: box('.sidebar [data-testid="product-footer"]'),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sideOverflow: side.scrollWidth - side.clientWidth,
      nameLines: Math.round(name.getBoundingClientRect().height / lh),
      title: document.title
    };
  });
}

for (const lang of ['en', 'bn'] as const) {
  test(`branding in ${lang}: the trader's name at the top, PetraDMS and "Made by Petra" quietly at the bottom`, async () => {
    const { app, page, consoleErrors } = await launch();
    await page.setViewportSize({ width: 1366, height: 768 });
    await completeSetup(page, { lang, business: 'Rahim Traders' });
    await inv(page, 'profile:save', { name: 'Rahim Traders', nameBn: 'রহিম ট্রেডার্স', address: 'Sylhet', phone: '01712345678', email: '', taxNo: '', footerNote: '' });
    await page.reload();
    await expect(page.getByTestId('account')).toBeVisible();
    const brand = page.locator('.sidebar').getByTestId('trader-name');
    await expect(brand).toHaveText(lang === 'bn' ? 'রহিম ট্রেডার্স' : 'Rahim Traders');
    await expect(page.locator('.sidebar').getByTestId('trader-mono')).toHaveText(lang === 'bn' ? 'র' : 'R');
    // the footer names the product (one word) and the maker under it, with no version; the old wording is gone
    const foot = page.locator('.sidebar').getByTestId('product-footer');
    await expect(foot.getByTestId('footer-product')).toHaveText('PetraDMS');
    await expect(foot.getByTestId('made-by')).toHaveText(lang === 'bn' ? 'প্রস্তুতকারক: Petra' : 'Made by Petra');
    await expect(page.locator('body')).not.toContainText('Powered by');
    await expect(page.locator('body')).not.toContainText('Petra DMS');
    await expect(page.locator('.sidebar').getByText('PETRA', { exact: true })).toHaveCount(0);
    const l = await layout(page);
    expect(l.brand!.top).toBeLessThan(l.nav!.top);
    expect(l.powered!.top).toBeGreaterThan(l.nav!.bottom - 1);
    expect(l.title).toBe(`${lang === 'bn' ? 'রহিম ট্রেডার্স' : 'Rahim Traders'} · PetraDMS`);
    // the name is on the sign-in screen too, with Petra under it
    await page.getByTestId('account').click();
    await page.getByTestId('signout').click();
    await expect(page.getByTestId('login-brand')).toContainText(lang === 'bn' ? 'রহিম ট্রেডার্স' : 'Rahim Traders');
    await expect(page.getByTestId('footer-product')).toHaveText('PetraDMS');
    await expect(page.getByTestId('made-by')).toHaveText(lang === 'bn' ? 'প্রস্তুতকারক: Petra' : 'Made by Petra');
    // Help > About names the builder
    expect(consoleErrors).toEqual([]);
    await app.close();
  });
}

test('a very long business name wraps to two lines and never breaks the layout, at every font size, in both languages', async () => {
  const { app, page, consoleErrors } = await launch();
  await page.setViewportSize({ width: 1366, height: 768 });
  await completeSetup(page, { lang: 'en' });
  await inv(page, 'profile:save', { name: LONG, nameBn: LONG_BN, address: '', phone: '', email: '', taxNo: '', footerNote: '' });
  for (const lang of ['en', 'bn'] as const) {
    for (const fontSize of ['normal', 'large', 'xlarge'] as const) {
      await page.evaluate(([lg, fs]) => localStorage.setItem('petra.ui.v1', JSON.stringify({ lang: lg, mode: 'full', animations: 'off', fontSize: fs, contrast: false })), [lang, fontSize] as const);
      await page.reload();
      await expect(page.getByTestId('account')).toBeVisible();
      const l = await layout(page);
      expect(l.pageOverflow, `${lang}/${fontSize}: page overflow`).toBeLessThanOrEqual(1);
      expect(l.sideOverflow, `${lang}/${fontSize}: sidebar overflow`).toBeLessThanOrEqual(1);
      expect(l.nameLines, `${lang}/${fontSize}: name lines`).toBeLessThanOrEqual(2);
      // the full name is still available as a tooltip
      await expect(page.locator('.sidebar').getByTestId('trader-brand')).toHaveAttribute('title', lang === 'bn' ? LONG_BN : LONG);
      expect(l.brand!.top).toBeLessThan(l.nav!.top);
    }
  }
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('logo: chosen in Settings > Business, shown at the top instead of the monogram, removed again', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  await navTo(page, 'Settings');
  // a 1 x 1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.getByTestId('logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.sidebar').getByTestId('trader-logo')).toBeVisible();
  await expect(page.locator('.sidebar').getByTestId('trader-mono')).toHaveCount(0);
  // a text file named .png is refused before it is sent
  await page.getByTestId('logo-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByTestId('logo-error')).toBeVisible();
  await page.getByTestId('logo-remove').click();
  await expect(page.locator('.sidebar').getByTestId('trader-mono')).toHaveText('R');
  expect(consoleErrors).toEqual([]);
  await app.close();
});

test('printed PDF in Bangla embeds Tiro Bangla and Nunito (text and title) and keeps conjuncts as one glyph cluster', async () => {
  const { app, page, dataDir, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'bn' });
  await inv(page, 'profile:save', { name: 'Rahim Traders', nameBn: 'রহিম ট্রেডার্স', address: 'জিন্দাবাজার, সিলেট', phone: '01712345678', email: '', taxNo: '', footerNote: 'ক্ষ ত্র জ্ঞ ন্দ্র স্ত্র শ্রী ধন্যবাদ' });
  const p = await inv<{ id: number }>(page, 'catalog:productSave', { sku: 'MLK', name: 'Milk', nameBn: 'মার্কস গুঁড়া দুধ (যুক্তাক্ষর ক্ত ঙ্গ)', baseUnit: 'pcs', priceRetail: 5_500, priceWholesale: 5_000, priceDealer: 4_800 });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;
  await inv(page, 'stock:adjust', { productId: p.id, kind: 'opening', baseQty: 10, date: today, value: 40_000, reason: 'opening' });
  const sale = await inv<{ id: number; docNo: string }>(page, 'sale:save', { date: today, paid: 11_000, lines: [{ productId: p.id, qty: 2, price: 5_500 }] });
  const r = await inv<{ path: string }>(page, 'print:run', { doc: { type: 'invoice', id: sale.id }, action: 'pdf', format: 'a4' });
  const file = r.path || path.join(dataDir, 'invoices', `${sale.docNo}.pdf`);
  await expect.poll(() => fs.existsSync(file), { timeout: 20_000 }).toBe(true);
  const pdf = fs.readFileSync(file).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  // the bundled faces are embedded (subset names carry the family), not a system fallback, and the old faces are gone
  expect(pdf).toMatch(/TiroBangla/);
  expect(pdf).toMatch(/Nunito/);
  expect(pdf).not.toMatch(/HindSiliguri|Fraunces|PlusJakarta|NotoSansBengali/);

  // shaping: in the face the screen uses, a conjunct is narrower than its letters written with a visible hasant
  // (ক্ষ is one glyph; ক + ্ + ‌ + ষ would show the hasant), which only holds when the font's Bangla shaping is applied
  const shaped = await page.evaluate(async () => {
    await document.fonts.load('400 20px "Tiro Bangla"', 'ক্ষ');
    const c = document.createElement('canvas').getContext('2d')!;
    const w = (font: string, s: string) => { c.font = font; return c.measureText(s).width; };
    return {
      ui: [w('400 20px "Tiro Bangla"', 'ক্ষ'), w('400 20px "Tiro Bangla"', 'ক্‌ষ')],
      display: [w('400 20px "Tiro Bangla"', 'স্ত্র'), w('400 20px "Tiro Bangla"', 'স্‌ত্‌র')],
      digits: w('400 20px "Tiro Bangla"', '০১২৩৪৫৬৭৮৯') > 0,
      loaded: document.fonts.check('400 20px "Tiro Bangla"', 'ক্ষ'),
      family: getComputedStyle(document.body).fontFamily,
      synthesis: getComputedStyle(document.documentElement).fontSynthesis
    };
  });
  expect(shaped.family).toMatch(/^"?Nunito"?, "?Tiro Bangla"?/);
  expect(shaped.synthesis).toBe('none');
  expect(shaped.digits).toBe(true);
  expect(shaped.loaded).toBe(true);
  expect(shaped.ui[0]).toBeLessThan(shaped.ui[1]!);
  expect(shaped.display[0]).toBeLessThan(shaped.display[1]!);
  expect(consoleErrors).toEqual([]);
  await app.close();
});
