import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { AutoBackup, backupFileName, extractBackup, listBackups, parseBackupName, pruneBackups, readZipFile, recoverIfCorrupt, type BackupKind } from './app';
import { checkIntegrity, formatViolations } from './integrity';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs, type App } from './testApp';
import { loadMigrations } from './migrate';
import { REPO_MIGRATIONS_DIR } from './migrationsDir';

/** The schema version this build writes; backups of this version are accepted, anything newer is refused. */
const SCHEMA = loadMigrations(REPO_MIGRATIONS_DIR).length;

let app: App | undefined;
const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-safety-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  try { app?.close(); } catch { /* already closed by the test */ }
  app = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function start() {
  const dir = tmp();
  app = makeApp(undefined, { dataDir: dir });
  const users = await setupWithUsers(app.d);
  return { dir, users, d: app.d };
}
const customers = async (a: App) => (await ok(a.d, 'customer:list', { includeArchived: true })).map((c) => c.name).sort();

describe('retention', () => {
  it('keeps the newest of each of 14 days, 8 weeks and 12 months, plus 5 safety copies', () => {
    const now = new Date(2026, 9, 7, 12, 0, 0);
    const files: { name: string; at: Date; kind: BackupKind }[] = [];
    for (let i = 0; i < 400; i++) {
      for (const hour of [9, 18]) {
        const at = new Date(2026, 9, 7 - i, hour, 0, 0);
        files.push({ name: backupFileName(at, 'auto'), at, kind: 'auto' });
      }
    }
    for (let i = 0; i < 8; i++) {
      const at = new Date(2026, 9, 7 - i, 13, 0, 0);
      files.push({ name: backupFileName(at, 'pre-restore'), at, kind: 'pre-restore' });
    }
    const gone = new Set(pruneBackups(files, now));
    const kept = files.filter((f) => !gone.has(f.name));
    const routine = kept.filter((f) => f.kind === 'auto');
    // every one of the last 14 days keeps its newest (18:00) and drops the 09:00 one
    for (let i = 0; i < 14; i++) {
      expect(routine.some((f) => f.at.getHours() === 18 && Math.round((Date.UTC(2026, 9, 7) - Date.UTC(f.at.getFullYear(), f.at.getMonth(), f.at.getDate())) / 86_400_000) === i)).toBe(true);
    }
    // the 09:00 copies are dropped except among the six newest (today and the last two days)
    expect(routine.filter((f) => f.at.getHours() === 9).length).toBeLessThanOrEqual(3);
    expect(routine.length).toBeGreaterThanOrEqual(14 + 6 + 8);
    expect(routine.length).toBeLessThanOrEqual(14 + 8 + 12);
    // nothing older than a year survives; every one of the last 12 months has a backup
    expect(routine.every((f) => now.getTime() - f.at.getTime() < 366 * 86_400_000)).toBe(true);
    for (let m = 0; m < 12; m++) expect(routine.some((f) => (now.getFullYear() - f.at.getFullYear()) * 12 + now.getMonth() - f.at.getMonth() === m)).toBe(true);
    expect(kept.filter((f) => f.kind === 'pre-restore')).toHaveLength(5);
    // the newest routine backup is never removed, even alone
    const one = [{ name: backupFileName(now, 'manual'), at: now, kind: 'manual' as BackupKind }];
    expect(pruneBackups(one, now)).toEqual([]);
  });

  it('parses its own file names and ignores others', () => {
    const at = new Date(2026, 0, 31, 23, 59, 58);
    expect(parseBackupName(backupFileName(at, 'close'))).toEqual({ at, kind: 'close' });
    expect(parseBackupName('notes.txt')).toBeNull();
    expect(parseBackupName('PetraDMS-20260101-000000-weird.petrabak')).toBeNull();
  });
});

