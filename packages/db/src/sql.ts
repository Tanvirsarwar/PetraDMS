import type { DatabaseSync, StatementSync, SQLInputValue } from 'node:sqlite';

export type Db = DatabaseSync;
export type Param = SQLInputValue;

const cache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

function stmt(db: DatabaseSync, sql: string): StatementSync {
  let m = cache.get(db);
  if (!m) {
    m = new Map();
    cache.set(db, m);
  }
  let s = m.get(sql);
  if (!s) {
    s = db.prepare(sql);
    m.set(sql, s);
  }
  return s;
}

/** First row or undefined. */
export function get<T = Record<string, unknown>>(db: DatabaseSync, sql: string, ...params: Param[]): T | undefined {
  return stmt(db, sql).get(...params) as T | undefined;
}

export function all<T = Record<string, unknown>>(db: DatabaseSync, sql: string, ...params: Param[]): T[] {
  return stmt(db, sql).all(...params) as T[];
}

export function run(db: DatabaseSync, sql: string, ...params: Param[]): { changes: number; id: number } {
  const r = stmt(db, sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

/** Single scalar (first column of first row), or `fallback`. */
export function scalar<T = number>(db: DatabaseSync, sql: string, params: Param[] = [], fallback: T = 0 as T): T {
  const row = stmt(db, sql).get(...params) as Record<string, unknown> | undefined;
  if (!row) return fallback;
  const v = Object.values(row)[0];
  return (v === null || v === undefined ? fallback : v) as T;
}

/** Drops cached statements for a database (call before closing or after schema changes). */
export function clearStatementCache(db: DatabaseSync): void {
  cache.delete(db);
}
