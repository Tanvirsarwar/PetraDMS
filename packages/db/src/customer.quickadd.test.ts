import { describe, expect, it } from 'vitest';
import { fail, makeApp, ok, setupWithUsers, signInAs } from './testApp';

describe('quick add customer from the sale screen', () => {
  it('keeps address and price type; staff may add retail customers only', async () => {
    const app = makeApp();
    const u = await setupWithUsers(app.d);
    const r = await ok(app.d, 'customer:quickAdd', { name: 'Rahim Store', phone: '01711111111', address: 'Bondor Bazar', type: 'dealer' });
    expect((await ok(app.d, 'customer:list', { includeArchived: false })).find((c) => c.id === r.id)).toMatchObject({ address: 'Bondor Bazar', type: 'dealer', creditLimit: 0 });
    await signInAs(app.d, u.staff, 'staff');
    expect(await fail(app.d, 'customer:quickAdd', { name: 'Cheap Prices', type: 'wholesale' })).toBe('PERMISSION');
    const s = await ok(app.d, 'customer:quickAdd', { name: 'Walk Customer', phone: '' });
    expect((await ok(app.d, 'customer:list', { includeArchived: false })).find((c) => c.id === s.id)).toMatchObject({ type: 'retail' });
  });
});