describe('backup and restore', () => {
  it('makes a verified backup, rejects tampering and truncation, refuses a newer schema', async () => {
    const { dir, d } = await start();
    await ok(d, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 0 });
    const r = await ok(d, 'backup:create');
    expect(r.warning).toBeNull();
    expect(r.item).toMatchObject({ kind: 'manual', ok: true, where: 'primary', schema: SCHEMA });
    expect(r.item.counts.customers).toBe(1);
    expect(fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('.tmp') || n.endsWith('.part'))).toEqual([]);
    const names = readZipFile(r.item.path, ['manifest.json']).names;
    expect(names).toEqual(['manifest.json', 'petra.db']);

    const work = path.join(dir, 'work');
    const x = extractBackup(r.item.path, work, SCHEMA);
    expect(x.manifest.sha256).toHaveLength(64);
    expect(new DatabaseSync(x.dbFile, { readOnly: true }).prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 1 });
    expect(() => extractBackup(r.item.path, work, 0)).toThrowError(/newer/);

    const bad = path.join(dir, 'backups', 'PetraDMS-20260101-000000-manual.petrabak');
    const bytes = fs.readFileSync(r.item.path);
    const flipped = Buffer.from(bytes);
    flipped[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(bad, flipped);
    expect(() => extractBackup(bad, work, SCHEMA)).toThrowError(/damaged|checksum/);
    fs.writeFileSync(bad, bytes.subarray(0, Math.floor(bytes.length / 2)));
    expect(() => extractBackup(bad, work, SCHEMA)).toThrowError(/not a backup|cut short|damaged/);
    fs.writeFileSync(bad, 'this is not a zip');
    expect(await fail(d, 'backup:inspect', { path: bad })).toBe('BACKUP_INVALID');
    // the damaged files are listed (so they can be seen and deleted) but never counted as the last good backup
    const list = await ok(d, 'backup:list');
    expect(list.items.filter((i) => !i.ok)).toHaveLength(1);
    expect(list.last?.name).toBe(r.item.name);
    await ok(d, 'backup:delete', { path: bad });
    expect(fs.existsSync(bad)).toBe(false);
    expect(await fail(d, 'backup:delete', { path: path.join(dir, 'data', 'petra.db') })).toBe('INVALID_INPUT');
  });

  it('restores: validates, takes a safety backup, swaps, ends the session, keeps integrity, audits', async () => {
    const { dir, users, d } = await start();
    await ok(d, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 100000 });
    const b = await ok(d, 'backup:create');
    await ok(d, 'customer:save', { name: 'Added Later', type: 'retail', creditLimit: 0, openingBalance: 0 });
    expect(await customers(app!)).toEqual(['Added Later', 'Karim Store']);

    expect(await fail(d, 'backup:restore', { path: b.item.path, confirm: 'yes' })).toBe('INVALID_INPUT');
    expect(await customers(app!)).toEqual(['Added Later', 'Karim Store']);
    const garbage = path.join(dir, 'garbage.petrabak');
    fs.writeFileSync(garbage, 'nope');
    expect(await fail(d, 'backup:restore', { path: garbage, confirm: 'RESTORE' })).toBe('BACKUP_INVALID');
    expect(await customers(app!)).toEqual(['Added Later', 'Karim Store']); // a bad file touches nothing

    const r = await ok(d, 'backup:restore', { path: b.item.path, confirm: 'RESTORE' });
    expect(r.safety?.kind).toBe('pre-restore');
    expect(r.restored.counts.customers).toBe(1);
    expect(d.session).toBeNull();
    await signInAs(d, users.owner, 'owner');
    expect(await customers(app!)).toEqual(['Karim Store']);
    expectIntegrity(app!);
    const log = await ok(d, 'audit:list', { limit: 20, offset: 0, action: 'backup.restore' });
    expect(log.rows).toHaveLength(1);
    // the safety copy holds the data as it was just before the restore, including the later customer
    const x = extractBackup(r.safety!.path, path.join(dir, 'w2'), SCHEMA);
    expect(new DatabaseSync(x.dbFile, { readOnly: true }).prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 2 });
    expect((await ok(d, 'app:status')).needsSetup).toBe(false);
  });

  it('copies to a second folder, warns (but still succeeds) when that folder is unreachable, and prunes', async () => {
    const { dir, d } = await start();
    const second = path.join(tmp(), 'usb');
    await ok(d, 'settings:save', { secondBackupDir: second });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'backup-dirs.json'), 'utf8')).second).toBe(second);
    const r = await ok(d, 'backup:create');
    expect(fs.existsSync(path.join(second, r.item.name))).toBe(true);
    expect(extractBackup(path.join(second, r.item.name), path.join(dir, 'w'), SCHEMA).manifest.sha256).toBe(extractBackup(r.item.path, path.join(dir, 'w'), SCHEMA).manifest.sha256);
    const unreachable = path.join(dir, 'data', 'petra.db', 'impossible'); // a path below a file
    await ok(d, 'settings:save', { secondBackupDir: unreachable });
    const r2 = await ok(d, 'backup:create');
    expect(r2.warning).toBeTruthy();
    expect((await ok(d, 'backup:list')).dir2Ok).toBe(false);
    const log = await ok(d, 'diag:export');
    expect(fs.existsSync(log.path)).toBe(true);
  });
});

