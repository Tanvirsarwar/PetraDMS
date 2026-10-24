import { z } from 'zod';
import { ch, dateStr, none } from './define';

export type BackupKindDto = 'manual' | 'auto' | 'close' | 'pre-migrate' | 'pre-restore' | 'pre-reset';

export interface BackupInfo {
  name: string;
  path: string;
  where: 'primary' | 'second' | 'file';
  bytes: number;
  createdAt: string;
  kind: BackupKindDto;
  /** False when the file could not be read (cut short or damaged). */
  ok: boolean;
  app: string;
  schema: number;
  business: string;
  counts: { products: number; customers: number; sales: number; purchases: number };
}

export interface BackupList {
  dir: string;
  dir2: string;
  dir2Ok: boolean;
  items: BackupInfo[];
  last: BackupInfo | null;
}

export interface AuditRow {
  id: number;
  at: string;
  userName: string;
  action: string;
  entity: string;
  entityId: number | null;
  reason: string;
  before: string | null;
  after: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  actions: string[];
  users: { id: number; name: string }[];
}

export interface RecoveryNotice {
  at: string;
  backupAt: string;
  backupKind: string;
}

export const auditFilter = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  userId: z.number().int().positive().optional(),
  action: z.string().max(80).optional(),
  search: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0)
});

export const safetyChannels = {
  'backup:list': ch<BackupList>()(none, { access: 'owner' }),
  'backup:create': ch<{ item: BackupInfo; warning: string | null }>()(none, { access: 'owner' }),
  'backup:pickFile': ch<{ path: string | null }>()(none, { access: 'owner' }),
  'backup:pickFolder': ch<{ path: string | null }>()(none, { access: 'owner' }),
  'backup:inspect': ch<BackupInfo>()(z.object({ path: z.string().min(1).max(1000) }), { access: 'owner' }),
  'backup:restore': ch<{ restored: BackupInfo; safety: BackupInfo | null }>()(z.object({ path: z.string().min(1).max(1000), confirm: z.literal('RESTORE') }), { access: 'owner' }),
  'backup:delete': ch()(z.object({ path: z.string().min(1).max(1000) }), { access: 'owner' }),
  /** Deletes the whole shop and starts again at the setup wizard. `backup` keeps a copy first; `deleteOldFiles` also clears old backups, exports and saved invoices. */
  'shop:startFresh': ch<{ backup: BackupInfo | null; deletedFiles: number }>()(
    z.object({ confirm: z.literal('DELETE'), backup: z.boolean(), deleteOldFiles: z.boolean().default(false) }).refine((v) => !(v.backup && v.deleteOldFiles), { message: 'cannot keep a backup and delete old backups at once', path: ['deleteOldFiles'] }),
    { access: 'owner' }
  ),
  'audit:list': ch<AuditPage>()(auditFilter, { access: 'owner' }),
  'diag:export': ch<{ path: string }>()(none, { access: 'owner' }),
  'recovery:dismiss': ch()(none)
};
