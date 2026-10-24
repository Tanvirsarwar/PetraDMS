import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, VENDOR } from '@petra/core';
import { fail, makeApp, ok, setupWithUsers, signInAs } from './testApp';

// a 1 x 1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('trader branding', () => {
  it('keeps the logo in the database, shows it in the status and on printed documents, and refuses anything that is not a small picture', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    expect((await ok(app.d, 'app:status')).logo).toBeNull();
    expect((await ok(app.d, 'profile:logo', { dataUrl: PNG })).logo).toBe(PNG);
    const st = await ok(app.d, 'app:status');
    expect(st.logo).toBe(PNG);
    expect(st.profile.name).toBe('Rahim Traders');
    // the logo is printed in the header of invoices and GRNs
    const p = await ok(app.d, 'catalog:productSave', { sku: 'A', name: 'A', baseUnit: 'pcs', priceRetail: 100, priceWholesale: 100, priceDealer: 100 });
    await ok(app.d, 'stock:adjust', { productId: p.id, kind: 'opening', baseQty: 5, date: '2026-10-01', value: 250, reason: 'opening' });
    const s = await ok(app.d, 'sale:save', { date: '2026-10-01', paid: 100, lines: [{ productId: p.id, qty: 1, price: 100 }] });
    await ok(app.d, 'print:run', { doc: { type: 'invoice', id: s.id }, action: 'print' });
    expect(app.printed.at(-1)).toContain(`<img class="logo" src="${PNG}"`);
    expect(app.printed.at(-1)).toContain('রহিম ট্রেডার্স');

    // wrong type, a text file pretending to be a PNG, too big
    expect(await fail(app.d, 'profile:logo', { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' })).toBe('INVALID_INPUT');
    expect(await fail(app.d, 'profile:logo', { dataUrl: `data:image/png;base64,${Buffer.from('hello, not a picture').toString('base64')}` })).toBe('INVALID_INPUT');
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(LOGO_MAX_BYTES)]);
    expect(await fail(app.d, 'profile:logo', { dataUrl: `data:image/png;base64,${big.toString('base64')}` })).toBe('INVALID_INPUT');
    // only the Owner changes it
    await signInAs(app.d, u.manager, 'manager');
    expect(await fail(app.d, 'profile:logo', { dataUrl: null })).toBe('PERMISSION');
    await signInAs(app.d, u.owner, 'owner');
    expect((await ok(app.d, 'profile:logo', { dataUrl: null })).logo).toBeNull();
    expect((await ok(app.d, 'app:status')).logo).toBeNull();
  });

  it('the utility dock settings default on, are kept in app_settings, and only the Owner can change them', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    expect(await ok(app.d, 'settings:get')).toMatchObject({ dockCalculator: true, dockGames: true });
    expect((await ok(app.d, 'app:status')).settings).toMatchObject({ dockCalculator: true, dockGames: true });
    expect(await ok(app.d, 'settings:save', { dockGames: false })).toMatchObject({ dockCalculator: true, dockGames: false });
    expect((await ok(app.d, 'app:status')).settings.dockGames).toBe(false);
    for (const [id, role] of [[u.manager, 'manager'], [u.staff, 'staff']] as const) {
      await signInAs(app.d, id, role);
      expect(await fail(app.d, 'settings:save', { dockCalculator: false })).toBe('PERMISSION');
      expect(await fail(app.d, 'settings:save', { dockGames: true })).toBe('PERMISSION');
      // everyone signed in still reads them, so the dock shows the same for every user
      expect((await ok(app.d, 'app:status')).settings).toMatchObject({ dockCalculator: true, dockGames: false });
    }
    await signInAs(app.d, u.owner, 'owner');
    expect(await fail(app.d, 'settings:save', { dockGames: 'yes' })).toBe('INVALID_INPUT');
  });

  it('names the builder in one place', () => {
    expect(VENDOR).toMatchObject({ companyName: 'Petra', productName: 'PetraDMS' });
  });
});
