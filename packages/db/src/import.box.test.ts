import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoMap, checkRow, templateRows } from '@petra/core';
import { expectIntegrity, makeApp, ok, setupWithUsers, type App } from './testApp';
import { scalar } from './sql';

let app: App | undefined;
const dirs: string[] = [];
afterEach(() => {
  try { app?.close(); } catch { /* closed */ }
  app = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-imp-'));
  dirs.push(dir);
  app = makeApp(undefined, { dataDir: dir });
  await setupWithUsers(app.d);
  return app.d;
}

const PRODUCTS = [
  'SKU,Name,Brand,Retail,Pcs per box,Box retail,Default sale unit,Default purchase unit,Company,Opening box,Opening pcs,Opening cost per box',
  'BX-1,Marks Milk 25g,Marks,55,24,1300,box,box,Marks Ltd,2,5,1000',
  'BX-2,Tea 50g,Ispahani,40,12,,pcs,box,Ispahani Ltd,0,0,',
  'BX-3,Bad box,Marks,10,1,,,,,,,',
  'BX-4,Box without size,Marks,10,,500,,,,,,',
  'BX-5,Stock without cost,Marks,10,24,,,,,1,0,'
].join('\r\n');

describe('product import with boxes', () => {
  it('reads box columns, checks them, and the template lists them', () => {
    const headers = PRODUCTS.split('\r\n')[0]!.split(',');
    const m = autoMap('products', headers);
    expect(m.pcsPerBox).toBe(4);
    expect(m.supplier).toBe(8);
    expect(m.brand).toBe(2);
    const row = (line: number) => checkRow('products', PRODUCTS.split('\r\n')[line]!.split(','), m);
    expect(row(1).issues).toEqual([]);
    expect(row(1).value).toMatchObject({ pcsPerBox: 24, boxName: 'Box', boxRetail: 130_000, defaultSaleUnit: 'box', supplier: 'Marks Ltd', openingBox: 2, openingPcs: 5, openingCostPerBox: 100_000 });
    expect(row(3).issues).toEqual([{ field: 'pcsPerBox', code: 'boxSize' }]);
    expect(row(4).issues).toEqual([{ field: 'pcsPerBox', code: 'required' }]);
    expect(row(5).issues).toEqual([{ field: 'openingCostPerBox', code: 'required' }]);
    expect(templateRows('products')[0]).toEqual(expect.arrayContaining(['pcsPerBox', 'boxRetail', 'defaultSaleUnit', 'supplier', 'openingBox', 'openingPcs', 'openingCostPerBox']));
  });

  it('imports boxes, prices, default units, links the company and enters opening stock in box + pcs at an exact value', async () => {
    const d = await start();
    const m = (await ok(d, 'import:preview', { kind: 'products', text: PRODUCTS })).mapping;
    const dry = await ok(d, 'import:run', { kind: 'products', text: PRODUCTS, mapping: m, dryRun: true, skipBad: true });
    expect(dry).toMatchObject({ created: 2, skipped: 3, newSuppliers: 2, stockLines: 1 });
    expect((await ok(d, 'catalog:products', { includeArchived: true })).length).toBe(0);
    const real = await ok(d, 'import:run', { kind: 'products', text: PRODUCTS, mapping: m, dryRun: false, skipBad: true });
    expect(real.created).toBe(2);
    const list = await ok(d, 'catalog:products', { includeArchived: false });
    const milk = list.find((p) => p.sku === 'BX-1')!;
    const box = milk.packs.find((k) => k.factor === 24)!;
    expect(box).toMatchObject({ name: 'Box', priceRetail: 130_000 });
    expect(milk.defaultSalePackId).toBe(box.id);
    expect(milk.stockQty).toBe(53);
    // 2 boxes x 1,000 + 5 pcs x (1,000 / 24) = 2,000 + 208.33
    expect(milk.stockValue).toBe(200_000 + 20_833);
    const tea = list.find((p) => p.sku === 'BX-2')!;
    expect(tea.defaultSalePackId).toBeNull();
    expect(tea.defaultPurchasePackId).toBe(tea.packs.find((k) => k.factor === 12)!.id);
    const sups = await ok(d, 'catalog:suppliers', { includeArchived: false });
    const marks = sups.find((s) => s.name === 'Marks Ltd')!;
    expect((await ok(d, 'supplier:products', { supplierId: marks.id })).map((l) => l.productId)).toEqual([milk.id]);
    expectIntegrity(app!);
  });
});

describe('company invoice import', () => {
  it('turns rows into one purchase per company invoice, skips a whole invoice when one row is bad, and dry-runs exactly', async () => {
    const d = await start();
    const sup = await ok(d, 'catalog:supplierSave', { name: 'Marks Ltd' });
    const p1 = await ok(d, 'catalog:productSave', { sku: 'M-1', name: 'Milk', baseUnit: 'pcs', priceRetail: 55, priceWholesale: 50, priceDealer: 48, packs: [{ name: 'Box', factor: 24 }] });
    await ok(d, 'catalog:productSave', { sku: 'M-2', name: 'Tea', baseUnit: 'pcs', priceRetail: 40, priceWholesale: 38, priceDealer: 36 });
    const csv = [
      'Company,Invoice no,Date,SKU,Box,Pcs,Cost,Discount',
      'Marks Ltd,MK-1,2026-10-01,M-1,5,6,1200,0',
      'Marks Ltd,MK-1,2026-10-01,M-2,0,30,10,5',
      'Marks Ltd,MK-2,2026-10-01,M-1,1,0,1200,',
      'Marks Ltd,MK-2,2026-10-01,NOPE,1,0,1200,',
      'Unknown Co,X-9,2026-10-01,M-1,1,0,10,',
      'Marks Ltd,MK-3,2026-10-01,M-2,2,0,10,'
    ].join('\r\n');
    const pv = await ok(d, 'import:preview', { kind: 'purchases', text: csv });
    expect(pv.mappingIssues).toEqual([]);
    expect(pv.bad).toBe(3); // unknown product, unknown company, a box for a product without a box
    const dry = await ok(d, 'import:run', { kind: 'purchases', text: csv, mapping: pv.mapping, dryRun: true, skipBad: true });
    expect(dry).toMatchObject({ purchasesPosted: 1, created: 2 });
    expect(dry.failed.map((f) => [f.line, f.issues.map((x) => x.code)])).toEqual([
      [4, ['invoiceHasErrors']], [5, ['productNotFound']], [6, ['partyNotFound']], [7, ['noBox']]
    ]);
    expect(scalar(app!.d.db, 'SELECT COUNT(*) FROM purchases')).toBe(0);
    const real = await ok(d, 'import:run', { kind: 'purchases', text: csv, mapping: pv.mapping, dryRun: false, skipBad: true });
    expect(real.purchasesPosted).toBe(1);
    const list = await ok(d, 'purchase:list', {});
    expect(list).toHaveLength(1);
    const pur = await ok(d, 'purchase:get', { id: list[0]!.id });
    expect(pur).toMatchObject({ supplierId: sup.id, supplierRef: 'MK-1', paid: 0 });
    // 5 x 1,200 + 6 x 50 = 6,300 ; 30 pcs x 10 - 5 = 295
    expect(pur.total).toBe(630_000 + 29_500);
    expect(pur.items[0]).toMatchObject({ productId: p1.id, qty: 5, looseQty: 6, baseQty: 126 });
    // importing the same invoice again is refused row by row
    const again = await ok(d, 'import:preview', { kind: 'purchases', text: csv });
    expect(again.rows.filter((r) => r.issues.some((x) => x.code === 'invoiceExists')).length).toBe(2);
    expectIntegrity(app!);
  });
});
