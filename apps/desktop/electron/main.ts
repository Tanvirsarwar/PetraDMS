import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  Dispatcher, healthInfo, loadMigrations, migrate, openDatabase, registerCoreServices, registerCatalogServices, registerSalesServices, registerMoneyServices, registerReportServices, registerToolServices, registerSafetyServices, registerDataServices, AutoBackup, createBackup, currentVersion, knownBackupDirs, latestVersion, makeCtx, recordRecovery, recoverIfCorrupt, swapInDatabase, closeDatabase, type Db, type Host
} from '@petra/db';
import { ipcContract, PetraError, type PrintFormat } from '@petra/core';

const defaultRoot = path.join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'PetraDMS');
const pointerFile = path.join(defaultRoot, 'location.json');

/** Data root: PETRA_DATA_DIR (tests, CI) > folder chosen in the setup wizard > %LOCALAPPDATA%\PetraDMS. */
function resolveDataRoot(): string {
  if (process.env.PETRA_DATA_DIR) return path.resolve(process.env.PETRA_DATA_DIR);
  try {
    const p = JSON.parse(fs.readFileSync(pointerFile, 'utf8')) as { dataRoot?: string };
    if (p.dataRoot && fs.existsSync(p.dataRoot)) return p.dataRoot;
  } catch {
    /* no pointer: default location */
  }
  return defaultRoot;
}

let dataRoot = resolveDataRoot();

// Isolated runs also isolate Chromium's profile (localStorage, locks) so tests never share UI prefs.
if (process.env.PETRA_DATA_DIR) app.setPath('userData', path.join(dataRoot, 'electron'));

let db: Db | null = null;
let dispatcher: Dispatcher | null = null;
let autoBackup: AutoBackup | null = null;
let mainWindow: BrowserWindow | null = null;
let savedBounds: Electron.Rectangle | null = null;
let savedMaximised = false;

function ensureDirs(root: string): void {
  for (const d of ['data', 'backups', 'exports', 'invoices', 'logs']) fs.mkdirSync(path.join(root, d), { recursive: true });
}

/** Packaged: SQL ships in resources/migrations (extraResources). Dev: read straight from the repository. */
function migrationsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'migrations') : path.resolve(__dirname, '../../../packages/db/migrations');
}

/** Opens the database and applies any pending migrations. A database that already holds data is backed up first; if that backup fails the upgrade does not run. */
function openAndMigrate(root: string): Db {
  ensureDirs(root);
  const d = openDatabase(path.join(root, 'data', 'petra.db'));
  migrate(d, loadMigrations(migrationsDir()), {
    beforeMigrate: () => {
      createBackup(d, path.join(root, 'backups'), { kind: 'pre-migrate', appVersion: app.getVersion(), now: new Date() });
    }
  });
  return d;
}

/** Plan 12.2: a damaged database is replaced by the newest backup that verifies, before anything else opens it. */
function checkAndRecover(root: string): ReturnType<typeof recoverIfCorrupt> {
  ensureDirs(root);
  return recoverIfCorrupt(root, knownBackupDirs(root), latestVersion(loadMigrations(migrationsDir())), new Date());
}

function recommendedDataDir(): string {
  if (process.platform === 'win32') {
    for (const letter of 'DEFGH') {
      const root = `${letter}:\\`;
      try {
        if (fs.existsSync(root)) return `${root}PetraData`;
      } catch {
        /* drive not readable */
      }
    }
  }
  return defaultRoot;
}

// ===== Printing (plan 11.1): HTML templates rendered in a hidden window, printed or saved as PDF =====
let cachedFontCss: string | null = null;

