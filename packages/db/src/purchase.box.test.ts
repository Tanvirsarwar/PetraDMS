import { describe, it, expect } from 'vitest';
import { PetraError } from '@petra/core';
import { createTestWorld } from './testkit';
import { buildSimWorld } from './sim';
import { checkIntegrity, formatViolations } from './integrity';
import { postPurchase, postPurchaseReturn, voidPurchase, voidPurchaseReturn } from './purchases';
import { linkProducts, setSupplierProduct, unlinkProducts, supplierProductRows } from './supplierProducts';
import { applyPrices, clearPurchaseDraft, linkSelection, loadPurchaseDraft, priceSuggestions, savePurchaseDraft } from './app/boxApp';
import { setProductDefaults, createBrand, createProduct } from './masters';
import { all, get, scalar } from './sql';

function setup() {
  const world = createTestWorld();
  const w = buildSimWorld(world.ctx, world.managerId);
  const tea = w.products[1] as number; // Carton = 20 pcs
  const carton = (w.packs.get(tea) as number[])[1] as number;
  return { world, w, ctx: world.ctx, tea, carton, sup: w.suppliers[0] as number };
}
const sound = (db: Parameters<typeof checkIntegrity>[0]) => expect(formatViolations(checkIntegrity(db))).toBe('');
const code = (fn: () => unknown): string => {
  try { fn(); } catch (e) { if (e instanceof PetraError) return e.code; throw e; }
  return 'NO_ERROR';
};
const stock = (ctx: ReturnType<typeof setup>['ctx'], id: number) => get<{ stock_qty: number; stock_value: number; last_cost: number }>(ctx.db, 'SELECT stock_qty, stock_value, last_cost FROM products WHERE id = ?', id);

