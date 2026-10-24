import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PetraError, type AuditPage, type BackupInfo, type BackupList, type RecoveryNotice } from '@petra/core';
import { all, run, scalar } from '../sql';
import type { Ctx } from '../ctx';
import { makeCtx } from '../ctx';
import { audit } from '../audit';
import { logApp } from '../applog';
import { loadSettings, getRaw, setRaw } from '../settings';
import { currentVersion, schemaHistory } from '../migrate';
import { createBackup, extractBackup, listBackups, pruneDir, readManifest, stampOf, type BackupEntry, type BackupKind, type BackupManifest } from './backup';
import { makeZip } from './exportFiles';
import type { Dispatcher, Host } from './dispatcher';

export const backupsDir = (host: Host): string => path.join(host.dataDir, 'backups');

export function toInfo(e: BackupEntry, where: BackupInfo['where']): BackupInfo {
  const m = e.manifest;
  return {
    name: e.name, path: e.path, where, bytes: e.bytes, createdAt: e.at.toISOString(), kind: e.kind, ok: m !== null, app: m?.app ?? '', schema: m?.schema ?? 0,
    business: m?.business ?? '', counts: m?.counts ?? { products: 0, customers: 0, sales: 0, purchases: 0 }
  };
}

/** Folders to search for backups when the database itself cannot be read: the second folder is remembered in a small file next to it. */
export function backupDirsFile(dataRoot: string): string {
  return path.join(dataRoot, 'backup-dirs.json');
}

export function rememberSecondDir(dataRoot: string, dir2: string): void {
  try {
    fs.writeFileSync(backupDirsFile(dataRoot), JSON.stringify({ second: dir2 }));
  } catch { /* best effort */ }
}

export function knownBackupDirs(dataRoot: string): string[] {
  const dirs = [path.join(dataRoot, 'backups')];
  try {
    const j = JSON.parse(fs.readFileSync(backupDirsFile(dataRoot), 'utf8')) as { second?: string };
    if (j.second) dirs.push(j.second);
  } catch { /* none */ }
  return dirs;
}

/**
 * Makes one backup into the main folder, copies it to the second folder if one is set, prunes both, and records the
 * outcome. A failure of the second copy is a warning (the main backup still exists); a failure of the main one throws.
 */
export function runBackup(ctx: Ctx, host: Host, kind: BackupKind): { item: BackupInfo; warning: string | null } {
  const now = new Date(ctx.now());
  const dir = backupsDir(host);
  const s = loadSettings(ctx.db);
  let made: { file: string; manifest: BackupManifest };
  try {
    made = createBackup(ctx.db, dir, { kind, appVersion: host.appVersion, now });
  } catch (e) {
    run(ctx.db, 'INSERT INTO backup_log(at, kind, path, bytes, sha256, ok, note) VALUES(?,?,?,?,?,0,?)', ctx.now(), kind, dir, 0, '', e instanceof Error ? e.message : String(e));
    logApp(ctx, 'error', 'backup failed', e instanceof Error ? e.message : String(e));
    throw e;
  }
  run(ctx.db, 'INSERT INTO backup_log(at, kind, path, bytes, sha256, ok, note) VALUES(?,?,?,?,?,1,?)', ctx.now(), kind, made.file, made.manifest.bytes, made.manifest.sha256, '');
  let warning: string | null = null;
  if (s.secondBackupDir.trim()) {
    try {
      fs.mkdirSync(s.secondBackupDir, { recursive: true });
      const copy = path.join(s.secondBackupDir, path.basename(made.file));
      fs.copyFileSync(made.file, `${copy}.part`);
      fs.renameSync(`${copy}.part`, copy);
      run(ctx.db, 'INSERT INTO backup_log(at, kind, path, bytes, sha256, ok, note) VALUES(?,?,?,?,?,1,?)', ctx.now(), kind, copy, made.manifest.bytes, made.manifest.sha256, 'second folder');
      pruneDir(s.secondBackupDir, now);
    } catch (e) {
      warning = e instanceof Error ? e.message : String(e);
      run(ctx.db, 'INSERT INTO backup_log(at, kind, path, bytes, sha256, ok, note) VALUES(?,?,?,?,?,0,?)', ctx.now(), kind, s.secondBackupDir, 0, '', `second folder: ${warning}`);
      logApp(ctx, 'warn', 'second backup folder not written', warning);
    }
  }
  try {
    pruneDir(dir, now);
  } catch (e) {
    logApp(ctx, 'warn', 'could not tidy old backups', e instanceof Error ? e.message : String(e));
  }
  const entry = listBackups([dir]).find((e) => e.path === made.file);
  const item = entry ? toInfo(entry, 'primary') : toInfo({ name: path.basename(made.file), path: made.file, dir, bytes: made.manifest.bytes, at: now, kind, manifest: made.manifest }, 'primary');
  return { item, warning };
}

