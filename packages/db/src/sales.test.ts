import { afterEach, describe, expect, it } from 'vitest';
import { renderInvoice } from '@petra/core';
import { DAY, T0, expectIntegrity, fail, makeApp, ok, setupWithUsers, signInAs, type App } from './testApp';

let app: App;
afterEach(() => app?.close());

async function seed() {
  app = makeApp();
  const users = await setupWithUsers(app.d);
  const area = await ok(app.d, 'area:save', { name: 'Zindabazar', nameBn: 'জিন্দাবাজার' });
  const cust = await ok(app.d, 'customer:save', { name: 'Karim Store', phone: '01711111111', areaId: area.id, type: 'wholesale', creditLimit: 500000, openingBalance: 245000, openingDate: '2026-09-30' });
  const sup = await ok(app.d, 'catalog:supplierSave', { name: 'Marks Ltd', nameBn: '', phone: '', address: '', notes: '', openingBalance: 0 });
  const milk = await ok(app.d, 'catalog:productSave', { sku: 'MLK', name: 'Marks Milk 500g', nameBn: 'মার্কস দুধ', baseUnit: 'pcs', trackExpiry: false, priceRetail: 60000, priceWholesale: 52000, priceDealer: 50000, minPrice: 48000, reorderLevel: 0, favourite: false, notes: '', barcodes: ['8901'], packs: [{ name: 'Carton', factor: 24 }] });
  const tea = await ok(app.d, 'catalog:productSave', { sku: 'TEA', name: 'Sylon Tea 400g', nameBn: '', baseUnit: 'pcs', trackExpiry: false, priceRetail: 45000, priceWholesale: 42000, priceDealer: 40000, minPrice: 0, reorderLevel: 0, favourite: false, notes: '', barcodes: [], packs: [] });
  await ok(app.d, 'purchase:save', { supplierId: sup.id, date: '2026-10-01', lines: [{ productId: milk.id, qty: 100, unitCost: 40000 }, { productId: tea.id, qty: 50, unitCost: 33000 }], discount: 0, paid: 0, note: '' });
  return { users, area, cust, milk, tea };
}