describe('purchase with box + pcs', () => {
  it('"5 Box + 6 Pcs" posts 106 pieces and a line amount that is boxes x cost + the pieces share', () => {
    const { ctx, tea, carton, sup } = setup();
    const r = postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 5, looseQty: 6, unitCost: 800_000 }], paid: 0 });
    expect(r.total).toBe(4_240_000); // 5 x 800,000 + 6 x 40,000
    expect(stock(ctx, tea)).toMatchObject({ stock_qty: 106, stock_value: 4_240_000 });
    expect(get(ctx.db, 'SELECT qty, loose_qty, base_qty, factor, pack_name, amount FROM purchase_items WHERE purchase_id = ?', r.id)).toEqual({ qty: 5, loose_qty: 6, base_qty: 106, factor: 20, pack_name: 'Carton', amount: 4_240_000 });
    expect(get<{ balance: number }>(ctx.db, 'SELECT balance FROM suppliers WHERE id = ?', sup)?.balance).toBe(500_000 * 0 + 4_240_000 + (get<{ b: number }>(ctx.db, "SELECT COALESCE(SUM(amount),0) AS b FROM party_ledger WHERE party_kind='supplier' AND party_id=? AND entry_kind='opening'", sup)?.b ?? 0));
    sound(ctx.db);
  });

  it('pieces alone are stored on the base pack; the line amount is exact, not per-piece x qty', () => {
    const { ctx, tea, carton, sup } = setup();
    const r = postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 0, looseQty: 7, unitCost: 800_001 }], paid: 0 });
    // 800001 * 7 / 20 = 280000.35 -> 280000
    expect(r.total).toBe(280_000);
    expect(get(ctx.db, 'SELECT pack_name, factor, qty, loose_qty, base_qty, amount, unit_cost FROM purchase_items WHERE purchase_id = ?', r.id)).toEqual({ pack_name: 'pcs', factor: 1, qty: 7, loose_qty: 0, base_qty: 7, amount: 280_000, unit_cost: 40_000 });
    expect(stock(ctx, tea)).toMatchObject({ stock_qty: 7, stock_value: 280_000 });
    sound(ctx.db);
  });

  it('30 loose pieces and 1 box + 10 pieces are the same stock and the same money', () => {
    const { ctx, tea, carton, sup } = setup();
    const a = postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 0, looseQty: 30, unitCost: 800_003 }], paid: 0 });
    const b = postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 1, looseQty: 10, unitCost: 800_003 }], paid: 0 });
    expect(a.total).toBe(b.total);
    expect(get(ctx.db, 'SELECT qty, loose_qty, base_qty FROM purchase_items WHERE purchase_id = ?', a.id)).toEqual({ qty: 1, loose_qty: 10, base_qty: 30 });
  });

  it('free goods raise stock at no cost, lower the average cost and leave last cost alone', () => {
    const { ctx, tea, carton, sup } = setup();
    postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 10, unitCost: 800_000 }], paid: 0 });
    const lastCost = stock(ctx, tea)?.last_cost;
    const r = postPurchase(ctx, { supplierId: sup, date: '2026-03-02', lines: [{ productId: tea, packId: carton, qty: 2, looseQty: 5, unitCost: 800_000, kind: 'free' }], paid: 0 });
    expect(r.total).toBe(0);
    expect(stock(ctx, tea)).toMatchObject({ stock_qty: 245, stock_value: 8_000_000, last_cost: lastCost });
    expect(get(ctx.db, "SELECT line_kind, amount, unit_cost, base_qty FROM purchase_items WHERE purchase_id = ?", r.id)).toEqual({ line_kind: 'free', amount: 0, unit_cost: 0, base_qty: 45 });
    sound(ctx.db);
  });

  it('line discounts, a percent bill discount, VAT and freight: total, ledger and stock value agree to the poisha', () => {
    const { ctx, tea, carton, sup, w } = setup();
    const noodles = w.products[2] as number;
    const nCarton = (w.packs.get(noodles) as number[])[1] as number;
    const r = postPurchase(ctx, {
      supplierId: sup, date: '2026-03-01', supplierRef: 'CO-77', invoiceDate: '2026-02-28', dueDate: '2026-03-15',
      lines: [
        { productId: tea, packId: carton, qty: 10, unitCost: 800_000, discKind: 'pct', discValue: 250 },
        { productId: noodles, packId: nCarton, qty: 4, looseQty: 5, unitCost: 33_333, discKind: 'fixed', discValue: 1_000 },
        { productId: noodles, packId: nCarton, qty: 1, unitCost: 0, kind: 'free' }
      ],
      discKind: 'pct', discValue: 100, tax: 1_001, freight: 2_503, paid: 1_000_000
    });
    const row = get<{ subtotal: number; discount: number; tax: number; freight: number; total: number; paid: number; due: number; invoice_date: string; due_date: string }>(ctx.db, 'SELECT subtotal, discount, tax, freight, total, paid, due, invoice_date, due_date FROM purchases WHERE id = ?', r.id) as Record<string, number | string>;
    expect(row.total).toBe((row.subtotal as number) - (row.discount as number) + 1_001 + 2_503);
    expect(row.due).toBe((row.total as number) - 1_000_000);
    expect(row).toMatchObject({ invoice_date: '2026-02-28', due_date: '2026-03-15' });
    // everything the shelf received cost exactly the bill total
    expect(scalar(ctx.db, "SELECT COALESCE(SUM(value),0) FROM stock_movements WHERE ref_type='purchase' AND ref_id=?", [r.id])).toBe(row.total);
    expect(scalar(ctx.db, "SELECT COALESCE(SUM(amount),0) FROM party_ledger WHERE ref_type='purchase' AND ref_id=? AND entry_kind='purchase'", [r.id])).toBe(row.total);
    expect(scalar(ctx.db, 'SELECT SUM(alloc_charge) FROM purchase_items WHERE purchase_id = ?', [r.id])).toBe(3_504);
    sound(ctx.db);
  });

  it('refuses a bad input: nothing to buy, discount above the bill, paying more than the total', () => {
    const { ctx, tea, carton, sup } = setup();
    const base = { supplierId: sup, date: '2026-03-01', paid: 0 };
    expect(code(() => postPurchase(ctx, { ...base, lines: [{ productId: tea, packId: carton, qty: 0, looseQty: 0, unitCost: 1 }] }))).toBe('INVALID_INPUT');
    expect(code(() => postPurchase(ctx, { ...base, discount: 5_000_000, lines: [{ productId: tea, packId: carton, qty: 1, unitCost: 100 }] }))).toBe('INVALID_INPUT');
    expect(code(() => postPurchase(ctx, { ...base, paid: 999_999, lines: [{ productId: tea, packId: carton, qty: 1, unitCost: 100 }] }))).toBe('OVER_PAYMENT');
    expect(scalar(ctx.db, 'SELECT COUNT(*) FROM purchases')).toBe(0);
    sound(ctx.db);
  });

  it('voiding a box + pcs purchase with free goods nets to zero everywhere', () => {
    const { ctx, tea, carton, sup } = setup();
    const r = postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 3, looseQty: 4, unitCost: 810_000 }, { productId: tea, packId: carton, qty: 1, unitCost: 0, kind: 'free' }], freight: 999, paid: 100_000 });
    voidPurchase(ctx, r.id, 'wrong company');
    expect(stock(ctx, tea)).toMatchObject({ stock_qty: 0, stock_value: 0 });
    sound(ctx.db);
  });
});

