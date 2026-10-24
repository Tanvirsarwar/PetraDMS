import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PetraError } from '@petra/core';
import type { Db } from '../sql';
import { makeZip } from './exportFiles';
import { readZipFile } from './zipRead';

export const BACKUP_EXT = '.petrabak';
export type BackupKind = 'manual' | 'auto' | 'close' | 'pre-migrate' | 'pre-restore' | 'pre-reset';
const ROUTINE: BackupKind[] = ['manual', 'auto', 'close'];

export interface BackupManifest {
  format: 1;
  app: string;
  schema: number;
  createdAt: string;
  kind: BackupKind;
  business: string;
  bytes: number;
  sha256: string;
  counts: { products: number; customers: number; sales: number; purchases: number };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** Local time stamp used in file names, so a person sees the shop's clock. */
export function stampOf(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function backupFileName(d: Date, kind: BackupKind): string {
  return `PetraDMS-${stampOf(d)}-${kind}${BACKUP_EXT}`;
}

const NAME_RE = /^PetraDMS-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(manual|auto|close|pre-migrate|pre-restore|pre-reset)\.petrabak$/;
export function parseBackupName(name: string): { at: Date; kind: BackupKind } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  return { at: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])), kind: m[7] as BackupKind };
}

const sqlQuote = (p: string) => `'${p.replace(/'/g, "''")}'`;

function count(db: DatabaseSync, table: string): number {
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  } catch {
    return 0;
  }
}

/**
 * A consistent copy of the live database (VACUUM INTO), checked with integrity_check on the copy, wrapped in one
 * file with a manifest (app and schema version, SHA-256). The file appears under its final name only when complete.
 */