describe('automatic backups', () => {
  it('backs up after the interval only when data changed, once more on close, and respects the switches', async () => {
    const { d } = await start();
    await ok(d, 'settings:save', { backupIntervalMinutes: 5 });
    let nowMs = 1_000_000;
    const auto = new AutoBackup(d, () => nowMs);
    const count = (k?: string) => listBackups([path.join(d.host.dataDir, 'backups')]).filter((b) => !k || b.kind === k).length;
    nowMs += 6 * 60_000;
    expect(auto.tick()).toBe(false); // nothing changed, however long it has been
    await ok(d, 'customer:save', { name: 'A', type: 'retail', creditLimit: 0, openingBalance: 0 });
    expect(auto.tick()).toBe(true); // changed after a long quiet spell: protected at the next tick
    expect(count('auto')).toBe(1);
    await ok(d, 'customer:save', { name: 'B', type: 'retail', creditLimit: 0, openingBalance: 0 });
    nowMs += 2 * 60_000;
    expect(auto.tick()).toBe(false); // the interval has not passed since the last backup
    nowMs += 4 * 60_000;
    expect(auto.tick()).toBe(true);
    expect(count('auto')).toBe(2);
    nowMs += 10 * 60_000;
    expect(auto.tick()).toBe(false); // nothing new
    await ok(d, 'customer:save', { name: 'C', type: 'retail', creditLimit: 0, openingBalance: 0 });
    expect(auto.onClose()).toBe(true);
    expect(count('close')).toBe(1);
    expect(auto.onClose()).toBe(false);

    await ok(d, 'settings:save', { backupAuto: false, backupOnClose: false });
    auto.noteManual();
    await ok(d, 'customer:save', { name: 'C', type: 'retail', creditLimit: 0, openingBalance: 0 });
    nowMs += 60 * 60_000;
    expect(auto.tick()).toBe(false);
    expect(auto.onClose()).toBe(false);
    expect(count()).toBe(3);
  });
});

describe('audit log and diagnostics', () => {
  it('lists and filters the audit log (Owner only) and writes a diagnostics zip without business data', async () => {
    const { dir, users, d } = await start();
    await ok(d, 'customer:save', { name: 'Secret Customer Name', phone: '01799999999', type: 'retail', creditLimit: 0, openingBalance: 0 });
    await ok(d, 'settings:save', { taxBp: 500 });
    await ok(d, 'backup:create');
    const all = await ok(d, 'audit:list', { limit: 100, offset: 0 });
    expect(all.total).toBeGreaterThan(2);
    expect(all.actions).toContain('settings.save');
    expect(all.users.map((u) => u.name)).toContain('Rahim');
    const one = await ok(d, 'audit:list', { limit: 100, offset: 0, action: 'settings.save' });
    expect(one.rows.length).toBe(one.total);
    expect(one.rows[0]).toMatchObject({ action: 'settings.save', userName: 'Rahim' });
    expect((await ok(d, 'audit:list', { limit: 100, offset: 0, search: 'taxBp' })).total).toBeGreaterThanOrEqual(1);
    expect((await ok(d, 'audit:list', { limit: 100, offset: 0, search: '100%_no_such' })).total).toBe(0);
    expect((await ok(d, 'audit:list', { limit: 100, offset: 0, from: '2099-01-01' })).total).toBe(0);
    expect((await ok(d, 'audit:list', { limit: 2, offset: 1 })).rows).toHaveLength(2);

    const z = await ok(d, 'diag:export');
    const { names, files } = readZipFile(z.path, ['system.json', 'app_log.csv', 'README.txt']);
    expect(names).toContain('audit_summary.csv');
    const sys = JSON.parse(files.get('system.json')!.toString('utf8'));
    expect(sys.database.integrity).toBe('ok');
    expect(sys.database.rowCounts.customers).toBe(1);
    const everything = names.map((n) => readZipFile(z.path, [n]).files.get(n)!.toString('utf8')).join('\n');
    expect(everything).not.toContain('Secret Customer Name');
    expect(everything).not.toContain('01799999999');
    expect(everything).not.toMatch(/scrypt\$/);
    expect(fs.statSync(z.path).size).toBeGreaterThan(500);
    expect(z.path.startsWith(path.join(dir, 'exports'))).toBe(true);

    for (const role of ['manager', 'staff'] as const) {
      await signInAs(d, users[role], role);
      for (const ch of ['backup:list', 'backup:create', 'audit:list', 'diag:export'] as const) {
        expect(await fail(d, ch, ch === 'audit:list' ? { limit: 10, offset: 0 } : undefined)).toBe('PERMISSION');
      }
    }
  });
});

