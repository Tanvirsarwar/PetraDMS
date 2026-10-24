// Release checks, run by `pnpm verify:release` after the normal gate and by CI as `pnpm verify:package`.
// It builds the real package and then tests the PACKAGED app, never the development build:
//   1. package contents (app archive, database migrations, icon, installer size)
//   2. a fresh start opens the database in WAL mode, creates every table, passes the integrity check, starts empty
//   3. the committed version-1 database opens with every row intact
//   4. the packaged app makes no network request and an outside fetch / XHR is blocked
//   5. first run in the DEFAULT data location (no PETRA_DATA_DIR): the shop is created under the per-user application
//      data folder, nothing is written next to the program, data survives closing and reopening
//   6. upgrade: version A is installed and used, version B is installed over it, and every record and the settings are
//      still there
//   7. Windows only: executable metadata (product, publisher, version), Start Menu and Desktop shortcuts, a per-user
//      uninstall entry, the signature state, and a silent uninstall that removes the program but keeps the shop's data
// On Linux and macOS the NSIS installer cannot be made, so the unpacked app from the same configuration stands in for
// the installed program (steps 1 to 6 run; step 7 is reported as skipped and runs in the Windows CI job).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type Page } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');
const releaseA = path.join(desktop, 'release');
const releaseB = path.join(desktop, 'release-upgrade');
const win = process.platform === 'win32';
const results: Array<{ name: string; status: 'pass' | 'skip'; note?: string }> = [];
const pass = (name: string, note?: string) => { results.push({ name, status: 'pass', note }); console.log(`  PASS  ${name}${note ? ` (${note})` : ''}`); };
const skip = (name: string, note: string) => { results.push({ name, status: 'skip', note }); console.log(`  SKIP  ${name} (${note})`); };
const fail = (msg: string): never => { console.error(`\nFAIL  ${msg}`); process.exit(1); };
const check = (cond: unknown, msg: string): void => { if (!cond) fail(msg); };
const section = (s: string) => console.log(`\n== ${s} ==`);

const run = (cmd: string, args: string[], env: Record<string, string> = {}, cwd = root) =>
  spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win, env: { ...process.env, ...env } });
const ps = (script: string): string => {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  if (r.status !== 0) fail(`PowerShell failed: ${script}\n${r.stderr}`);
  return r.stdout.trim();
};

// ---------------------------------------------------------------------------------------------------- build A
section('Build the package');
fs.rmSync(releaseA, { recursive: true, force: true });
fs.rmSync(releaseB, { recursive: true, force: true });
const built = run('pnpm', ['--filter', '@petra/desktop', win ? 'dist:win' : 'dist:dir'], { CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_LINK ? 'true' : 'false' });
check(built.status === 0, 'electron-builder failed');

const version = (JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')) as { version: string }).version;
const bumped = (v: string): string => { const [a, b, c] = v.split('.').map(Number); return `${a}.${b}.${(c ?? 0) + 1}`; };
const versionB = bumped(version);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-release-'));
const installDir = path.join(tmp, win ? 'PetraDMS-installed' : 'app-installed');
const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: 'inherit' });
const killApp = () => { if (win) spawnSync('taskkill', ['/F', '/IM', 'PetraDMS.exe'], { stdio: 'ignore' }); };

let installerA = '';
let appExe: string;
let resources: string;
if (win) {
  installerA = path.join(releaseA, `PetraDMS-Setup-${version}.exe`);
  check(fs.existsSync(installerA), `installer not found: ${installerA}`);
  const mb = fs.statSync(installerA).size / 1048576;
  check(mb > 50, `installer is only ${mb.toFixed(1)} MB`);
  check(!fs.readdirSync(releaseA).some((f) => /\.(map|ts|tsx)$/.test(f)), 'development files in the release folder');
  pass('installer produced', `${path.basename(installerA)}, ${mb.toFixed(1)} MB`);
  killApp();
  const r = sh(installerA, ['/S', `/D=${installDir}`]);
  check(r.status === 0, 'silent install failed');
  appExe = path.join(installDir, 'PetraDMS.exe');
  resources = path.join(installDir, 'resources');
} else {
  fs.cpSync(path.join(releaseA, 'linux-unpacked'), installDir, { recursive: true });
  appExe = path.join(installDir, 'PetraDMS');
  resources = path.join(installDir, 'resources');
}
check(fs.existsSync(appExe), `packaged app not found: ${appExe}`);