describe('company invoice number', () => {
  it('warns on a repeat for the same company, allows it with a reason, and ignores voided or other companies', () => {
    const { ctx, tea, carton, sup, w } = setup();
    const line = { productId: tea, packId: carton, qty: 1, unitCost: 100_000 };
    const first = postPurchase(ctx, { supplierId: sup, supplierRef: 'INV-100', date: '2026-03-01', lines: [line], paid: 0 });
    expect(code(() => postPurchase(ctx, { supplierId: sup, supplierRef: 'inv-100', date: '2026-03-02', lines: [line], paid: 0 }))).toBe('DUPLICATE_INVOICE');
    // another company may reuse the number
    postPurchase(ctx, { supplierId: w.suppliers[1], supplierRef: 'INV-100', date: '2026-03-02', lines: [line], paid: 0 });
    const again = postPurchase(ctx, { supplierId: sup, supplierRef: 'INV-100', date: '2026-03-03', lines: [line], paid: 0, duplicateReason: 'company re-issued the invoice' });
    expect(get<{ dup_reason: string }>(ctx.db, 'SELECT dup_reason FROM purchases WHERE id = ?', again.id)?.dup_reason).toBe('company re-issued the invoice');
    voidPurchase(ctx, first.id, 'x');
    voidPurchase(ctx, again.id, 'x');
    postPurchase(ctx, { supplierId: sup, supplierRef: 'INV-100', date: '2026-03-04', lines: [line], paid: 0 }); // both earlier ones are void: no warning
    sound(ctx.db);
  });
});

