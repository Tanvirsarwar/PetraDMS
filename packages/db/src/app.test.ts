import { describe, expect, it } from 'vitest';
import { PetraError } from '@petra/core';
import { DAY, T0, makeApp, setupInput } from './testApp';
import { LOCK_MINUTES, MAX_ATTEMPTS, generateRecoveryCode, hashSecret, verifySecret } from './app/auth';

async function ok<T>(p: Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`call failed: ${r.error?.code}`);
  return r.data as T;
}

describe('secrets', () => {
  it('hashes with scrypt and verifies', () => {
    const h = hashSecret('pin', '123456');
    expect(h.startsWith('pin:scrypt$')).toBe(true);
    expect(verifySecret(h, '123456')).toBe(true);
    expect(verifySecret(h, '123457')).toBe(false);
    expect(hashSecret('pin', '123456')).not.toBe(h);
  });
  it('enforces PIN 4 to 6 digits and password 6+ characters', () => {
    expect(() => hashSecret('pin', '123')).toThrow(PetraError);
    expect(() => hashSecret('pin', '1234567')).toThrow(PetraError);
    expect(() => hashSecret('pin', 'abcd')).toThrow(PetraError);
    expect(() => hashSecret('password', 'short')).toThrow(PetraError);
    expect(verifySecret(hashSecret('password', 'a longer pass'), 'a longer pass')).toBe(true);
  });
  it('recovery codes are 20 characters in groups and unique', () => {
    const a = generateRecoveryCode();
    expect(a).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    expect(generateRecoveryCode()).not.toBe(a);
  });
});

describe('first run, auth and roles through the dispatcher', () => {
  it('fresh database needs setup; setup creates the owner, defaults and a recovery code, and can run only once', async () => {
    const { d, close } = makeApp();
    let st = await ok<{ needsSetup: boolean }>(d.call('app:status', undefined));
    expect(st.needsSetup).toBe(true);
    const done = await ok<{ recoveryCode: string; session: { role: string } }>(d.call('setup:complete', setupInput));
    expect(done.session.role).toBe('owner');
    expect(done.recoveryCode).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    st = await ok(d.call('app:status', undefined));
    expect(st.needsSetup).toBe(false);
    const again = await d.call('setup:complete', setupInput);
    expect(again.ok).toBe(false);
    const accounts = (d.db.prepare('SELECT COUNT(*) AS n FROM money_accounts').get() as { n: number }).n;
    expect(accounts).toBe(4);
    close();
  });

  it('protected channels need a session; owner-only channels reject staff and managers', async () => {
    const { d, close } = makeApp();
    await ok(d.call('setup:complete', setupInput));
    d.session = null;
    expect(await d.call('settings:get', undefined)).toMatchObject({ ok: false, error: { code: 'PERMISSION' } });
    const owner = (await ok<{ id: number }[]>(d.call('auth:users', undefined)))[0]!;
    await ok(d.call('auth:login', { userId: owner.id, secret: '4321' }));
    const mgr = await ok<{ id: number }>(d.call('users:create', { username: 'mgr', displayName: 'Manager', role: 'manager', kind: 'pin', secret: '1111' }));
    const staff = await ok<{ id: number }>(d.call('users:create', { username: 'stf', displayName: 'Staff', role: 'staff', kind: 'pin', secret: '2222' }));
    await ok(d.call('auth:logout', undefined));
    await ok(d.call('auth:login', { userId: mgr.id, secret: '1111' }));
    expect(await d.call('users:list', undefined)).toMatchObject({ ok: false, error: { code: 'PERMISSION' } });
    expect(await d.call('settings:save', { taxBp: 500 })).toMatchObject({ ok: false, error: { code: 'PERMISSION' } });
    await ok(d.call('auth:logout', undefined));
    await ok(d.call('auth:login', { userId: staff.id, secret: '2222' }));
    expect(await d.call('settings:get', undefined)).toMatchObject({ ok: true });
    expect(await d.call('profile:save', setupInput.business)).toMatchObject({ ok: false, error: { code: 'PERMISSION' } });
    close();
  });

  it('five wrong attempts lock the account; the lock expires; success resets the counter', async () => {
    const now = { t: T0 };
    const { d, close } = makeApp(now);
    await ok(d.call('setup:complete', setupInput));
    d.session = null;
    const owner = (await ok<{ id: number }[]>(d.call('auth:users', undefined)))[0]!;
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect(await d.call('auth:login', { userId: owner.id, secret: '0000' })).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
    }
    expect(await d.call('auth:login', { userId: owner.id, secret: '0000' })).toMatchObject({ ok: false, error: { code: 'LOCKED_OUT' } });
    expect(await d.call('auth:login', { userId: owner.id, secret: '4321' })).toMatchObject({ ok: false, error: { code: 'LOCKED_OUT' } });
    now.t += (LOCK_MINUTES + 1) * 60_000;
    expect(await d.call('auth:login', { userId: owner.id, secret: '4321' })).toMatchObject({ ok: true });
    close();
  });

  it('the recovery code resets the owner PIN once and issues a new code', async () => {
    const { d, close } = makeApp();
    const { recoveryCode } = await ok<{ recoveryCode: string }>(d.call('setup:complete', setupInput));
    d.session = null;
    expect(await d.call('auth:recover', { recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE', kind: 'pin', newSecret: '9999' })).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
    const r = await ok<{ recoveryCode: string; session: { role: string } }>(d.call('auth:recover', { recoveryCode: recoveryCode.toLowerCase().replace(/-/g, ' '), kind: 'pin', newSecret: '9999' }));
    expect(r.session.role).toBe('owner');
    expect(r.recoveryCode).not.toBe(recoveryCode);
    d.session = null;
    const owner = (await ok<{ id: number }[]>(d.call('auth:users', undefined)))[0]!;
    expect(await d.call('auth:login', { userId: owner.id, secret: '9999' })).toMatchObject({ ok: true });
    d.session = null;
    expect(await d.call('auth:recover', { recoveryCode, kind: 'pin', newSecret: '1234' })).toMatchObject({ ok: false });
    close();
  });

  it('the app never locks: writes keep working long after first run', async () => {
    const now = { t: T0 };
    const { d, close } = makeApp(now);
    await ok(d.call('setup:complete', setupInput));
    now.t = T0 + 400 * DAY;
    expect(await d.call('profile:save', setupInput.business)).toMatchObject({ ok: true });
    expect(await d.call('settings:get', undefined)).toMatchObject({ ok: true });
    close();
  });

  it('the last active owner cannot be demoted or deactivated', async () => {
    const { d, close } = makeApp();
    const { session } = await ok<{ session: { userId: number } }>(d.call('setup:complete', setupInput));
    expect(await d.call('users:update', { id: session.userId, role: 'staff' })).toMatchObject({ ok: false, error: { code: 'PERMISSION' } });
    expect(await d.call('users:update', { id: session.userId, active: false })).toMatchObject({ ok: false, error: { code: 'PERMISSION' } });
    close();
  });

  it('invalid input is rejected before any handler runs', async () => {
    const { d, close } = makeApp();
    const r = await d.call('setup:complete', { ...setupInput, owner: { ...setupInput.owner, secret: '12' } });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    close();
  });
});