const launchArgs = (extra: string[] = []) => (process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', ...extra] : extra);
const needsDisplay = process.platform === 'linux' && !process.env.DISPLAY;
const baseEnv = (): Record<string, string> => {
  const e = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', PETRA_NO_REVEAL: '1' } as Record<string, string>;
  delete e.PETRA_DATA_DIR; // a customer's computer has no such variable
  return e;
};

// ------------------------------------------------------------------------------------------------ contents
section('Package contents');
check(fs.existsSync(path.join(resources, 'app.asar')), 'app.asar missing');
// the sign-in screen's PETRA logo must be inside the packaged app (read the asar header: 4 bytes size, 4 pickle, 4 pickle, 4 json length, then json)
{
  const fd = fs.openSync(path.join(resources, 'app.asar'), 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const jsonLen = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLen);
  fs.readSync(fd, json, 0, jsonLen, 16);
  fs.closeSync(fd);
  const files = (JSON.parse(json.toString('utf8')) as { files: { dist?: { files?: { assets?: { files?: Record<string, { size?: number }> } } } } }).files;
  const logo = Object.entries(files.dist?.files?.assets?.files ?? {}).find(([n]) => /^petra-logo-.*\.png$/.test(n));
  check(!!logo && (logo[1].size ?? 0) > 10_000, 'the PETRA logo (dist/assets/petra-logo-*.png) is missing from app.asar');
}
const migrations = fs.readdirSync(path.join(resources, 'migrations')).filter((f) => f.endsWith('.sql'));
check(migrations.length >= 1, 'database migrations are not in the package');
check(fs.existsSync(path.join(desktop, 'build', 'icon.ico')), 'icon.ico missing');
const unwanted = fs.readdirSync(resources).filter((f) => /\.(ts|tsx|map|db)$/.test(f) || f === 'e2e' || f === 'fixtures');
check(unwanted.length === 0, `development files shipped: ${unwanted.join(', ')}`);
pass('package contents', `app.asar with the PETRA logo, ${migrations.length} migration(s), icon, no development files`);

// ------------------------------------------------------------------------------------------------ smoke
type Smoke = { ok: boolean; packaged: boolean; tables: number; journalMode: string; integrity: string; version: string; schema: number; dataDir: string; counts: Record<string, number> };
const smoke = (exe: string, env: Record<string, string>, label: string): Smoke => {
  const out = path.join(tmp, `${label}.json`);
  const args = launchArgs(['--smoke-test']);
  const e = { ...baseEnv(), ...env, PETRA_SMOKE_OUT: out };
  const r = needsDisplay ? spawnSync('xvfb-run', ['-a', exe, ...args], { env: e }) : spawnSync(exe, args, { env: e });
  check(r.status === 0 && fs.existsSync(out), `${label}: packaged app did not pass its own smoke test (exit ${r.status})\n${r.stderr?.toString() ?? ''}`);
  return JSON.parse(fs.readFileSync(out, 'utf8')) as Smoke;
};

section('Fresh start');
const fresh = smoke(appExe, { PETRA_DATA_DIR: path.join(tmp, 'fresh') }, 'fresh');
check(fresh.ok && fresh.packaged, 'fresh: not a packaged production run');
check(fresh.journalMode === 'wal' && fresh.integrity === 'ok', `fresh: journal ${fresh.journalMode}, integrity ${fresh.integrity}`);
check(fresh.tables > 30, `fresh: only ${fresh.tables} tables`);
check(fresh.version === version, `fresh: version ${fresh.version} is not ${version}`);
check(Object.values(fresh.counts).every((n) => n === 0), 'fresh: a new shop must start empty');
pass('fresh install opens', `v${fresh.version}, schema ${fresh.schema}, ${fresh.tables} tables, WAL, integrity ok`);

section('Existing data kept (released version-1 database)');
const fixtureDir = path.join(root, 'packages', 'db', 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'petra-v1.json'), 'utf8')) as { counts: Record<string, number> };
const oldShop = path.join(tmp, 'old-shop');
fs.mkdirSync(path.join(oldShop, 'data'), { recursive: true });
fs.copyFileSync(path.join(fixtureDir, 'petra-v1.db'), path.join(oldShop, 'data', 'petra.db'));
const upgradedFixture = smoke(appExe, { PETRA_DATA_DIR: oldShop }, 'fixture');
check(upgradedFixture.ok && upgradedFixture.integrity === 'ok', 'fixture: database not healthy after opening');
for (const k of ['products', 'customers', 'suppliers', 'sales', 'purchases', 'users'] as const)
  check(upgradedFixture.counts[k] === expected.counts[k], `fixture: ${k} is ${upgradedFixture.counts[k]}, expected ${expected.counts[k]}`);