describe('company <-> product link', () => {
  it('links by hand, remembers box and cost, and unlinks', () => {
    const { ctx, tea, carton, sup, w } = setup();
    const noodles = w.products[2] as number;
    expect(linkProducts(ctx, sup, [tea, noodles, tea])).toEqual({ added: 2, already: 0 });
    expect(linkProducts(ctx, sup, [tea])).toEqual({ added: 0, already: 1 });
    setSupplierProduct(ctx, sup, tea, { defaultPackId: carton, lastCost: 810_000 });
    expect(supplierProductRows(ctx, sup).find((r) => r.productId === tea)).toMatchObject({ defaultPackId: carton, lastCost: 810_000 });
    expect(code(() => setSupplierProduct(ctx, sup, tea, { defaultPackId: (w.packs.get(noodles) as number[])[1] }))).toBe('NOT_FOUND'); // a pack of another product
    expect(unlinkProducts(ctx, sup, [noodles])).toBe(1);
    expect(supplierProductRows(ctx, sup).map((r) => r.productId)).toEqual([tea]);
    sound(ctx.db);
  });

  it('changing the box re-expresses the remembered cost so the price per piece stays the same', () => {
    const { ctx, tea, carton, sup, w } = setup();
    const row = all<{ id: number; factor: number }>(ctx.db, 'SELECT id, factor FROM product_packs WHERE product_id = ? ORDER BY factor', tea);
    expect(row.map((r) => r.factor)).toEqual([1, 20]);
    linkProducts(ctx, sup, [tea]);
    setSupplierProduct(ctx, sup, tea, { defaultPackId: carton, lastCost: 800_000 });
    setSupplierProduct(ctx, sup, tea, { defaultPackId: null }); // back to pieces: 800,000 / 20
    expect(supplierProductRows(ctx, sup)[0]).toMatchObject({ defaultPackId: null, lastCost: 40_000 });
    void w;
  });

  it('links the first time a product is bought, and keeps the cost per box up to date (free goods never change it)', () => {
    const { ctx, tea, carton, sup } = setup();
    postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 2, unitCost: 800_000 }], paid: 0 });
    expect(supplierProductRows(ctx, sup)).toEqual([{ productId: tea, defaultPackId: carton, lastCost: 800_000, sort: 1 }]);
    postPurchase(ctx, { supplierId: sup, date: '2026-03-02', lines: [{ productId: tea, packId: carton, qty: 1, looseQty: 3, unitCost: 830_000 }], paid: 0 });
    expect(supplierProductRows(ctx, sup)[0]?.lastCost).toBe(830_000);
    postPurchase(ctx, { supplierId: sup, date: '2026-03-03', lines: [{ productId: tea, packId: carton, qty: 1, unitCost: 1, kind: 'free' }], paid: 0 });
    expect(supplierProductRows(ctx, sup)[0]?.lastCost).toBe(830_000);
    expect(supplierProductRows(ctx, sup)).toHaveLength(1);
    // a purchase without a company links nothing
    postPurchase(ctx, { date: '2026-03-03', lines: [{ productId: tea, qty: 1, unitCost: 100 }], paid: 100 });
    expect(scalar(ctx.db, 'SELECT COUNT(*) FROM supplier_products')).toBe(1);
  });

  it('links every active product of a brand or category in one go', () => {
    const { ctx, sup } = setup();
    const brand = createBrand(ctx, 'Fresh');
    const a = createProduct(ctx, { sku: 'F-1', name: 'Fresh A', brandId: brand, priceRetail: 100 });
    createProduct(ctx, { sku: 'F-2', name: 'Fresh B', brandId: brand, priceRetail: 100 });
    createProduct(ctx, { sku: 'X-1', name: 'Other', priceRetail: 100 });
    expect(linkSelection(ctx, { supplierId: sup, productIds: [a], brandId: brand })).toEqual({ added: 2, already: 0 });
    sound(ctx.db);
  });

  it('a new link takes the product\'s default purchase box', () => {
    const { ctx, tea, carton, sup } = setup();
    setProductDefaults(ctx, tea, null, 20);
    expect(get<{ p: number }>(ctx.db, 'SELECT default_purchase_pack_id AS p FROM products WHERE id = ?', tea)?.p).toBe(carton);
    linkProducts(ctx, sup, [tea]);
    expect(supplierProductRows(ctx, sup)[0]?.defaultPackId).toBe(carton);
    expect(code(() => setProductDefaults(ctx, tea, 7, null))).toBe('INVALID_INPUT'); // 7 is not a box of this product
    sound(ctx.db);
  });
});