/** Bundled fonts embedded as base64 so printed pages and PDFs carry Bangla glyphs without any network or system font. */
function fontCss(): string {
  if (cachedFontCss !== null) return cachedFontCss;
  // The same faces as the screen (D23): Nunito for Latin text, Tiro Bangla for Bangla (Noto Serif Bengali for any glyph
  // it lacks), JetBrains Mono for figures. Each covers only its own script; nothing is ever synthesised bold.
  const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+20AC,U+2122,U+2212';
  const BENGALI = 'U+0951-0952,U+0964-0965,U+0980-09FE,U+200C-200D,U+20B9,U+25CC';
  const faces: [string, number, string, string][] = [
    ['Nunito', 400, 'nunito-latin-400-normal.woff2', LATIN],
    ['Nunito', 600, 'nunito-latin-600-normal.woff2', LATIN],
    ['Tiro Bangla', 400, 'tiro-bangla-bengali-400-normal.woff2', BENGALI],
    ['Noto Serif Bengali', 400, 'noto-serif-bengali-bengali-400-normal.woff2', BENGALI],
    ['JetBrains Mono', 400, 'jetbrains-mono-latin-400-normal.woff2', LATIN],
    ['JetBrains Mono', 500, 'jetbrains-mono-latin-500-normal.woff2', LATIN]
  ];
  cachedFontCss = faces
    .map(([family, weight, file, range]) => {
      try {
        const b64 = fs.readFileSync(path.join(__dirname, 'fonts', file)).toString('base64');
        return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}`;
      } catch {
        return '';
      }
    })
    .join('');
  return cachedFontCss;
}

const PAGE_MM: Record<PrintFormat, number> = { a4: 210, thermal80: 80, thermal58: 58 };

async function withPrintWindow<T>(html: string, fn: (w: BrowserWindow) => Promise<T>): Promise<T> {
  const tmp = path.join(os.tmpdir(), `petra-print-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    return await fn(w);
  } catch (e) {
    if (e instanceof PetraError) throw e;
    throw new PetraError('IO_FAILED', e instanceof Error ? e.message : String(e));
  } finally {
    w.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

/** Thermal rolls have no fixed height: measure the rendered content and size the page to it. */
async function contentHeightPx(w: BrowserWindow): Promise<number> {
  return Number(await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')) || 600;
}

const printHost = {
  fontCss,
  async printHtml(html: string, o: { format: PrintFormat; silent: boolean; printerName: string }): Promise<void> {
    await withPrintWindow(html, async (w) => {
      const pageSize = o.format === 'a4' ? 'A4' : { width: PAGE_MM[o.format] * 1000, height: Math.max(100_000, Math.round((await contentHeightPx(w)) * 264.58) + 10_000) };
      await new Promise<void>((resolve, reject) => {
        w.webContents.print({ silent: o.silent, deviceName: o.printerName || undefined, printBackground: true, pageSize }, (success, reason) =>
          success || reason === 'cancelled' ? resolve() : reject(new PetraError('IO_FAILED', `print failed: ${reason}`)));
      });
    });
  },
  async pdfHtml(html: string, o: { format: PrintFormat; file: string }): Promise<void> {
    const pdf = await withPrintWindow(html, async (w) => {
      if (o.format === 'a4') return w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
      const h = await contentHeightPx(w);
      return w.webContents.printToPDF({ pageSize: { width: PAGE_MM[o.format] / 25.4, height: Math.max(3, h / 96 + 0.2) }, margins: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 }, printBackground: true });
    });
    fs.mkdirSync(path.dirname(o.file), { recursive: true });
    fs.writeFileSync(o.file, pdf);
  },
  reveal(file: string): void {
    // Automated runs set PETRA_NO_REVEAL: on a headless Linux machine this hands the folder to xdg-open, and the child it
    // starts can keep the program from exiting. A failure to open a folder window must never affect saving the file.
    if (process.env.PETRA_NO_REVEAL === '1') return;
    try {
      shell.showItemInFolder(file);
    } catch {
      /* the file is saved; showing it is a courtesy */
    }
  },
  async pickBackupFile(): Promise<string | null> {
    const r = await dialog.showOpenDialog(mainWindow ?? undefined!, { properties: ['openFile'], filters: [{ name: 'PetraDMS backup', extensions: ['petrabak'] }] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  async restoreDatabase(file: string): Promise<void> {
    if (db) closeDatabase(db);
    db = null;
    swapInDatabase(dataRoot, file);
    db = openAndMigrate(dataRoot);
    dispatcher?.swapDb(db);
  },
  async resetDatabase(): Promise<void> {
    if (db) closeDatabase(db);
    db = null;
    const file = path.join(dataRoot, 'data', 'petra.db');
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    db = openAndMigrate(dataRoot);
    dispatcher?.swapDb(db);
  },
  async setCompact(on: boolean): Promise<void> {
    const w = mainWindow;
    if (!w || w.isDestroyed()) return;
    if (on === (savedBounds !== null)) return;
    const tween = async (to: Electron.Rectangle): Promise<void> => {
      const from = w.getBounds();
      const steps = process.env.PETRA_NO_MOTION ? 1 : 12;
      for (let i = 1; i <= steps; i++) {
        const k = 1 - Math.pow(1 - i / steps, 3);
        w.setBounds({ x: Math.round(from.x + (to.x - from.x) * k), y: Math.round(from.y + (to.y - from.y) * k), width: Math.round(from.width + (to.width - from.width) * k), height: Math.round(from.height + (to.height - from.height) * k) });
        if (steps > 1) await new Promise((r) => setTimeout(r, 20));
      }
    };
    if (on) {
      savedBounds = w.getBounds();
      savedMaximised = w.isMaximized();
      if (savedMaximised) w.unmaximize();
      w.setMinimumSize(320, 360);
      const area = screen.getDisplayMatching(w.getBounds()).workArea;
      const width = 360;
      const height = 520;
      w.setAlwaysOnTop(true, 'floating');
      await tween({ x: area.x + area.width - width - 16, y: area.y + area.height - height - 16, width, height });
    } else {
      const back = savedBounds!;
      savedBounds = null;
      w.setAlwaysOnTop(false);
      await tween(back);
      w.setMinimumSize(1024, 640);
      if (savedMaximised) w.maximize();
    }
  }
};

const host: Host = {
  ...printHost,
  appVersion: app.getVersion(),
  get dataDir() {
    return dataRoot;
  },
  health: () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    nodeVersion: process.versions.node,
    ...healthInfo(db as Db),
    packaged: app.isPackaged,
    dataDir: dataRoot
  }),
  recommendedDataDir,
  async pickDataDir() {
    const r = await dialog.showOpenDialog(mainWindow ?? undefined!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  async applyDataDir(target) {
    const root = path.resolve(target);
    ensureDirs(root);
    const oldRoot = dataRoot;
    if (root === oldRoot) return;
    if (db) closeDatabase(db);
    // The database being left behind is brand new (this is only allowed during first-run setup): remove it.
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(path.join(oldRoot, 'data', `petra.db${ext}`), { force: true });
    fs.mkdirSync(defaultRoot, { recursive: true });
    fs.writeFileSync(pointerFile, JSON.stringify({ dataRoot: root }));
    dataRoot = root;
    db = openAndMigrate(root);
    dispatcher?.swapDb(db);
  }
};

function registerIpc(d: Dispatcher): void {
  ipcMain.handle('petra:invoke', async (event, channel: unknown, raw: unknown) => {
    const url = event.senderFrame?.url ?? '';
    if (!url.startsWith('file://') && (app.isPackaged || !url.startsWith('http://localhost:'))) throw new Error('untrusted sender');
    if (typeof channel !== 'string' || !(channel in ipcContract)) throw new Error('unknown channel');
    return d.call(channel, raw);
  });
}

/** The app makes zero network requests: block everything except local file/devtools targets. */
function blockNetwork(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const local = url.startsWith('file://') || url.startsWith('devtools://') || url.startsWith('data:') || url.startsWith('blob:') ||
      (!app.isPackaged && url.startsWith('http://localhost:'));
    if (!local) console.error('[net-blocked]', url);
    callback({ cancel: !local });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#F1F5F9',
    title: 'PetraDMS',
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && (app.isPackaged || !url.startsWith('http://localhost:'))) e.preventDefault();
  });
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.petra.dms');
    let recovered: ReturnType<typeof recoverIfCorrupt> = { state: 'ok' };
    try {
      recovered = checkAndRecover(dataRoot);
      db = openAndMigrate(dataRoot);
    } catch (e) {
      const code = e instanceof PetraError ? e.code : 'UNKNOWN';
      const msg = code === 'DB_CORRUPT'
        ? 'The data file is damaged and no usable backup was found.\nYour data has not been changed. Please contact support before doing anything else.\n\n'
        : code === 'DB_NEWER'
          ? 'This data was made by a newer version of PetraDMS. Install the latest version.\n\n'
          : 'PetraDMS could not open its data safely.\nNothing has been changed.\n\n';
      dialog.showErrorBox('PetraDMS', `${msg}${e instanceof Error ? e.message : String(e)}\n\nData folder: ${dataRoot}`);
      app.exit(1);
      return;
    }
    dispatcher = new Dispatcher(db, host);
    registerCoreServices(dispatcher);
    registerCatalogServices(dispatcher);
    registerSalesServices(dispatcher);
    registerMoneyServices(dispatcher);
    registerReportServices(dispatcher);
    registerToolServices(dispatcher);
    registerSafetyServices(dispatcher, () => autoBackup);
    registerDataServices(dispatcher);
    autoBackup = new AutoBackup(dispatcher);
    if (recovered.state === 'recovered') {
      const c = makeCtx(db, null, () => new Date().toISOString());
      recordRecovery(c, { at: new Date().toISOString(), backupAt: recovered.manifest.createdAt, backupKind: recovered.manifest.kind }, `restored ${path.basename(recovered.backupFile)}; damaged file kept as ${recovered.corruptFile}`);
    }
    blockNetwork();
    registerIpc(dispatcher);
    if (process.argv.includes('--smoke-test')) {
      // Installer smoke test: prove the packaged app opens node:sqlite in WAL mode, applied its migrations, and exits.
      const h = healthInfo(db);
      const out = process.env.PETRA_SMOKE_OUT;
      const tables = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
      const ok = h.journalMode === 'wal' && h.integrity === 'ok' && app.isPackaged && tables > 20;
      const count = (t: string): number => (db?.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      if (out) {
        fs.writeFileSync(out, JSON.stringify({
          ok, packaged: app.isPackaged, tables, ...h, version: app.getVersion(), schema: currentVersion(db as Db),
          counts: { products: count('products'), customers: count('customers'), suppliers: count('suppliers'), sales: count('sales'), purchases: count('purchases'), users: count('users') },
          dataDir: dataRoot
        }));
      }
      closeDatabase(db);
      db = null;
      app.exit(ok ? 0 : 1);
      return;
    }
    createWindow();
    // Every minute: back up if data changed and the interval has passed (a backup is skipped when nothing changed).
    setInterval(() => {
      try {
        autoBackup?.tick();
      } catch {
        /* logged by the backup itself */
      }
    }, 60_000).unref();
  });

  // Closing the window fires window-all-closed; app.quit() (shutdown, installer, tests) fires before-quit and will-quit instead.
  // Both paths make the closing backup; AutoBackup does it only once and only if data changed.
  const finish = (): void => {
    try {
      autoBackup?.onClose();
    } catch {
      /* the failure is in the log; closing must not hang */
    }
    if (db) closeDatabase(db);
    db = null;
  };
  app.on('before-quit', finish);
  app.on('window-all-closed', () => {
    finish();
    app.quit();
  });
}