pass('version-1 shop opens with every row', Object.entries(upgradedFixture.counts).map(([k, v]) => `${k} ${v}`).join(', '));

// ------------------------------------------------------------------------------------------------ driving the app
const invoke = (page: Page, channel: string, input?: unknown): Promise<unknown> =>
  // a string, because this script is type-checked without the browser's DOM types
  page.evaluate<unknown>(`window.petra.invoke(${JSON.stringify(channel)}${input === undefined ? '' : `, ${JSON.stringify(input)}`})`);

async function withApp<T>(exe: string, env: Record<string, string>, fn: (page: Page, requests: string[]) => Promise<T>): Promise<T> {
  const app = await electron.launch({ executablePath: exe, args: launchArgs(), env: { ...baseEnv(), ...env } });
  try {
    const page = await app.firstWindow();
    const requests: string[] = [];
    page.on('request', (r) => { if (!/^(file|devtools|data|blob):/.test(r.url())) requests.push(r.url()); });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction('typeof window.petra !== "undefined"', undefined, { timeout: 30_000 });
    return await fn(page, requests);
  } finally {
    await app.close();
  }
}

section('No network');
await withApp(appExe, { PETRA_DATA_DIR: path.join(tmp, 'net') }, async (page, requests) => {
  await page.waitForSelector('[data-testid="wizard-step-1"]', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const appRequests = [...requests]; // what the app asked for on its own, before the deliberate probes below
  const fetched = await page.evaluate<string>(`fetch('https://example.com/').then(() => 'reached', () => 'blocked')`);
  const xhr = await page.evaluate<string>(`new Promise((resolve) => { const x = new XMLHttpRequest(); x.onload = () => resolve('reached'); x.onerror = () => resolve('blocked'); x.open('GET', 'https://example.com/'); x.send(); })`);
  check(appRequests.length === 0, `the app asked for: ${appRequests.join(', ')}`);
  check(fetched === 'blocked' && xhr === 'blocked', `an outside request got through (fetch ${fetched}, xhr ${xhr})`);
});
pass('packaged app is offline', 'no request left the app; fetch and XHR to the internet are blocked');

// ------------------------------------------------------------------------------------------------ Windows install facts
if (win) {
  section('Windows installation facts');
  const info = JSON.parse(ps(`(Get-Item '${appExe}').VersionInfo | Select-Object ProductName,CompanyName,FileDescription,FileVersion,ProductVersion,LegalCopyright | ConvertTo-Json`)) as Record<string, string>;
  check(info.ProductName === 'PetraDMS', `ProductName is "${info.ProductName}"`);
  check(info.CompanyName === 'Petra', `CompanyName (publisher) is "${info.CompanyName}"`);
  check(String(info.FileVersion).startsWith(version) && String(info.ProductVersion).startsWith(version), `version metadata is ${info.FileVersion} / ${info.ProductVersion}, expected ${version}`);
  check(/Petra/.test(String(info.LegalCopyright)), `copyright is "${info.LegalCopyright}"`);
  pass('executable metadata', `PetraDMS ${info.ProductVersion}, publisher ${info.CompanyName}, ${info.LegalCopyright}`);

  const startMenu = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'PetraDMS.lnk');
  const desktopLnk = path.join(ps('[Environment]::GetFolderPath("Desktop")'), 'PetraDMS.lnk');
  check(fs.existsSync(startMenu), `Start Menu shortcut missing: ${startMenu}`);
  check(fs.existsSync(desktopLnk), `Desktop shortcut missing: ${desktopLnk}`);
  pass('Start Menu and Desktop shortcuts exist');

  const uninst = JSON.parse(ps(`$k = Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -like 'PetraDMS*' } | Select-Object -First 1 DisplayName,Publisher,DisplayVersion,InstallLocation; if (-not $k) { '{}' } else { $k | ConvertTo-Json }`)) as Record<string, string>;
  check(uninst.DisplayName && /PetraDMS/.test(uninst.DisplayName), 'no per-user (HKCU) uninstall entry: the installer must not need administrator rights');
  check(uninst.Publisher === 'Petra', `uninstall entry publisher is "${uninst.Publisher}"`);
  check(String(uninst.DisplayVersion).startsWith(version), `uninstall entry version is "${uninst.DisplayVersion}"`);
  const machineWide = ps(`(Get-ChildItem 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -like 'PetraDMS*' } | Measure-Object).Count`);
  check(machineWide === '0', 'the installer registered itself machine-wide (it must be a per-user install)');
  pass('per-user uninstall entry', `${uninst.DisplayName}, ${uninst.Publisher}, ${uninst.DisplayVersion}`);

  const sig = ps(`(Get-AuthenticodeSignature '${installerA}').Status`);
  if (process.env.PETRA_EXPECT_SIGNED === '1') {
    check(sig === 'Valid', `installer signature is ${sig}, expected Valid`);
    pass('installer is digitally signed', sig);
  } else {
    pass('signature state recorded', `installer is ${sig} (unsigned builds show a SmartScreen warning; see docs/RELEASING.md)`);
  }
}

