import type { IpcChannel, IpcInput, IpcOutput, Role } from '@petra/core';
import fs from 'node:fs';
import path from 'node:path';
import { createBareDb } from './testkit';
import { REPO_MIGRATIONS_DIR } from './migrationsDir';
import { closeDatabase, openDatabase } from './index';
import { loadMigrations, migrate } from './migrate';
import { swapInDatabase } from './app/backup';
import { registerSafetyServices } from './app/safetyServices';
import { registerDataServices } from './app/dataServices';
import { Dispatcher, type Host } from './app/dispatcher';
import { registerCoreServices } from './app/coreServices';
import { registerCatalogServices } from './app/catalogServices';
import { registerSalesServices } from './app/salesServices';
import { registerMoneyServices } from './app/moneyServices';
import { registerReportServices } from './app/reportServices';
import { registerToolServices } from './app/toolServices';
import { checkIntegrity, formatViolations } from './integrity';

export const DAY = 86_400_000;
export const T0 = Date.parse('2026-10-01T05:00:00.000Z');

export const setupInput = {
  language: 'bn' as const,
  business: { name: 'Rahim Traders', nameBn: 'রহিম ট্রেডার্স', address: 'Sylhet', phone: '01712345678', email: '', taxNo: '', footerNote: '' },
  owner: { displayName: 'Rahim', username: 'rahim', kind: 'pin' as const, secret: '4321' },
  uiMode: 'full' as const
};

/** `dataDir` makes the app file-backed (data/petra.db inside it) so backup, restore and recovery run on real files. */
export function makeApp(nowRef: { t: number } = { t: T0 }, opts: { dataDir?: string } = {}) {
  let db: ReturnType<typeof openDatabase>;
  let close: () => void;
  if (opts.dataDir) {
    fs.mkdirSync(path.join(opts.dataDir, 'data'), { recursive: true });
    db = openDatabase(path.join(opts.dataDir, 'data', 'petra.db'));
    migrate(db, loadMigrations(REPO_MIGRATIONS_DIR));
    close = () => closeDatabase(dRef.db);
  } else {
    const b = createBareDb();
    db = b.db;
    close = b.close;
  }
  const dRef = {} as { db: typeof db };
  const pick: { file: string | null } = { file: null };
  const printed: string[] = [];
  const compact: boolean[] = [];
  const pdfs: string[] = [];
  const host: Host = {
    appVersion: '1.0.0',
    dataDir: opts.dataDir ?? 'C:\\PetraDMS',
    health: () => ({ appVersion: '1.0.0', electronVersion: '', nodeVersion: '', sqliteVersion: '', journalMode: 'wal', synchronous: 2, foreignKeys: 1, integrity: 'ok', packaged: false, dataDir: '' }),
    pickDataDir: async () => null,
    applyDataDir: async () => undefined,
    recommendedDataDir: () => 'D:\\PetraData',
    fontCss: () => '',
    printHtml: async (html) => { printed.push(html); },
    pdfHtml: async (html, o) => { printed.push(html); pdfs.push(o.file); },
    reveal: () => undefined,
    setCompact: async (on) => { compact.push(on); },
    pickBackupFile: async () => pick.file,
    restoreDatabase: async (file) => {
      if (!opts.dataDir) throw new Error('restore needs a file-backed test app');
      closeDatabase(d.db);
      swapInDatabase(opts.dataDir, file);
      const nd = openDatabase(path.join(opts.dataDir, 'data', 'petra.db'));
      migrate(nd, loadMigrations(REPO_MIGRATIONS_DIR));
      d.swapDb(nd);
    },
    resetDatabase: async () => {
      if (!opts.dataDir) throw new Error('reset needs a file-backed test app');
      closeDatabase(d.db);
      const file = path.join(opts.dataDir, 'data', 'petra.db');
      for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
      const nd = openDatabase(file);
      migrate(nd, loadMigrations(REPO_MIGRATIONS_DIR));
      d.swapDb(nd);
    }
  };
  const d = new Dispatcher(db, host, () => new Date(nowRef.t).toISOString());
  registerCoreServices(d);
  registerCatalogServices(d);
  registerSalesServices(d);
  registerMoneyServices(d);
  registerReportServices(d);
  registerToolServices(d);
  registerSafetyServices(d);
  registerDataServices(d);
  Object.defineProperty(dRef, 'db', { get: () => d.db });
  return { d, db, close, nowRef, printed, pdfs, compact, pick };
}

export type App = ReturnType<typeof makeApp>;

/** Calls a channel and returns its data, throwing with the error code when it fails. */
export async function ok<C extends IpcChannel>(d: Dispatcher, channel: C, input?: IpcInput<C>): Promise<IpcOutput<C>> {
  const r = await d.call(channel, input);
  if (!r.ok) throw new Error(`${channel} failed: ${r.error.code} ${r.error.message}`);
  return r.data as IpcOutput<C>;
}

export async function fail(d: Dispatcher, channel: IpcChannel, input?: unknown): Promise<string> {
  const r = await d.call(channel, input);
  if (r.ok) throw new Error(`${channel} should have failed`);
  return r.error.code;
}

/** Runs first-run setup (Owner signed in) and creates a manager and a staff user. Returns their ids. */
export async function setupWithUsers(d: Dispatcher): Promise<{ owner: number; manager: number; staff: number }> {
  const done = await ok(d, 'setup:complete', setupInput);
  const manager = await ok(d, 'users:create', { username: 'mgr', displayName: 'Manager', role: 'manager', kind: 'pin', secret: '1111' });
  const staff = await ok(d, 'users:create', { username: 'stf', displayName: 'Staff', role: 'staff', kind: 'pin', secret: '2222' });
  return { owner: done.session.userId, manager: manager.id, staff: staff.id };
}

export async function signInAs(d: Dispatcher, userId: number, role: Role): Promise<void> {
  await ok(d, 'auth:logout');
  await ok(d, 'auth:login', { userId, secret: role === 'owner' ? '4321' : role === 'manager' ? '1111' : '2222' });
}

/** Asserts all ten integrity invariants hold, printing violations when they do not. */
export function expectIntegrity(app: App): void {
  const v = checkIntegrity(app.d.db);
  if (v.length > 0) throw new Error(`integrity violations:\n${formatViolations(v)}`);
}