export function createBackup(db: Db, dir: string, o: { kind: BackupKind; appVersion: string; now: Date }): { file: string; manifest: BackupManifest } {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomUUID()}.db`);
  try {
    db.exec(`VACUUM INTO ${sqlQuote(tmp)}`);
    const copy = new DatabaseSync(tmp, { readOnly: true });
    let manifest: Omit<BackupManifest, 'bytes' | 'sha256'>;
    try {
      const integrity = String((copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check);
      if (integrity !== 'ok') throw new PetraError('BACKUP_FAILED', `the backup copy failed its check: ${integrity}`, { why: 'integrity' });
      let schema = 0;
      try {
        schema = Number((copy.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }).v ?? 0);
      } catch { /* empty database */ }
      let business = '';
      try {
        business = String((copy.prepare('SELECT name FROM business_profile WHERE id = 1').get() as { name: string } | undefined)?.name ?? '');
      } catch { /* not set up yet */ }
      manifest = {
        format: 1, app: o.appVersion, schema, createdAt: o.now.toISOString(), kind: o.kind, business,
        counts: { products: count(copy, 'products'), customers: count(copy, 'customers'), sales: count(copy, 'sales'), purchases: count(copy, 'purchases') }
      };
    } finally {
      copy.close();
    }
    const bytes = fs.readFileSync(tmp);
    const full: BackupManifest = { ...manifest, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const zip = makeZip([{ name: 'manifest.json', data: JSON.stringify(full, null, 2), date: o.now }, { name: 'petra.db', data: bytes, store: true, date: o.now }]);
    // Two backups in the same second get distinct names.
    let when = o.now;
    let file = path.join(dir, backupFileName(when, o.kind));
    while (fs.existsSync(file)) {
      when = new Date(when.getTime() + 1000);
      file = path.join(dir, backupFileName(when, o.kind));
    }
    const part = `${file}.part`;
    const fd = fs.openSync(part, 'w');
    try {
      fs.writeSync(fd, zip);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(part, file);
    return { file, manifest: full };
  } catch (e) {
    if (e instanceof PetraError) throw e;
    throw new PetraError('BACKUP_FAILED', e instanceof Error ? e.message : String(e), { why: 'io' });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function readManifest(file: string): BackupManifest {
  const m = JSON.parse(readZipFile(file, ['manifest.json']).files.get('manifest.json')!.toString('utf8')) as Partial<BackupManifest>;
  if (m.format !== 1 || typeof m.schema !== 'number' || typeof m.sha256 !== 'string' || typeof m.createdAt !== 'string') {
    throw new PetraError('BACKUP_INVALID', 'not a PetraDMS backup', { why: 'manifest' });
  }
  return { counts: { products: 0, customers: 0, sales: 0, purchases: 0 }, business: '', bytes: 0, app: '', kind: 'manual', ...m } as BackupManifest;
}

/**
 * Validates a backup before anything is touched: readable, SHA-256 matches, not from a newer app, and the
 * database inside passes integrity_check. The database is written to `workDir` and its path returned.
 */
export function extractBackup(file: string, workDir: string, supportedSchema: number): { manifest: BackupManifest; dbFile: string } {
  if (!fs.existsSync(file)) throw new PetraError('NOT_FOUND', 'backup file not found', { what: 'backup' });
  const manifest = readManifest(file);
  if (manifest.schema > supportedSchema) throw new PetraError('DB_NEWER', 'backup is from a newer version of PetraDMS', { found: manifest.schema, supported: supportedSchema });
  const bytes = readZipFile(file, ['petra.db']).files.get('petra.db')!;
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new PetraError('BACKUP_INVALID', 'backup does not match its checksum', { why: 'sha256' });
  fs.mkdirSync(workDir, { recursive: true });
  const dbFile = path.join(workDir, `restore-${randomUUID()}.db`);
  fs.writeFileSync(dbFile, bytes);
  try {
    const t = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const r = String((t.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check);
      if (r !== 'ok') throw new PetraError('BACKUP_INVALID', `database in the backup is damaged: ${r}`, { why: 'integrity' });
    } finally {
      t.close();
    }
  } catch (e) {
    fs.rmSync(dbFile, { force: true });
    if (e instanceof PetraError) throw e;
    throw new PetraError('BACKUP_INVALID', 'database in the backup cannot be opened', { why: 'open' });
  }
  return { manifest, dbFile };
}

export interface BackupEntry {
  name: string;
  path: string;
  dir: string;
  bytes: number;
  at: Date;
  kind: BackupKind;
  manifest: BackupManifest | null;
}

/** Backups in the given folders, newest first. An unreadable file is listed with `manifest: null` so it can be seen and removed. */
export function listBackups(dirs: string[]): BackupEntry[] {
  const out: BackupEntry[] = [];
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const parsed = parseBackupName(name);
      if (!parsed) continue;
      const p = path.join(dir, name);
      let manifest: BackupManifest | null = null;
      try {
        manifest = readManifest(p);
      } catch { /* damaged */ }
      out.push({ name, path: p, dir, bytes: fs.statSync(p).size, at: manifest ? new Date(manifest.createdAt) : parsed.at, kind: parsed.kind, manifest });
    }
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime() || b.name.localeCompare(a.name));
}

const dayNo = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

/**
 * Retention (plan 12.3): the newest backup of each of the last 14 days, of each of the 8 weeks before that,
 * and of each of the last 12 months; the six newest routine backups whatever their age (so a working day keeps
 * its intraday copies); and the five newest safety copies (before a migration or a restore).
 * Returns the names to delete. Never deletes the newest routine backup.
 */
export function pruneBackups(files: { name: string; at: Date; kind: BackupKind }[], now: Date): string[] {
  const routine = files.filter((f) => ROUTINE.includes(f.kind)).sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set<string>();
  const today = dayNo(now);
  const seenDay = new Set<number>();
  const seenWeek = new Set<number>();
  const seenMonth = new Set<number>();
  routine.forEach((f, i) => {
    if (i < 6) keep.add(f.name);
    const ago = today - dayNo(f.at);
    if (ago < 0) {
      keep.add(f.name); // a clock that was ahead: keep rather than guess
      return;
    }
    if (ago < 14 && !seenDay.has(ago)) { seenDay.add(ago); keep.add(f.name); }
    const week = Math.floor(ago / 7);
    if (week < 8 && !seenWeek.has(week)) { seenWeek.add(week); keep.add(f.name); }
    const monthsAgo = (now.getFullYear() - f.at.getFullYear()) * 12 + now.getMonth() - f.at.getMonth();
    if (monthsAgo >= 0 && monthsAgo < 12 && !seenMonth.has(monthsAgo)) { seenMonth.add(monthsAgo); keep.add(f.name); }
  });
  files.filter((f) => !ROUTINE.includes(f.kind)).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 5).forEach((f) => keep.add(f.name));
  return files.filter((f) => !keep.has(f.name)).map((f) => f.name);
}

export function pruneDir(dir: string, now: Date): string[] {
  const entries = listBackups([dir]).filter((e) => e.manifest !== null);
  const gone = pruneBackups(entries.map((e) => ({ name: e.name, at: e.at, kind: e.kind })), now);
  for (const n of gone) fs.rmSync(path.join(dir, n), { force: true });
  // leftovers of an interrupted backup
  for (const n of fs.readdirSync(dir)) if (n.startsWith('.tmp-') || n.endsWith('.part')) fs.rmSync(path.join(dir, n), { force: true });
  return gone;
}

/** Replaces the database file with a verified copy. The caller has closed the old database. */
export function swapInDatabase(dataRoot: string, extractedDb: string): void {
  const target = path.join(dataRoot, 'data', 'petra.db');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(target + ext, { force: true });
  fs.copyFileSync(extractedDb, target);
}

export type RecoveryResult =
  | { state: 'fresh' | 'ok' }
  | { state: 'recovered'; manifest: BackupManifest; backupFile: string; corruptFile: string };

/**
 * Start-up check (plan 12.2): if the database fails `PRAGMA integrity_check`, the newest backup that verifies is
 * restored and the damaged file is kept next to it. With no usable backup the error is raised so the app can say so.
 */
export function recoverIfCorrupt(dataRoot: string, backupDirs: string[], supportedSchema: number, now: Date): RecoveryResult {
  const dbFile = path.join(dataRoot, 'data', 'petra.db');
  if (!fs.existsSync(dbFile)) return { state: 'fresh' };
  let ok = false;
  try {
    const t = new DatabaseSync(dbFile);
    try {
      ok = String((t.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check) === 'ok';
    } finally {
      t.close();
    }
  } catch {
    ok = false;
  }
  if (ok) return { state: 'ok' };
  const work = path.join(dataRoot, 'backups', '.recover');
  for (const b of listBackups(backupDirs)) {
    if (!b.manifest) continue;
    try {
      const x = extractBackup(b.path, work, supportedSchema);
      const corruptFile = path.join(dataRoot, 'data', `petra.db.corrupt-${stampOf(now)}`);
      for (const ext of ['', '-wal', '-shm']) {
        if (fs.existsSync(dbFile + ext)) fs.renameSync(dbFile + ext, ext === '' ? corruptFile : `${corruptFile}${ext}`);
      }
      fs.copyFileSync(x.dbFile, dbFile);
      fs.rmSync(work, { recursive: true, force: true });
      return { state: 'recovered', manifest: x.manifest, backupFile: b.path, corruptFile };
    } catch {
      /* try the next one */
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
  throw new PetraError('DB_CORRUPT', 'the database is damaged and no usable backup was found', { dir: path.join(dataRoot, 'backups') });
}