// ------------------------------------------------------------------------------------------------ first run, default location
section('First run in the default data location');
const local = path.join(tmp, 'local'); // stands in for %LOCALAPPDATA% (the folder the app uses when nothing else is chosen)
fs.mkdirSync(local, { recursive: true });
const homeEnv = { LOCALAPPDATA: local, XDG_CONFIG_HOME: path.join(local, 'cfg'), APPDATA: path.join(local, 'roaming') };
const shopDir = path.join(local, 'PetraDMS');
const listFiles = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name)) : []);
const installedBefore = listFiles(installDir).length;
const setup = {
  language: 'en',
  business: { name: 'Release Check Traders', nameBn: '', address: 'Sylhet', phone: '01712345678', email: '', taxNo: '', footerNote: '' },
  owner: { displayName: 'Rahim', username: 'rahim', kind: 'pin', secret: '4321' },
  uiMode: 'full'
};
await withApp(appExe, homeEnv, async (page) => {
  const st = (await invoke(page, 'app:status')) as { needsSetup: boolean; appVersion: string; dataDir: string };
  check(st.needsSetup, 'first run: the setup wizard must come first');
  check(path.resolve(st.dataDir) === path.resolve(shopDir), `first run: data folder is ${st.dataDir}, expected ${shopDir}`);
  check(st.appVersion === version, `first run: version ${st.appVersion}`);
  await invoke(page, 'setup:complete', setup);
  await invoke(page, 'settings:save', { taxBp: 500 });
  const supplier = (await invoke(page, 'catalog:supplierSave', { name: 'Release Supplier' })) as { id: number };
  const customer = (await invoke(page, 'customer:save', { name: 'Release Customer', type: 'retail', creditLimit: 0, openingBalance: 12345 })) as { id: number };
  const product = (await invoke(page, 'catalog:productSave', { sku: 'REL-1', name: 'Release Product', baseUnit: 'pcs', priceRetail: 10000, priceWholesale: 9000, priceDealer: 8500 })) as { id: number };
  const today = ((await invoke(page, 'app:status')) as { businessDate: string }).businessDate;
  await invoke(page, 'purchase:save', { supplierId: supplier.id, date: today, lines: [{ productId: product.id, qty: 100, unitCost: 6000 }], paid: 0 });
  await invoke(page, 'sale:save', { date: today, customerId: customer.id, lines: [{ productId: product.id, qty: 10 }], paid: 50000 });
  const cat = ((await invoke(page, 'exp:categories', { includeArchived: false })) as { id: number }[])[0];
  await invoke(page, 'exp:save', { categoryId: cat?.id, amount: 15000, date: today });
});
check(fs.existsSync(path.join(shopDir, 'data', 'petra.db')), `database not created under ${shopDir}`);
check(listFiles(installDir).length === installedBefore, 'the app wrote files into its own (read-only) install folder');
check(!listFiles(installDir).some((f) => /\.(db|db-wal|db-shm|petrabak)$/.test(f)), 'a database file was created in the install folder');
pass('first launch creates the shop in the per-user data folder', shopDir);

