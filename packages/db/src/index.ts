import { DatabaseSync } from 'node:sqlite';
import { type Db, all, clearStatementCache } from './sql';

export type { Db } from './sql';
export * from './sql';
export * from './ctx';
export * from './settings';
export * from './audit';
export * from './migrate';
export * from './ledger';
export * from './stock';
export * from './reverse';
export * from './masters';
export * from './sales';
export * from './purchases';
export * from './money';
export * from './adjustments';
export * from './dayclose';
export * from './integrity';
export * from './app/index';

export interface HealthInfo {
  sqliteVersion: string;
  journalMode: string;
  synchronous: number;
  foreignKeys: number;
  integrity: string;
}

/**
 * Opens a database with the pragmas required by the architecture plan (section 3):
 * WAL journal, synchronous=FULL, foreign keys on. In-memory databases skip WAL.
 */
export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

export function closeDatabase(db: Db): void {
  clearStatementCache(db);
  db.close();
}

export function healthInfo(db: Db): HealthInfo {
  const one = (sql: string): Record<string, unknown> => (all<Record<string, unknown>>(db, sql)[0] ?? {});
  return {
    sqliteVersion: String(one('SELECT sqlite_version() AS v').v),
    journalMode: String(one('PRAGMA journal_mode').journal_mode),
    synchronous: Number(one('PRAGMA synchronous').synchronous),
    foreignKeys: Number(one('PRAGMA foreign_keys').foreign_keys),
    integrity: String(one('PRAGMA integrity_check').integrity_check)
  };
}
export * from './perfSeed';
export * from './applog';
export * from './demo';
