import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_PRODUCTS } from './demoCatalog';
import { readZipFile } from './app';
import { expectIntegrity, fail, makeApp, ok, setupWithUsers, type App } from './testApp';

let app: App | undefined;
const dirs: string[] = [];
afterEach(() => {
  try { app?.close(); } catch { /* closed by the test */ }
  app = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-data-'));
  dirs.push(dir);
  app = makeApp(undefined, { dataDir: dir });
  const users = await setupWithUsers(app.d);
  return { dir, d: app.d, users };
}
const PRODUCT_CSV = [
  'SKU,Name,Category,Brand,Retail,Cost,Stock,Barcode',
  'A-1,Milk A,Dairy,Marks,"1,250.50",1000,10,8901',
  'A-2,Milk B,Dairy,Marks,640,500,0,8902',
  ',No sku,Dairy,Marks,10,,,',
  'A-1,Duplicate in file,Dairy,Marks,5,,,',
  'A-3,Bad price,Dairy,Marks,abc,,,',
  'A-4,Bad stock,Dairy,Marks,50,,5,',
  'A-5,Fine,Tea,Ispahani,৳ 99,,,8903'
].join('\r\n');
const mapOf = (m: Record<string, number | null>) => m;

describe('import products', () => {
  it('previews good and bad rows with the reason for each, without writing anything', async () => {
    const { d } = await start();
    const p = await ok(d, 'import:preview', { kind: 'products', text: PRODUCT_CSV });
    expect(p.mappingIssues).toEqual([]);
    expect(p.total).toBe(7);
    expect(p.good).toBe(3);
    expect(p.bad).toBe(4);
    const why = Object.fromEntries(p.rows.filter((r) => !r.ok).map((r) => [r.line, r.issues.map((i) => `${i.field}:${i.code}`)]));
    expect(why[4]).toEqual(['sku:required']);
    expect(why[5]).toEqual(['sku:dupInFile']);
    expect(why[6]).toEqual(['priceRetail:number']);
    expect(why[7]).toEqual(['openingCost:required']);
    expect((await ok(d, 'catalog:products', { includeArchived: true })).length).toBe(0);
  });

  it('a dry run does the real work and rolls it back; the real run keeps only the good rows', async () => {
    const { d } = await start();
    const input = { kind: 'products' as const, text: PRODUCT_CSV, mapping: (await ok(d, 'import:preview', { kind: 'products', text: PRODUCT_CSV })).mapping, skipBad: true };
    const dry = await ok(d, 'import:run', { ...input, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, created: 3, skipped: 4, newCategories: 2, newBrands: 2, stockLines: 1 });
    expect((await ok(d, 'catalog:products', { includeArchived: true })).length).toBe(0);
    expect((await ok(d, 'catalog:lookups')).categories.length).toBe(0);

    const real = await ok(d, 'import:run', { ...input, dryRun: false });
    expect(real).toMatchObject({ dryRun: false, created: 3, skipped: 4, newCategories: 2, newBrands: 2, stockLines: 1 });
    const list = await ok(d, 'catalog:products', { includeArchived: false });
    expect(list.map((p) => p.sku).sort()).toEqual(['A-1', 'A-2', 'A-5']);
    const a1 = list.find((p) => p.sku === 'A-1')!;
    expect(a1.priceRetail).toBe(125050);
    expect(a1.stockQty).toBe(10);
    expect(a1.barcodes).toEqual(['8901']);
    expect(list.find((p) => p.sku === 'A-5')!.priceRetail).toBe(9900);
    expectIntegrity(app!);
  });

  it('refuses everything when asked not to skip bad rows', async () => {
    const { d } = await start();
    const m = (await ok(d, 'import:preview', { kind: 'products', text: PRODUCT_CSV })).mapping;
    expect(await fail(d, 'import:run', { kind: 'products', text: PRODUCT_CSV, mapping: m, dryRun: false, skipBad: false })).toBe('IMPORT_HAS_ERRORS');
    expect((await ok(d, 'catalog:products', { includeArchived: true })).length).toBe(0);
  });

  it('a second import of the same file creates nothing and says every SKU exists', async () => {
    const { d } = await start();
    const m = (await ok(d, 'import:preview', { kind: 'products', text: PRODUCT_CSV })).mapping;
    await ok(d, 'import:run', { kind: 'products', text: PRODUCT_CSV, mapping: m, dryRun: false, skipBad: true });
    const again = await ok(d, 'import:run', { kind: 'products', text: PRODUCT_CSV, mapping: m, dryRun: false, skipBad: true });
    expect(again.created).toBe(0);
    const p = await ok(d, 'import:preview', { kind: 'products', text: PRODUCT_CSV });
    expect(p.rows.filter((r) => r.issues.some((i) => i.code === 'skuExists')).length).toBe(4);
    expect(p.rows.filter((r) => r.issues.some((i) => i.code === 'barcodeExists')).length).toBe(3);
  });

  it('a column mapping the owner changed by hand is honoured, and a bad mapping stops the import', async () => {
    const { d } = await start();
    const text = 'Item,Code,Price\nMilk,S-1,50\n';
    const auto = await ok(d, 'import:preview', { kind: 'products', text });
    expect(auto.mapping.sku).toBe(1);
    expect(auto.mapping.name).toBe(0);
    const swapped = await ok(d, 'import:preview', { kind: 'products', text, mapping: mapOf({ ...auto.mapping, sku: 0, name: 1 }) });
    expect(swapped.good).toBe(1);
    const broken = await ok(d, 'import:preview', { kind: 'products', text, mapping: mapOf({ ...auto.mapping, sku: null }) });
    expect(broken.mappingIssues).toEqual([{ field: 'sku', code: 'missingColumn' }]);
    expect(await fail(d, 'import:run', { kind: 'products', text, mapping: mapOf({ ...auto.mapping, sku: null }), dryRun: false, skipBad: true })).toBe('IMPORT_INVALID');
  });

  it('rejects empty and oversized files, and the rejects file lists each bad row with its problem', async () => {
    const { d, dir } = await start();
    expect(await fail(d, 'import:preview', { kind: 'products', text: '' })).toBe('IMPORT_INVALID');
    const huge = `sku,name\n${Array.from({ length: 20_001 }, (_, i) => `S${i},N${i}`).join('\n')}`;
    expect(await fail(d, 'import:preview', { kind: 'products', text: huge })).toBe('IMPORT_INVALID');
    const r = await ok(d, 'import:rejects', { kind: 'products', text: PRODUCT_CSV, problemHeader: 'Problem', messages: { required: 'is required', number: 'is not a number' } });
    const csv = fs.readFileSync(r.path, 'utf8');
    expect(r.path.startsWith(path.join(dir, 'exports'))).toBe(true);
    expect(csv.split('\r\n')[0]).toBe('﻿SKU,Name,Category,Brand,Retail,Cost,Stock,Barcode,Problem');
    expect(csv).toContain('sku: is required');
    expect(csv).toContain('priceRetail: is not a number');
    expect(csv.trim().split('\r\n').length).toBe(1 + 4);
  });

  it('a formula typed into a cell is kept as text in the rejects file', async () => {
    const { d } = await start();
    const r = await ok(d, 'import:rejects', { kind: 'products', text: 'sku,name\n,=HYPERLINK("x")\n', problemHeader: 'Problem', messages: {} });
    expect(fs.readFileSync(r.path, 'utf8')).toContain("'=HYPERLINK");
  });
});

describe('import customers and dues', () => {
  const CUSTOMERS = [
    'Name,Phone,Area,Type,Credit limit,Opening due,Opening date',
    'Rahman Store,01711111111,Zindabazar,retail,20000,3500,01/10/2026',
    'Karim Traders,+880 1722-222222,Ambarkhana,পাইকারি,50000,,',
    'Bad Phone,123,,,,,',
    'Same Phone,01711111111,,,,,',
    'Bad Type,,,vip,,,',
    'Bad Date,,,,,10,31/02/2026'
  ].join('\n');

  it('imports shops with areas, tidy phones and opening dues that balance', async () => {
    const { d } = await start();
    const m = (await ok(d, 'import:preview', { kind: 'customers', text: CUSTOMERS })).mapping;
    const p = await ok(d, 'import:preview', { kind: 'customers', text: CUSTOMERS });
    expect(p).toMatchObject({ total: 6, good: 2, bad: 4 });
    const res = await ok(d, 'import:run', { kind: 'customers', text: CUSTOMERS, mapping: m, dryRun: false, skipBad: true });
    expect(res).toMatchObject({ created: 2, skipped: 4, newAreas: 2, duesPosted: 1 });
    const list = await ok(d, 'customer:list', { includeArchived: false });
    const r = list.find((c) => c.name === 'Rahman Store')!;
    expect(r.balance).toBe(350000);
    expect(list.find((c) => c.name === 'Karim Traders')).toMatchObject({ phone: '01722222222', type: 'wholesale' });
    expectIntegrity(app!);
  });

  it('posts opening dues onto existing customers and suppliers, by phone or by name', async () => {
    const { d } = await start();
    const sup = await ok(d, 'catalog:supplierSave', { name: 'Marks Dist' });
    void sup;
    const m0 = (await ok(d, 'import:preview', { kind: 'customers', text: CUSTOMERS })).mapping;
    await ok(d, 'import:run', { kind: 'customers', text: CUSTOMERS, mapping: m0, dryRun: false, skipBad: true });
    const DUES = [
      'Party,Name,Phone,Amount,Date',
      'customer,,01722222222,"1,200",',
      'customer,rahman store,,৳ 300.50,2026-10-02',
      'supplier,Marks Dist,,9000,',
      'supplier,Nobody,,10,',
      'customer,Rahman Store,01799999999,10,',
      'customer,,,10,',
      'both,Rahman Store,,10,',
      'customer,Rahman Store,,0,'
    ].join('\n');
    const prev = await ok(d, 'import:preview', { kind: 'dues', text: DUES });
    expect(prev).toMatchObject({ good: 3, bad: 5 });
    const why = Object.fromEntries(prev.rows.filter((r) => !r.ok).map((r) => [r.line, r.issues[0]!.code]));
    expect(why).toMatchObject({ 5: 'partyNotFound', 7: 'nameOrPhone', 8: 'choice', 9: 'zero' });
    const res = await ok(d, 'import:run', { kind: 'dues', text: DUES, mapping: prev.mapping, dryRun: false, skipBad: true });
    expect(res).toMatchObject({ created: 3, duesPosted: 3 });
    const list = await ok(d, 'customer:list', { includeArchived: false });
    expect(list.find((c) => c.name === 'Karim Traders')!.balance).toBe(120000);
    expect(list.find((c) => c.name === 'Rahman Store')!.balance).toBe(350000 + 30050);
    expectIntegrity(app!);
  });

  it('staff cannot import or export', async () => {
    const { d, users } = await start();
    const { signInAs } = await import('./testApp');
    await signInAs(d, users.staff, 'staff');
    expect(await fail(d, 'import:preview', { kind: 'customers', text: CUSTOMERS })).toBe('PERMISSION');
    expect(await fail(d, 'export:all')).toBe('PERMISSION');
    expect(await fail(d, 'demo:load')).toBe('PERMISSION');
  });
});

describe('export everything', () => {
  it('writes spreadsheets, every table and a restorable database, and never users secrets', async () => {
    const { d, dir } = await start();
    const m = (await ok(d, 'import:preview', { kind: 'products', text: PRODUCT_CSV })).mapping;
    await ok(d, 'import:run', { kind: 'products', text: PRODUCT_CSV, mapping: m, dryRun: false, skipBad: true });
    const r = await ok(d, 'export:all');
    expect(r.path.startsWith(path.join(dir, 'exports'))).toBe(true);
    expect(fs.existsSync(`${r.path}.part`)).toBe(false);
    const names = ['README.txt', 'spreadsheets/products.csv', 'spreadsheets/customers.csv', 'spreadsheets/sales.csv', 'raw/products.csv', 'raw/stock_movements.csv', 'raw/users.csv'];
    const z = readZipFile(r.path, names);
    for (const n of names) expect(z.names).toContain(n);
    expect(z.names.some((n) => /^database\/PetraDMS-.*\.petrabak$/.test(n))).toBe(true);
    expect(z.names).not.toContain('raw/license_state.csv');
    expect(z.names).not.toContain('raw/app_log.csv');
    const prod = z.files.get('spreadsheets/products.csv')!.toString('utf8');
    expect(prod).toContain('A-1,Milk A,');
    expect(prod).toContain('1250.50');
    const users = z.files.get('raw/users.csv')!.toString('utf8');
    expect(users.split('\r\n')[0]).toBe('﻿id,username,display_name,role,active,created_at');
    expect(users).not.toMatch(/pin|hash|\$/i);
    expect(r.files).toBe(z.names.length);
  });
});

describe('demo mode', () => {
  it('loads sample data into an empty shop, keeps the books balanced, and clearing restores the empty shop', async () => {
    const { d } = await start();
    expect((await ok(d, 'app:status')).demo).toBe(false);
    await ok(d, 'demo:load');
    expect((await ok(d, 'app:status')).demo).toBe(true);
    const products = await ok(d, 'catalog:products', { includeArchived: false });
    expect(products.length).toBe(DEMO_PRODUCTS.length);
    expect(products.some((p) => p.sku === 'MARKS-PM-500G')).toBe(true);
    expect((await ok(d, 'customer:list', { includeArchived: false })).length).toBe(8);
    expect((await ok(d, 'sale:list', { from: '2020-01-01', to: '2030-01-01' })).length).toBeGreaterThan(10);
    expectIntegrity(app!);
    expect(await fail(d, 'demo:load')).toBe('DEMO_UNAVAILABLE');

    await ok(d, 'demo:clear', { confirm: 'DEMO' });
    await ok(d, 'auth:login', { userId: 1, secret: '4321' });
    expect((await ok(d, 'app:status')).demo).toBe(false);
    expect((await ok(d, 'catalog:products', { includeArchived: true })).length).toBe(0);
    expect((await ok(d, 'customer:list', { includeArchived: true })).length).toBe(0);
    expectIntegrity(app!);
  });

  it('refuses demo data in a shop that already has records, and clear when demo is off', async () => {
    const { d } = await start();
    await ok(d, 'import:run', { kind: 'customers', text: 'name\nReal Shop\n', mapping: { name: 0 }, dryRun: false, skipBad: true });
    expect(await fail(d, 'demo:load')).toBe('DEMO_UNAVAILABLE');
    expect(await fail(d, 'demo:clear', { confirm: 'DEMO' })).toBe('DEMO_UNAVAILABLE');
    expect(await fail(d, 'demo:clear', { confirm: 'nope' })).toBe('INVALID_INPUT');
  });
});

describe('Petra Break scores', () => {
  it('keeps the ten best scores with the player name, ignores a zero score, rejects nonsense', async () => {
    const { d } = await start();
    await ok(d, 'auth:login', { userId: 1, secret: '4321' });
    expect(await ok(d, 'game:scores')).toEqual([]);
    for (const score of [120, 0, 50, 900, 10, 20, 30, 40, 60, 70, 80, 90]) await ok(d, 'game:submit', { score });
    const top = await ok(d, 'game:scores');
    expect(top.map((s) => s.score)).toEqual([900, 120, 90, 80, 70, 60, 50, 40, 30, 20]);
    expect(top[0]?.player).toBeTruthy();
    expect(await fail(d, 'game:submit', { score: -1 })).toBe('INVALID_INPUT');
    expect(await fail(d, 'game:submit', { score: 1.5 })).toBe('INVALID_INPUT');
    expect(await fail(d, 'game:submit', { score: 2_000_000 })).toBe('INVALID_INPUT');
    expectIntegrity(app!);
  });
});