/** Reads the shop back through the app and compares it with what was entered. */
const readBack = (label: string, v: string) => withApp(appExe, homeEnv, async (page) => {
  const users = (await invoke(page, 'auth:users')) as { id: number }[];
  await invoke(page, 'auth:login', { userId: users[0]?.id, secret: '4321' });
  const st = (await invoke(page, 'app:status')) as { needsSetup: boolean; appVersion: string; profile: { name: string }; settings: { taxBp: number } };
  check(!st.needsSetup, `${label}: the shop came back asking for setup again`);
  check(st.appVersion === v, `${label}: version is ${st.appVersion}, expected ${v}`);
  check(st.profile.name === 'Release Check Traders', `${label}: business profile lost`);
  check(st.settings.taxBp === 500, `${label}: settings lost`);
  const products = (await invoke(page, 'catalog:products', { includeArchived: false })) as { sku: string; stockQty: number }[];
  check(products.length === 1 && products[0]?.sku === 'REL-1' && products[0]?.stockQty === 90, `${label}: products or stock wrong ${JSON.stringify(products)}`);
  const customers = (await invoke(page, 'customer:list', { includeArchived: false })) as { name: string }[];
  check(customers.some((c) => c.name === 'Release Customer'), `${label}: customer lost`);
  const sales = (await invoke(page, 'sale:list', {})) as unknown[];
  check(sales.length === 1, `${label}: sale lost`);
  await invoke(page, 'auth:logout');
});
await readBack('after restart', version);
const afterStart = smoke(appExe, homeEnv, 'restart');
check(afterStart.integrity === 'ok' && afterStart.counts.sales === 1 && afterStart.counts.products === 1 && afterStart.counts.purchases === 1 && afterStart.counts.suppliers === 1 && afterStart.counts.customers === 1, `restart: counts ${JSON.stringify(afterStart.counts)}`);
pass('data survives closing and reopening', 'products, stock, customer, sale, purchase, settings');

// ------------------------------------------------------------------------------------------------ upgrade A -> B
section(`Upgrade ${version} -> ${versionB}`);
const buildB = spawnSync('pnpm', ['exec', 'electron-builder', '--config', 'electron-builder.yml', ...(win ? ['--win', 'nsis', '--x64'] : ['--dir']), '--publish', 'never', `-c.extraMetadata.version=${versionB}`, '-c.directories.output=release-upgrade'], {
  cwd: desktop, stdio: 'inherit', shell: win, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
});
check(buildB.status === 0, `building version ${versionB} for the upgrade test failed`);
if (win) {
  killApp();
  const installerB = path.join(releaseB, `PetraDMS-Setup-${versionB}.exe`);
  check(fs.existsSync(installerB), `upgrade installer not found: ${installerB}`);
  const r = sh(installerB, ['/S', `/D=${installDir}`]);
  check(r.status === 0, 'installing the newer version over the old one failed');
} else {
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.cpSync(path.join(releaseB, 'linux-unpacked'), installDir, { recursive: true });
}
check(fs.existsSync(appExe), 'the program is missing after the upgrade');
await readBack('after upgrade', versionB);
const afterUpgrade = smoke(appExe, homeEnv, 'upgrade');
check(afterUpgrade.version === versionB && afterUpgrade.integrity === 'ok', `upgrade: version ${afterUpgrade.version}, integrity ${afterUpgrade.integrity}`);
check(afterUpgrade.counts.sales === 1 && afterUpgrade.counts.customers === 1, `upgrade: counts ${JSON.stringify(afterUpgrade.counts)}`);
pass(`upgrade ${version} to ${versionB} keeps everything`, 'same data folder, records, settings');

// ------------------------------------------------------------------------------------------------ uninstall
section('Uninstall keeps the shop data');
if (win) {
  killApp();
  const un = path.join(installDir, 'Uninstall PetraDMS.exe');
  check(fs.existsSync(un), 'uninstaller missing');
  const u = sh(un, ['/S', `_?=${installDir}`]);
  check(u.status === 0, `silent uninstall failed (exit ${u.status}) ${String(u.stdout ?? '')}${String(u.stderr ?? '')}`);
  // the uninstaller can finish its clean-up a moment after it returns
  for (let i = 0; i < 60 && fs.existsSync(appExe); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  check(!fs.existsSync(appExe), `uninstall left the program behind (exit ${u.status}; folder now holds: ${fs.existsSync(installDir) ? fs.readdirSync(installDir).join(', ') : 'nothing'})`);
  check(fs.existsSync(path.join(shopDir, 'data', 'petra.db')), 'uninstall removed the shop data');
  pass('uninstall removes the program and keeps the shop data', shopDir);
} else {
  skip('silent install, executable metadata, shortcuts, uninstall entry, uninstall', `need Windows (this is ${process.platform}); the Windows CI job runs them`);
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(releaseB, { recursive: true, force: true });
const passed = results.filter((r) => r.status === 'pass').length;
console.log(`\nverify:release OK - ${passed} checks passed, ${results.length - passed} skipped on this platform.`);