export function listForUi(ctx: Ctx, host: Host): BackupList {
  const s = loadSettings(ctx.db);
  const dir = backupsDir(host);
  const items = listBackups([dir]).map((e) => toInfo(e, 'primary'));
  let dir2Ok = false;
  if (s.secondBackupDir.trim()) {
    try {
      dir2Ok = fs.statSync(s.secondBackupDir).isDirectory();
    } catch { /* unreachable drive */ }
    if (dir2Ok) {
      const seen = new Set(items.map((i) => i.name));
      for (const e of listBackups([s.secondBackupDir])) if (!seen.has(e.name)) items.push(toInfo(e, 'second'));
    }
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { dir, dir2: s.secondBackupDir, dir2Ok, items, last: items.find((i) => i.ok) ?? null };
}

export function inspectBackup(file: string): BackupInfo {
  if (!fs.existsSync(file)) throw new PetraError('NOT_FOUND', 'backup file not found', { what: 'backup' });
  const m = readManifest(file);
  return {
    name: path.basename(file), path: file, where: 'file', bytes: fs.statSync(file).size, createdAt: m.createdAt, kind: m.kind, ok: true, app: m.app, schema: m.schema, business: m.business, counts: m.counts
  };
}

/** Plan 12.3: validate, safety backup of the current data, swap, reopen. Everything is checked before the live data is touched. */
export async function restoreBackup(d: Dispatcher, file: string): Promise<{ restored: BackupInfo; safety: BackupInfo | null }> {
  const ctx = d.ctx();
  const host = d.host;
  const who = d.session?.displayName ?? '';
  const work = path.join(backupsDir(host), '.restore');
  const x = extractBackup(file, work, currentVersion(ctx.db));
  let safety: BackupInfo | null = null;
  try {
    safety = runBackup(ctx, host, 'pre-restore').item;
    await host.restoreDatabase(x.dbFile);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const after = makeCtx(d.db, null, d.now);
  logApp(after, 'info', 'restored from backup', `${path.basename(file)} (${x.manifest.createdAt}) by ${who}`);
  audit(after, { action: 'backup.restore', entity: 'database', reason: `${path.basename(file)} by ${who}`, after: { createdAt: x.manifest.createdAt, schema: x.manifest.schema, counts: x.manifest.counts } });
  const info = inspectBackup(file);
  return { restored: info, safety };
}

/**
 * Start fresh: an optional safety backup, optionally clearing the old backups, exports and saved invoices, then a new empty
 * database. The backup is taken before anything is removed, and a failed backup stops everything.
 */
export async function startFresh(d: Dispatcher, o: { backup: boolean; deleteOldFiles: boolean }): Promise<{ backup: BackupInfo | null; deletedFiles: number }> {
  if (o.backup && o.deleteOldFiles) throw new PetraError('INVALID_INPUT', 'cannot keep a backup and delete old backups at once', { field: 'deleteOldFiles' });
  const ctx = d.ctx();
  const host = d.host;
  const who = d.session?.displayName ?? '';
  const business = scalar<string>(ctx.db, 'SELECT name FROM business_profile WHERE id = 1', [], '');
  const backup = o.backup ? runBackup(ctx, host, 'pre-reset').item : null;
  let deletedFiles = 0;
  if (o.deleteOldFiles) {
    for (const sub of ['backups', 'exports', 'invoices']) {
      const dir = path.join(host.dataDir, sub);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        deletedFiles++;
      }
    }
  }
  await host.resetDatabase();
  // the new shop has no second backup folder: damage recovery must never look in the old shop's
  rememberSecondDir(host.dataDir, '');
  const after = makeCtx(d.db, null, d.now);
  logApp(after, 'info', 'started fresh', `previous shop ${business || '-'} cleared by ${who}${backup ? `; backup ${backup.name}` : '; no backup'}${o.deleteOldFiles ? `; ${deletedFiles} old file(s) removed` : ''}`);
  audit(after, { action: 'shop.start_fresh', entity: 'database', reason: backup ? `backup ${backup.name}` : 'no backup', after: { deletedFiles } });
  return { backup, deletedFiles };
}

export function deleteBackup(ctx: Ctx, host: Host, file: string): void {
  const s = loadSettings(ctx.db);
  const allowed = [backupsDir(host), s.secondBackupDir].filter(Boolean).map((p) => path.resolve(p));
  const dir = path.resolve(path.dirname(file));
  if (!allowed.includes(dir) || !/\.petrabak$/.test(file)) throw new PetraError('INVALID_INPUT', 'only backups in the backup folders can be deleted', { field: 'path' });
  fs.rmSync(file, { force: true });
  audit(ctx, { action: 'backup.delete', entity: 'backup', reason: path.basename(file) });
}

export function auditPage(ctx: Ctx, f: { from?: string; to?: string; userId?: number; action?: string; search?: string; limit: number; offset: number }): AuditPage {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (f.from) { where.push('substr(a.at,1,10) >= ?'); p.push(f.from); }
  if (f.to) { where.push('substr(a.at,1,10) <= ?'); p.push(f.to); }
  if (f.userId) { where.push('a.user_id = ?'); p.push(f.userId); }
  if (f.action) { where.push('a.action = ?'); p.push(f.action); }
  if (f.search?.trim()) {
    where.push("(a.action LIKE ? ESCAPE '\\' OR a.entity LIKE ? ESCAPE '\\' OR a.reason LIKE ? ESCAPE '\\' OR COALESCE(a.before_json,'') LIKE ? ESCAPE '\\' OR COALESCE(a.after_json,'') LIKE ? ESCAPE '\\')");
    const like = `%${f.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    p.push(like, like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all<{ id: number; at: string; name: string | null; action: string; entity: string; entity_id: number | null; reason: string; before_json: string | null; after_json: string | null }>(
    ctx.db,
    `SELECT a.id, a.at, u.display_name AS name, a.action, a.entity, a.entity_id, a.reason, a.before_json, a.after_json FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...p, f.limit, f.offset
  );
  return {
    rows: rows.map((r) => ({ id: r.id, at: r.at, userName: r.name ?? '', action: r.action, entity: r.entity, entityId: r.entity_id, reason: r.reason, before: r.before_json, after: r.after_json })),
    total: scalar(ctx.db, `SELECT COUNT(*) FROM audit_log a ${w}`, p),
    actions: all<{ action: string }>(ctx.db, 'SELECT DISTINCT action FROM audit_log ORDER BY action').map((r) => r.action),
    users: all<{ id: number; display_name: string }>(ctx.db, 'SELECT id, display_name FROM users ORDER BY display_name').map((u) => ({ id: u.id, name: u.display_name }))
  };
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (head: string[], rows: unknown[][]): string => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/**
 * A ZIP the owner can send to support. It carries versions, health, row counts, settings, the app log and the shape of
 * the audit log. It never carries customers, products, prices, users, secrets or the database itself.
 */
export function diagnosticsZip(ctx: Ctx, host: Host): { file: string } {
  const now = new Date(ctx.now());
  const tables = all<{ name: string }>(ctx.db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const counts = Object.fromEntries(tables.map((t) => [t.name, scalar(ctx.db, `SELECT COUNT(*) FROM "${t.name.replace(/"/g, '""')}"`)]));
  const health = host.health();
  const settings = loadSettings(ctx.db);
  const info = {
    generatedAt: ctx.now(),
    app: { version: host.appVersion, electron: health.electronVersion, node: health.nodeVersion, packaged: health.packaged },
    database: { sqlite: health.sqliteVersion, journalMode: health.journalMode, synchronous: health.synchronous, foreignKeys: health.foreignKeys, integrity: health.integrity, schema: currentVersion(ctx.db), history: schemaHistory(ctx.db), rowCounts: counts },
    system: { platform: process.platform, arch: process.arch, release: os.release(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? '', memoryMB: Math.round(os.totalmem() / 1048576), freeMemoryMB: Math.round(os.freemem() / 1048576), locale: Intl.DateTimeFormat().resolvedOptions().locale, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    settings,
    backups: { dir: backupsDir(host), count: listBackups([backupsDir(host)]).length, lastGood: listBackups([backupsDir(host)]).find((b) => b.manifest)?.at.toISOString() ?? null }
  };
  const log = all<{ at: string; level: string; message: string; detail: string }>(ctx.db, 'SELECT at, level, message, detail FROM app_log ORDER BY id DESC LIMIT 1000');
  const audits = all<{ at: string; user_id: number | null; action: string; entity: string; entity_id: number | null }>(ctx.db, 'SELECT at, user_id, action, entity, entity_id FROM audit_log ORDER BY id DESC LIMIT 500');
  const backupLog = all<{ at: string; kind: string; ok: number; bytes: number; note: string }>(ctx.db, 'SELECT at, kind, ok, bytes, note FROM backup_log ORDER BY id DESC LIMIT 200');
  const entries = [
    { name: 'README.txt', data: 'PetraDMS diagnostics. This file contains versions, settings, counts and logs only. It contains no customer, supplier, product, price or user data and no passwords.\r\n' },
    { name: 'system.json', data: JSON.stringify(info, null, 2) },
    { name: 'app_log.csv', data: toCsv(['at', 'level', 'message', 'detail'], log.map((r) => [r.at, r.level, r.message, r.detail])) },
    { name: 'audit_summary.csv', data: toCsv(['at', 'user_id', 'action', 'entity', 'entity_id'], audits.map((r) => [r.at, r.user_id, r.action, r.entity, r.entity_id])) },
    { name: 'backup_log.csv', data: toCsv(['at', 'kind', 'ok', 'bytes', 'note'], backupLog.map((r) => [r.at, r.kind, r.ok, r.bytes, r.note])) }
  ];
  const logsDir = path.join(host.dataDir, 'logs');
  try {
    for (const n of fs.readdirSync(logsDir).filter((f) => f.endsWith('.log')).slice(-5)) {
      const buf = fs.readFileSync(path.join(logsDir, n));
      entries.push({ name: `logs/${n}`, data: buf.subarray(Math.max(0, buf.length - 200_000)).toString('utf8') });
    }
  } catch { /* no logs folder yet */ }
  const file = path.join(host.dataDir, 'exports', `diagnostics-${stampOf(now)}.zip`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, makeZip(entries.map((e) => ({ ...e, date: now }))));
  return { file };
}

export function recoveryNotice(ctx: Ctx): RecoveryNotice | null {
  const raw = getRaw(ctx.db, 'last_recovery');
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as RecoveryNotice & { dismissed?: boolean };
    return j.dismissed ? null : { at: j.at, backupAt: j.backupAt, backupKind: j.backupKind };
  } catch {
    return null;
  }
}

export function recordRecovery(ctx: Ctx, n: RecoveryNotice, detail: string): void {
  setRaw(ctx, 'last_recovery', JSON.stringify(n));
  logApp(ctx, 'error', 'the data file was damaged; restored from backup', detail);
}

export function dismissRecovery(ctx: Ctx): void {
  const raw = getRaw(ctx.db, 'last_recovery');
  if (!raw) return;
  try {
    setRaw(ctx, 'last_recovery', JSON.stringify({ ...(JSON.parse(raw) as object), dismissed: true }));
  } catch { /* nothing to dismiss */ }
}