describe('recovery', () => {
  it('restores the newest good backup when the database is damaged, keeping the damaged file', async () => {
    const { dir, d } = await start();
    await ok(d, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 0 });
    await ok(d, 'backup:create');
    await ok(d, 'customer:save', { name: 'After Backup', type: 'retail', creditLimit: 0, openingBalance: 0 });
    app!.close();
    app = undefined;
    const dbFile = path.join(dir, 'data', 'petra.db');
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
    const bytes = fs.readFileSync(dbFile);
    for (let i = 4096; i < bytes.length - 4096; i += 4096) bytes.fill(0xab, i + 100, i + 300); // scribble over page interiors
    fs.writeFileSync(dbFile, bytes);

    // a damaged newest backup is skipped in favour of an older good one
    const good = listBackups([path.join(dir, 'backups')])[0]!;
    fs.writeFileSync(path.join(dir, 'backups', 'PetraDMS-20990101-000000-auto.petrabak'), 'broken');
    const r = recoverIfCorrupt(dir, [path.join(dir, 'backups')], SCHEMA, new Date(2026, 9, 7, 12, 0, 0));
    expect(r.state).toBe('recovered');
    if (r.state !== 'recovered') return;
    expect(path.basename(r.backupFile)).toBe(good.name);
    expect(fs.existsSync(r.corruptFile)).toBe(true);
    const db = new DatabaseSync(dbFile, { readOnly: true });
    expect((db.prepare('SELECT name FROM customers').all() as { name: string }[]).map((c) => c.name)).toEqual(['Karim Store']);
    expect(checkIntegrity(db as never).length).toBe(0);
    db.close();
    expect(recoverIfCorrupt(dir, [path.join(dir, 'backups')], SCHEMA, new Date()).state).toBe('ok');
  });

  it('with a damaged database and no usable backup it stops and leaves the file untouched', async () => {
    const { dir } = await start();
    app!.close();
    app = undefined;
    const dbFile = path.join(dir, 'data', 'petra.db');
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
    const bytes = fs.readFileSync(dbFile);
    for (let i = 4096; i < bytes.length - 4096; i += 4096) bytes.fill(0xcd, i + 100, i + 300);
    fs.writeFileSync(dbFile, bytes);
    const before = fs.readFileSync(dbFile);
    expect(() => recoverIfCorrupt(dir, [path.join(dir, 'backups')], SCHEMA, new Date())).toThrowError(/no usable backup/);
    expect(fs.readFileSync(dbFile).equals(before)).toBe(true);
    expect(recoverIfCorrupt(tmp(), [], SCHEMA, new Date()).state).toBe('fresh');
  });
});

describe('power cut and crash', () => {
  it('survives being killed in the middle of posting, five times over: no damage, no half-posted documents', async () => {
    const { dir, d } = await start();
    const sup = await ok(d, 'catalog:supplierSave', { name: 'S' });
    const ids: number[] = [];
    for (const n of ['One', 'Two', 'Three']) ids.push((await ok(d, 'catalog:productSave', { sku: n, name: n, baseUnit: 'pcs', priceRetail: 10000, priceWholesale: 9000, priceDealer: 8500 })).id);
    const today = (await ok(d, 'app:status')).businessDate;
    await ok(d, 'purchase:save', { supplierId: sup.id, date: today, lines: ids.map((id) => ({ productId: id, qty: 1_000_000, unitCost: 5000 })), paid: 0 });
    for (const n of ['A', 'B', 'C']) await ok(d, 'customer:save', { name: n, type: 'retail', creditLimit: 0, openingBalance: 0 });
    app!.close();
    app = undefined;
    const dbFile = path.join(dir, 'data', 'petra.db');
    const child = fileURLToPath(new URL('./killChild.ts', import.meta.url));
    const root = fileURLToPath(new URL('../../..', import.meta.url));

    let acknowledged = 0;
    for (let round = 0; round < 5; round++) {
      const p = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', child, dbFile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let last = 0;
      let stderr = '';
      p.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
      const target = 8 + round * 7;
      await new Promise<void>((resolve, reject) => {
        let buf = '';
        let killed = false;
        p.stdout.on('data', (b: Buffer) => {
          buf += b.toString();
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const l of lines) if (l) last = Number(l);
          if (!killed && last >= target) {
            killed = true;
            setTimeout(() => p.kill('SIGKILL'), (round * 3) % 11); // land mid-transaction, not only between them
          }
        });
        p.on('exit', () => resolve());
        p.on('error', reject);
        setTimeout(() => { if (!killed) { p.kill('SIGKILL'); reject(new Error(`child too slow or crashed: ${stderr}`)); } }, 60_000);
      });
      acknowledged += last;
      const db = new DatabaseSync(dbFile);
      db.exec('PRAGMA journal_mode = WAL');
      const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      expect(integrity).toBe('ok');
      expect(formatViolations(checkIntegrity(db as never))).toBe('');
      db.close();
    }
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const sales = (db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status = 'posted'").get() as { n: number }).n;
    db.close();
    // every sale the child reported as committed is in the database; at most one more (killed after commit, before the print) can be
    expect(sales).toBeGreaterThanOrEqual(acknowledged);
    expect(sales).toBeLessThanOrEqual(acknowledged + 5);
    expect(acknowledged).toBeGreaterThan(30);
  }, 240_000);
});

