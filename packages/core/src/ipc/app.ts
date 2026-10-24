import { z } from 'zod';
import type { Role, Settings, BusinessProfile } from '../settings';
import { businessProfileSchema, settingsSchema } from '../settings';
import { ch, none } from './define';

export const healthSchema = z.object({
  appVersion: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  sqliteVersion: z.string(),
  journalMode: z.string(),
  synchronous: z.number(),
  foreignKeys: z.number(),
  integrity: z.string(),
  packaged: z.boolean(),
  dataDir: z.string()
});
export type Health = z.infer<typeof healthSchema>;

export interface SessionDto {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface AppStatus {
  appVersion: string;
  needsSetup: boolean;
  session: SessionDto | null;
  settings: Settings;
  profile: BusinessProfile;
  businessDate: string;
  dataDir: string;
  /** Set when the app restored a backup by itself at start-up (the data file was damaged). */
  recovery: import('./safety').RecoveryNotice | null;
  /** True while the shop holds sample data from demo mode. */
  demo: boolean;
  /** The trader's logo as a data URL, or null (a monogram is shown instead). */
  logo: string | null;
}

export interface LoginUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  secretKind: 'pin' | 'password';
  lockedUntil: string | null;
}

export interface UserRow extends LoginUser {
  active: boolean;
}

const secretKind = z.enum(['pin', 'password']);
const secret = z.string().min(4).max(128);
const username = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/);

export const appChannels = {
  'app:health': ch<Health>()(none, { access: 'public' }),
  'app:status': ch<AppStatus>()(none, { access: 'public' }),

  'setup:dataDirInfo': ch<{ current: string; recommended: string; fresh: boolean }>()(none, { access: 'public' }),
  'setup:chooseDataDir': ch<{ path: string | null }>()(none, { access: 'public' }),
  'setup:applyDataDir': ch<{ path: string }>()(z.object({ path: z.string().min(2).max(500) }), { access: 'public', write: true }),
  'setup:complete': ch<{ recoveryCode: string; session: SessionDto }>()(
    z.object({
      language: z.enum(['bn', 'en']),
      business: businessProfileSchema,
      owner: z.object({ displayName: z.string().trim().min(1).max(80), username, kind: secretKind, secret }),
      uiMode: z.enum(['simple', 'full'])
    }),
    { access: 'public', write: true }
  ),

  /** The trader's logo (PNG, JPEG or WebP data URL, at most 256 KB); null removes it. */
  'profile:logo': ch<{ logo: string | null }>()(z.object({ dataUrl: z.string().max(400_000).nullable() }), { access: 'owner', write: true }),
  'auth:users': ch<LoginUser[]>()(none, { access: 'public' }),
  'auth:login': ch<SessionDto>()(z.object({ userId: z.number().int().positive(), secret: z.string().min(1).max(128) }), { access: 'public' }),
  'auth:logout': ch()(none, { access: 'public' }),
  'auth:changeSecret': ch()(z.object({ oldSecret: z.string().min(1).max(128), kind: secretKind, newSecret: secret })),
  'auth:recover': ch<{ recoveryCode: string; session: SessionDto }>()(z.object({ recoveryCode: z.string().min(8).max(64), kind: secretKind, newSecret: secret }), { access: 'public' }),
  /** A manager or owner approves a staff override (min price, credit limit) by entering their secret. */
  'auth:approve': ch<{ approverId: number; role: Role; token: string }>()(z.object({ userId: z.number().int().positive(), secret: z.string().min(1).max(128) })),

  'users:list': ch<UserRow[]>()(none, { access: 'owner' }),
  'users:create': ch<{ id: number }>()(z.object({ username, displayName: z.string().trim().min(1).max(80), role: z.enum(['owner', 'manager', 'staff']), kind: secretKind, secret }), { access: 'owner', write: true }),
  'users:update': ch()(
    z.object({
      id: z.number().int().positive(),
      displayName: z.string().trim().min(1).max(80).optional(),
      role: z.enum(['owner', 'manager', 'staff']).optional(),
      active: z.boolean().optional(),
      reset: z.object({ kind: secretKind, secret }).optional()
    }),
    { access: 'owner', write: true }
  ),

  'settings:get': ch<Settings>()(none),
  'settings:save': ch<Settings>()(settingsSchema.partial(), { access: 'owner', write: true }),
  'profile:get': ch<BusinessProfile>()(none),
  'profile:save': ch<BusinessProfile>()(businessProfileSchema, { access: 'owner', write: true })
};
