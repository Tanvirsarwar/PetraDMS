import { type Ctx, makeCtx } from './ctx';
import { REPO_MIGRATIONS_DIR } from './migrationsDir';
import { loadMigrations, migrate } from './migrate';
import { closeDatabase, openDatabase } from './index';
import { createUser, seedDefaults } from './masters';
import { setRaw } from './settings';

/** A deterministic clock: every call returns a later millisecond, so created_at is strictly increasing. */
export function fakeClock(startIso = '2026-01-01T00:00:00.000Z'): () => string {
  let t = Date.parse(startIso);
  return () => {
    t += 1;
    return new Date(t).toISOString();
  };
}

export interface TestWorld {
  ctx: Ctx;
  ownerId: number;
  managerId: number;
  staffId: number;
  close: () => void;
}

/** In-memory migrated database with default accounts and three users. */
export function createTestWorld(opts: { file?: string } = {}): TestWorld {
  const db = openDatabase(opts.file ?? ':memory:');
  migrate(db, loadMigrations(REPO_MIGRATIONS_DIR));
  const ctx = makeCtx(db, null, fakeClock());
  seedDefaults(ctx, '2026-01-01');
  const ownerId = createUser(ctx, { username: 'owner', displayName: 'Owner', role: 'owner' });
  const managerId = createUser(ctx, { username: 'manager', displayName: 'Manager', role: 'manager' });
  const staffId = createUser(ctx, { username: 'staff', displayName: 'Staff', role: 'staff' });
  ctx.userId = ownerId;
  return { ctx, ownerId, managerId, staffId, close: () => closeDatabase(db) };
}

export function setSetting(ctx: Ctx, key: string, value: string): void {
  setRaw(ctx, key, value);
}

/** Migrated empty database (no users, no defaults), for first-run and service tests. */
export function createBareDb(): { db: ReturnType<typeof openDatabase>; close: () => void } {
  const db = openDatabase(':memory:');
  migrate(db, loadMigrations(REPO_MIGRATIONS_DIR));
  return { db, close: () => closeDatabase(db) };
}