describe('start fresh', () => {
  it('with a backup: keeps a pre-reset copy, empties the shop, ends the session, opens setup, and the copy restores', async () => {
    const { dir, d } = await start();
    await ok(d, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 100000 });
    await ok(d, 'settings:save', { secondBackupDir: path.join(tmp(), 'usb') });
    expect(await fail(d, 'shop:startFresh', { confirm: 'yes', backup: true })).toBe('INVALID_INPUT');
    expect(await fail(d, 'shop:startFresh', { confirm: 'DELETE', backup: true, deleteOldFiles: true })).toBe('INVALID_INPUT');
    expect(await customers(app!)).toEqual(['Karim Store']); // refused requests touch nothing

    const r = await ok(d, 'shop:startFresh', { confirm: 'DELETE', backup: true });
    expect(r.backup?.kind).toBe('pre-reset');
    expect(r.backup?.counts.customers).toBe(1);
    expect(r.deletedFiles).toBe(0);
    expect(d.session).toBeNull();
    expect((await ok(d, 'app:status')).needsSetup).toBe(true);
    // the old shop's second folder is forgotten, so damage recovery never brings the old shop back
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'backup-dirs.json'), 'utf8')).second).toBe('');
    expect(fs.existsSync(r.backup!.path)).toBe(true);

    // a new shop starts empty
    const fresh = await setupWithUsers(d);
    expect(await customers(app!)).toEqual([]);
    expect(await ok(d, 'catalog:products', { includeArchived: true })).toEqual([]);
    expectIntegrity(app!);
    // and the backup can bring the old shop back
    await signInAs(d, fresh.owner, 'owner');
    await ok(d, 'backup:restore', { path: r.backup!.path, confirm: 'RESTORE' });
    expect((await ok(d, 'app:status')).needsSetup).toBe(false);
  });

  it('without a backup, optionally clearing old backups, exports and invoices; only the owner may do it', async () => {
    const { dir, users, d } = await start();
    await ok(d, 'customer:save', { name: 'Karim Store', type: 'retail', creditLimit: 0, openingBalance: 0 });
    await ok(d, 'backup:create');
    fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'exports', 'customers.csv'), 'Karim Store');
    await signInAs(d, users.manager, 'manager');
    expect(await fail(d, 'shop:startFresh', { confirm: 'DELETE', backup: false })).toBe('PERMISSION');
    await signInAs(d, users.owner, 'owner');

    // without a backup and keeping old files: the earlier manual backup stays
    const r = await ok(d, 'shop:startFresh', { confirm: 'DELETE', backup: false });
    expect(r.backup).toBeNull();
    expect(listBackups([path.join(dir, 'backups')]).length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir, 'exports', 'customers.csv'))).toBe(true);

    // again, this time clearing the old files too: nothing of the old shop is left in the data folder
    const u2 = await setupWithUsers(d);
    await signInAs(d, u2.owner, 'owner');
    const r2 = await ok(d, 'shop:startFresh', { confirm: 'DELETE', backup: false, deleteOldFiles: true });
    expect(r2.deletedFiles).toBeGreaterThan(0);
    expect(listBackups([path.join(dir, 'backups')])).toEqual([]);
    expect(fs.readdirSync(path.join(dir, 'exports'))).toEqual([]);
    expect((await ok(d, 'app:status')).needsSetup).toBe(true);
    await setupWithUsers(d);
    expect(await customers(app!)).toEqual([]);
    expectIntegrity(app!);
  });
});
