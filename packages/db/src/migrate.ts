import fs from 'node:fs';
import path from 'node:path';
import { PetraError } from '@petra/core';
import { type Db, all, scalar } from './sql';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: number[];
}

/** Reads `NNNN_name.sql` files, sorted by version. */
export function loadMigrations(dir: string): Migration[] {
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const out = files.map((f) => ({
    version: Number(f.slice(0, 4)),
    name: f.slice(5, -4),
    sql: fs.readFileSync(path.join(dir, f), 'utf8')
  }));
  out.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration numbering gap at ${m.version}`);
  });
  return out;
}

export function currentVersion(db: Db): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  return scalar(db, 'SELECT MAX(version) FROM schema_version', [], 0);
}

export function latestVersion(migrations: Migration[]): number {
  return migrations.length === 0 ? 0 : (migrations[migrations.length - 1] as Migration).version;
}

/**
 * Forward-only migrations, each in its own transaction, tracked in `schema_version`.
 * `beforeMigrate` runs once, only when a database that already holds data is about to change
 * (the automatic pre-migration backup). A database from a newer app version is refused.
 */
export function migrate(db: Db, migrations: Migration[], opts: { beforeMigrate?: (from: number, to: number) => void; now?: () => string } = {}): MigrationResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const from = currentVersion(db);
  const latest = latestVersion(migrations);
  if (from > latest) throw new PetraError('DB_NEWER', `database schema ${from} is newer than this app (${latest})`, { found: from, supported: latest });
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, applied: [] };
  if (from > 0) opts.beforeMigrate?.(from, latest);
  const applied: number[] = [];
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version(version, name, applied_at) VALUES(?,?,?)').run(m.version, m.name, now());
      db.exec('COMMIT');
      applied.push(m.version);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return { from, to: latest, applied };
}

export function schemaHistory(db: Db): { version: number; name: string; applied_at: string }[] {
  return all(db, 'SELECT version, name, applied_at FROM schema_version ORDER BY version');
}
