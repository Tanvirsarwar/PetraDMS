import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PetraError, type LoginUser, type Role, type SessionDto, type UserRow } from '@petra/core';
import { type Ctx, tx } from '../ctx';
import { all, get, run } from '../sql';
import { audit } from '../audit';
import { createUser } from '../masters';
import { getRaw, setRaw } from '../settings';

export type SecretKind = 'pin' | 'password';

const N = 16384;
const R = 8;
const P = 1;
export const MAX_ATTEMPTS = 5;
export const LOCK_MINUTES = 5;

/** Validate a PIN (4 to 6 digits) or password (at least 6 characters). */
export function assertSecretShape(kind: SecretKind, secret: string): void {
  if (kind === 'pin' && !/^\d{4,6}$/.test(secret)) throw new PetraError('INVALID_INPUT', 'PIN must be 4 to 6 digits', { field: 'secret' });
  if (kind === 'password' && secret.length < 6) throw new PetraError('INVALID_INPUT', 'password must be at least 6 characters', { field: 'secret' });
}

/** Stored as `kind:scrypt$N$r$p$salt$hash` so the login screen knows whether to show a keypad. */
export function hashSecret(kind: SecretKind, secret: string): string {
  assertSecretShape(kind, secret);
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 32, { N, r: R, p: P });
  return `${kind}:scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function secretKindOf(stored: string | null): SecretKind {
  return stored?.startsWith('password:') ? 'password' : 'pin';
}

export function verifySecret(stored: string | null, secret: string): boolean {
  if (!stored) return false;
  const body = stored.slice(stored.indexOf(':') + 1);
  const parts = body.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(secret, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

interface UserDb {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  pin_hash: string | null;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
}

const toSession = (u: UserDb): SessionDto => ({ userId: u.id, username: u.username, displayName: u.display_name, role: u.role });

export function countUsers(ctx: Ctx): number {
  return get<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM users')?.n ?? 0;
}

export function listLoginUsers(ctx: Ctx): LoginUser[] {
  return all<UserDb>(ctx.db, 'SELECT * FROM users WHERE active = 1 ORDER BY CASE role WHEN \'owner\' THEN 0 WHEN \'manager\' THEN 1 ELSE 2 END, display_name').map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    secretKind: secretKindOf(u.pin_hash),
    lockedUntil: u.locked_until && u.locked_until > ctx.now() ? u.locked_until : null
  }));
}

export function listUsers(ctx: Ctx): UserRow[] {
  const locked = new Map(listLoginUsers(ctx).map((u) => [u.id, u]));
  return all<UserDb>(ctx.db, 'SELECT * FROM users ORDER BY id').map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    secretKind: secretKindOf(u.pin_hash),
    lockedUntil: locked.get(u.id)?.lockedUntil ?? null,
    active: u.active === 1
  }));
}

/** Checks the secret with lockout (5 wrong attempts lock the account for 5 minutes). */
export function login(ctx: Ctx, userId: number, secret: string): SessionDto {
  const u = get<UserDb>(ctx.db, 'SELECT * FROM users WHERE id = ? AND active = 1', userId);
  if (!u) throw new PetraError('AUTH_FAILED', 'unknown user');
  const now = ctx.now();
  if (u.locked_until && u.locked_until > now) {
    throw new PetraError('LOCKED_OUT', 'account locked', { until: u.locked_until, minutes: LOCK_MINUTES });
  }
  if (!verifySecret(u.pin_hash, secret)) {
    const attempts = u.failed_attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const until = new Date(Date.parse(now) + LOCK_MINUTES * 60_000).toISOString();
      run(ctx.db, 'UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?', until, u.id);
      audit({ ...ctx, userId: u.id }, { action: 'auth.lockout', entity: 'users', entityId: u.id });
      throw new PetraError('LOCKED_OUT', 'account locked', { until, minutes: LOCK_MINUTES });
    }
    run(ctx.db, 'UPDATE users SET failed_attempts = ? WHERE id = ?', attempts, u.id);
    throw new PetraError('AUTH_FAILED', 'wrong secret', { remaining: MAX_ATTEMPTS - attempts });
  }
  run(ctx.db, 'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', u.id);
  audit({ ...ctx, userId: u.id }, { action: 'auth.login', entity: 'users', entityId: u.id });
  return toSession(u);
}

/** Manager/owner approval for a staff override: verifies the approver's secret, never opens a session. */
export function approve(ctx: Ctx, userId: number, secret: string): { approverId: number; role: Role } {
  const u = get<UserDb>(ctx.db, 'SELECT * FROM users WHERE id = ? AND active = 1', userId);
  if (!u || u.role === 'staff') throw new PetraError('PERMISSION', 'approver must be a manager or owner');
  const s = login(ctx, userId, secret);
  return { approverId: s.userId, role: s.role };
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 20 characters in five groups of four, e.g. K7QM-2XPA-9TRD-HWE4-N6BC (about 100 bits). */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]!);
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

const normaliseCode = (c: string): string => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

function storeRecovery(ctx: Ctx, code: string): void {
  setRaw(ctx, 'recovery_hash', hashSecret('password', normaliseCode(code).padEnd(6, '0')));
}

export function createOwner(ctx: Ctx, input: { username: string; displayName: string; kind: SecretKind; secret: string }): { id: number; recoveryCode: string } {
  return tx(ctx, () => {
    if (countUsers(ctx) > 0) throw new PetraError('DUPLICATE', 'setup already completed', { what: 'owner' });
    const id = createUser(ctx, { username: input.username, displayName: input.displayName, role: 'owner', pinHash: hashSecret(input.kind, input.secret) });
    const recoveryCode = generateRecoveryCode();
    storeRecovery(ctx, recoveryCode);
    audit({ ...ctx, userId: id }, { action: 'setup.owner', entity: 'users', entityId: id });
    return { id, recoveryCode };
  });
}

export function addUser(ctx: Ctx, input: { username: string; displayName: string; role: Role; kind: SecretKind; secret: string }): number {
  return tx(ctx, () => {
    const id = createUser(ctx, { username: input.username, displayName: input.displayName, role: input.role, pinHash: hashSecret(input.kind, input.secret) });
    audit(ctx, { action: 'users.create', entity: 'users', entityId: id, after: { role: input.role } });
    return id;
  });
}

export function updateUser(ctx: Ctx, input: { id: number; displayName?: string; role?: Role; active?: boolean; reset?: { kind: SecretKind; secret: string } }): void {
  tx(ctx, () => {
    const u = get<UserDb>(ctx.db, 'SELECT * FROM users WHERE id = ?', input.id);
    if (!u) throw new PetraError('NOT_FOUND', 'user not found', { what: 'user', id: input.id });
    const owners = get<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1")?.n ?? 0;
    const losesOwner = u.role === 'owner' && u.active === 1 && ((input.role && input.role !== 'owner') || input.active === false);
    if (losesOwner && owners <= 1) throw new PetraError('PERMISSION', 'at least one active owner is required');
    if (input.displayName !== undefined) run(ctx.db, 'UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?', input.displayName, ctx.now(), u.id);
    if (input.role !== undefined) run(ctx.db, 'UPDATE users SET role = ?, updated_at = ? WHERE id = ?', input.role, ctx.now(), u.id);
    if (input.active !== undefined) run(ctx.db, 'UPDATE users SET active = ?, updated_at = ? WHERE id = ?', input.active ? 1 : 0, ctx.now(), u.id);
    if (input.reset) run(ctx.db, 'UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', hashSecret(input.reset.kind, input.reset.secret), ctx.now(), u.id);
    audit(ctx, { action: 'users.update', entity: 'users', entityId: u.id, after: { role: input.role ?? null, active: input.active ?? null, reset: !!input.reset } });
  });
}

export function changeSecret(ctx: Ctx, userId: number, oldSecret: string, kind: SecretKind, newSecret: string): void {
  const u = get<UserDb>(ctx.db, 'SELECT * FROM users WHERE id = ? AND active = 1', userId);
  if (!u || !verifySecret(u.pin_hash, oldSecret)) throw new PetraError('AUTH_FAILED', 'wrong secret');
  run(ctx.db, 'UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?', hashSecret(kind, newSecret), ctx.now(), userId);
  audit({ ...ctx, userId }, { action: 'auth.change_secret', entity: 'users', entityId: userId });
}

/** Owner recovery with the printed code. Resets the first active owner's secret and issues a new code. */
export function recoverOwner(ctx: Ctx, code: string, kind: SecretKind, newSecret: string): { recoveryCode: string; session: SessionDto } {
  return tx(ctx, () => {
    const stored = getRaw(ctx.db, 'recovery_hash');
    if (!stored || !verifySecret(stored, normaliseCode(code).padEnd(6, '0'))) throw new PetraError('AUTH_FAILED', 'wrong recovery code');
    const owner = get<UserDb>(ctx.db, "SELECT * FROM users WHERE role = 'owner' AND active = 1 ORDER BY id LIMIT 1");
    if (!owner) throw new PetraError('NOT_FOUND', 'owner not found', { what: 'owner' });
    run(ctx.db, 'UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', hashSecret(kind, newSecret), ctx.now(), owner.id);
    const recoveryCode = generateRecoveryCode();
    storeRecovery(ctx, recoveryCode);
    audit({ ...ctx, userId: owner.id }, { action: 'auth.recover', entity: 'users', entityId: owner.id });
    return { recoveryCode, session: toSession(owner) };
  });
}

export function sessionFor(ctx: Ctx, userId: number): SessionDto | null {
  const u = get<UserDb>(ctx.db, 'SELECT * FROM users WHERE id = ? AND active = 1', userId);
  return u ? toSession(u) : null;
}