describe('returns in box + pcs against a purchase', () => {
  it('caps a return at what the purchase brought in minus what was already returned, and voiding gives the allowance back', () => {
    const { ctx, tea, carton, sup } = setup();
    const p = postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 5, looseQty: 6, unitCost: 800_000 }], paid: 0 });
    const ret = (q: number) => postPurchaseReturn(ctx, { supplierId: sup, purchaseId: p.id, date: '2026-03-02', lines: [{ productId: tea, baseQty: q, credit: q * 40_000 }], refundMode: 'due' });
    const r1 = ret(1 * 20 + 3); // 1 box + 3 pcs
    expect(r1.credit).toBe(23 * 40_000);
    expect(code(() => ret(84))).toBe('OVER_RETURN'); // 106 - 23 = 83 left
    const r2 = ret(83);
    expect(code(() => ret(1))).toBe('OVER_RETURN');
    voidPurchaseReturn(ctx, r2.id, 'taken back');
    const r3 = ret(83);
    // the purchase cannot be cancelled while returns against it are live
    expect(code(() => voidPurchase(ctx, p.id, 'x'))).toBe('HAS_RETURNS');
    voidPurchaseReturn(ctx, r1.id, 'x');
    voidPurchaseReturn(ctx, r3.id, 'x');
    voidPurchase(ctx, p.id, 'wrong invoice');
    expect(stock(ctx, tea)).toMatchObject({ stock_qty: 0, stock_value: 0 });
    sound(ctx.db);
  });
});

describe('purchase draft', () => {
  it('keeps one draft per user, replaces it on every save and clears it', () => {
    const { ctx, world, sup } = setup();
    expect(loadPurchaseDraft(ctx, world.managerId)).toEqual({ payload: null, updatedAt: null });
    savePurchaseDraft(ctx, world.managerId, JSON.stringify({ supplierId: sup, rows: [1] }));
    savePurchaseDraft(ctx, world.managerId, JSON.stringify({ supplierId: sup, rows: [1, 2] }));
    expect(scalar(ctx.db, 'SELECT COUNT(*) FROM purchase_drafts')).toBe(1);
    expect(JSON.parse(loadPurchaseDraft(ctx, world.managerId).payload as string)).toEqual({ supplierId: sup, rows: [1, 2] });
    expect(get<{ s: number }>(ctx.db, 'SELECT supplier_id AS s FROM purchase_drafts')?.s).toBe(sup);
    expect(loadPurchaseDraft(ctx, world.ownerId).payload).toBeNull();
    expect(code(() => savePurchaseDraft(ctx, world.managerId, '{not json'))).toBe('INVALID_INPUT');
    clearPurchaseDraft(ctx, world.managerId);
    expect(loadPurchaseDraft(ctx, world.managerId).payload).toBeNull();
    sound(ctx.db);
  });
});

describe('update selling prices after a purchase', () => {
  it('suggests per-box landed cost and applies confirmed box prices, optionally to the piece price', () => {
    const { ctx, tea, carton, sup } = setup();
    const p = postPurchase(ctx, { supplierId: sup, date: '2026-03-01', lines: [{ productId: tea, packId: carton, qty: 10, unitCost: 800_000 }, { productId: tea, packId: carton, qty: 1, unitCost: 0, kind: 'free' }], freight: 10_000, paid: 0 });
    const s = priceSuggestions(ctx, p.id);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ productId: tea, packId: carton, factor: 20, packName: 'Carton' });
    // landed cost per PAID carton: (8,000,000 + 10,000 freight) / 10; the free carton is extra margin and does not lower the price base
    expect(s[0]?.costPerPack).toBe(801_000);
    expect(s[0]?.current.retail).toBe(45_000 * 20);
    applyPrices(ctx, [{ productId: tea, packId: carton, priceRetail: 1_000_001, priceWholesale: 950_000, priceDealer: 900_000, alsoBase: true }]);
    expect(get(ctx.db, 'SELECT price_retail, price_wholesale, price_dealer FROM product_packs WHERE id = ?', carton)).toEqual({ price_retail: 1_000_001, price_wholesale: 950_000, price_dealer: 900_000 });
    expect(get(ctx.db, 'SELECT price_retail, price_wholesale, price_dealer FROM products WHERE id = ?', tea)).toEqual({ price_retail: 50_000, price_wholesale: 47_500, price_dealer: 45_000 });
    expect(get<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'product.prices'")?.n).toBe(1);
    sound(ctx.db);
  });
});