describe('customers and sales (Phase 6 services)', () => {
  it('golden invoice: totals, discounts, bonus, partial payment, khata footer, integrity', async () => {
    const { cust, milk, tea } = await seed();
    const prods = await ok(app.d, 'catalog:products', { includeArchived: false });
    const carton = prods.find((p) => p.id === milk.id)!.packs.find((k) => k.factor === 24)!;
    // 2 cartons milk at wholesale carton price (24 x 52000 = 1,248,000), 5 tea at 42000 with 10% line discount, 1 bonus tea, 5% invoice discount
    const sale = await ok(app.d, 'sale:save', {
      date: '2026-10-01', customerId: cust.id,
      lines: [
        { productId: milk.id, packId: carton.id, qty: 2 },
        { productId: tea.id, qty: 5, discKind: 'pct', discValue: 1000 },
        { productId: tea.id, qty: 1, kind: 'bonus' }
      ],
      discKind: 'pct', discValue: 500, paid: 1000000
    });
    // line1 = 2,496,000; line2 = 210,000 - 21,000 = 189,000; subtotal 2,685,000; 5% = 134,250; total 2,550,750
    expect(sale.total).toBe(2_550_750);
    expect(sale.due).toBe(1_550_750);
    const detail = await ok(app.d, 'sale:get', { id: sale.id });
    expect(detail.subtotal).toBe(2_685_000);
    expect(detail.discount).toBe(134_250);
    expect(detail.previousDue).toBe(245_000);
    expect(detail.currentDue).toBe(245_000 + 1_550_750);
    expect(detail.items).toHaveLength(3);
    expect(detail.profit).not.toBeNull();
    // cost = 48 x 40000 + 6 x 33000 = 1,920,000 + 198,000
    expect(detail.cogs).toBe(2_118_000);
    expect(detail.profit).toBe(2_550_750 - 2_118_000);
    const html = renderInvoice(detail, { name: 'Rahim Traders', nameBn: 'রহিম ট্রেডার্স', address: 'Sylhet', phone: '01712345678', taxNo: '', footerNote: '' }, { format: 'a4', lang: 'bn', bilingual: false, bnDigits: true, grouping: 'lakh', fontCss: '' });
    expect(html).toContain(detail.docNo);
    expect(html).toContain('আগের বাকি');
    expect(html).toContain('২৫,৫০৭.৫০'); // total in lakh grouping with Bangla digits
    expect(html).toContain('বাকি'); // DUE stamp
    expect(html).not.toContain('cogs');
    await expectIntegrity(app);
  });

  it('staff: no cost or profit, today only, approvals via manager token, credit limit', async () => {
    const { users, cust, milk } = await seed();
    await ok(app.d, 'settings:save', { creditLimitMode: 'approval' });
    const sale1 = await ok(app.d, 'sale:save', { date: '2026-10-01', customerId: cust.id, lines: [{ productId: milk.id, qty: 1 }], paid: 52000 });
    await signInAs(app.d, users.staff, 'staff');
    const list = await ok(app.d, 'sale:list', {});
    expect(list.every((s) => s.profit === null)).toBe(true);
    const detail = await ok(app.d, 'sale:get', { id: sale1.id });
    expect(detail.cogs).toBeNull();
    expect(detail.items.every((i) => i.cogs === null)).toBe(true);
    expect(detail.profit).toBeNull();
    // selling below the minimum price needs approval
    const low = { date: '2026-10-01', customerId: null, lines: [{ productId: milk.id, qty: 1, price: 40000 }], paid: 40000 };
    const r1 = await fail(app.d, 'sale:save', low);
    expect(r1).toBe('APPROVAL_REQUIRED');
    const wrong = await app.d.call('auth:approve', { userId: users.manager, secret: '9999' });
    expect(wrong.ok).toBe(false);
    const good = await ok(app.d, 'auth:approve', { userId: users.manager, secret: '1111' });
    const posted = await ok(app.d, 'sale:save', { ...low, approvalToken: good.token });
    expect(posted.total).toBe(40000);
    // token is single use
    const again = await fail(app.d, 'sale:save', { ...low, approvalToken: good.token });
    expect(again).toBe('APPROVAL_REQUIRED');
    // staff cannot void, edit or return
    expect((await fail(app.d, 'sale:void', { id: posted.id, reason: 'x' }))).toBe('PERMISSION');
    expect((await fail(app.d, 'sale:return', { saleId: posted.id, date: '2026-10-01', items: [{ saleItemId: 1, baseQty: 1 }], refundMode: 'cash' }))).toBe('PERMISSION');
    // staff see only today's invoices
    app.nowRef.t = T0 + 2 * DAY;
    expect((await ok(app.d, 'sale:list', {})).length).toBe(0);
    expect((await fail(app.d, 'sale:get', { id: sale1.id }))).toBe('PERMISSION');
  });

  it('draft autosave per user, cleared on save', async () => {
    const { cust, milk } = await seed();
    expect((await ok(app.d, 'draft:get')).payload).toBeNull();
    await ok(app.d, 'draft:save', { payload: JSON.stringify({ customerId: cust.id, lines: [] }) });
    expect((await ok(app.d, 'draft:get')).payload).toContain('lines');
    await ok(app.d, 'sale:save', { date: '2026-10-01', customerId: null, lines: [{ productId: milk.id, qty: 1 }], paid: 60000 });
    expect((await ok(app.d, 'draft:get')).payload).toBeNull();
    expect((await fail(app.d, 'draft:save', { payload: 'not json' }))).toBe('INVALID_INPUT');
  });

  it('edit, return, void keep stock, ledger and cash consistent', async () => {
    const { cust, milk } = await seed();
    const s = await ok(app.d, 'sale:save', { date: '2026-10-01', customerId: cust.id, lines: [{ productId: milk.id, qty: 10 }], paid: 100000 });
    const edited = await ok(app.d, 'sale:edit', { id: s.id, customerId: cust.id, lines: [{ productId: milk.id, qty: 8 }], paid: 100000, reason: 'customer changed order' });
    expect(edited.revision).toBe(2);
    expect(edited.docNo).toBe(s.docNo);
    const d1 = await ok(app.d, 'sale:get', { id: s.id });
    const ret = await ok(app.d, 'sale:return', { saleId: s.id, date: '2026-10-01', items: [{ saleItemId: d1.items[0]!.id, baseQty: 3 }], refundMode: 'due', reason: 'damaged' });
    expect(ret.total).toBe(3 * 52000);
    const d2 = await ok(app.d, 'sale:get', { id: s.id });
    expect(d2.items[0]!.returnedBaseQty).toBe(3);
    expect((await fail(app.d, 'sale:void', { id: s.id, reason: 'oops' }))).toBe('HAS_RETURNS');
    await ok(app.d, 'sale:returnVoid', { id: ret.id, reason: 'mistake' });
    await ok(app.d, 'sale:void', { id: s.id, reason: 'duplicate' });
    const list = await ok(app.d, 'sale:list', {});
    expect(list.find((x) => x.id === s.id)!.status).toBe('void');
    const cust2 = (await ok(app.d, 'customer:list', { includeArchived: false })).find((c) => c.id === cust.id)!;
    expect(cust2.balance).toBe(245000);
    await expectIntegrity(app);
  });

  it('prints: invoice PDF goes to the invoices folder, statement renders, supplier statement needs a manager', async () => {
    const { users, cust, milk } = await seed();
    const s = await ok(app.d, 'sale:save', { date: '2026-10-01', customerId: cust.id, lines: [{ productId: milk.id, qty: 2 }], paid: 0 });
    for (const format of ['a4', 'thermal80', 'thermal58'] as const) {
      const r = await ok(app.d, 'print:run', { doc: { type: 'invoice', id: s.id }, format, action: 'pdf' });
      expect(r.path).toMatch(/invoices.*INV-/);
    }
    expect(app.pdfs).toHaveLength(3);
    expect(app.printed[1]).toContain('@page{size:80mm');
    expect(app.printed[2]).toContain('@page{size:58mm');
    await ok(app.d, 'print:run', { doc: { type: 'statement', kind: 'customer', id: cust.id }, action: 'print' });
    expect(app.printed.at(-1)).toContain('Karim Store');
    await signInAs(app.d, users.staff, 'staff');
    expect((await fail(app.d, 'print:run', { doc: { type: 'statement', kind: 'supplier', id: 1 }, action: 'print' }))).toBe('PERMISSION');
  });

  it('customers: phone validation, quick add, archive hides from selling', async () => {
    const { users } = await seed();
    expect((await fail(app.d, 'customer:save', { name: 'Bad', phone: '12345' }))).toBe('INVALID_INPUT');
    await signInAs(app.d, users.staff, 'staff');
    const q = await ok(app.d, 'customer:quickAdd', { name: 'Walk Regular', phone: '01822222222' });
    const list = await ok(app.d, 'customer:list', { includeArchived: false });
    expect(list.find((c) => c.id === q.id)!.creditLimit).toBe(0);
    expect((await fail(app.d, 'customer:save', { name: 'x' }))).toBe('PERMISSION');
  });
});
