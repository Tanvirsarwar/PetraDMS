import { PetraError, type AreaDto, type CustomerDto, type Role, type SaleDetail, type SaleItemDto, type SaleListItem, type SaleReturnDto } from '@petra/core';
import type { z } from 'zod';
import type { areaSaveInput, customerSaveInput } from '@petra/core';
import { all, get, run, scalar } from '../sql';
import { type Ctx, requireRow, tx } from '../ctx';
import { audit } from '../audit';
import { createArea, createCustomer } from '../masters';

type CustomerSave = z.output<typeof customerSaveInput>;
type AreaSave = z.output<typeof areaSaveInput>;

export function listAreas(ctx: Ctx): AreaDto[] {
  return all<{ id: number; name: string; name_bn: string }>(ctx.db, 'SELECT id, name, name_bn FROM areas ORDER BY name COLLATE NOCASE').map((a) => ({ id: a.id, name: a.name, nameBn: a.name_bn }));
}

export function saveArea(ctx: Ctx, i: AreaSave): number {
  if (!i.id) {
    if (get(ctx.db, 'SELECT id FROM areas WHERE name = ?', i.name)) throw new PetraError('DUPLICATE', 'area already exists', { what: 'area' });
    return createArea(ctx, i.name, i.nameBn);
  }
  const areaId = i.id;
  requireRow(get(ctx.db, 'SELECT id FROM areas WHERE id = ?', areaId), 'area', areaId);
  try {
    run(ctx.db, 'UPDATE areas SET name = ?, name_bn = ? WHERE id = ?', i.name, i.nameBn, areaId);
  } catch (e) {
    if (e instanceof Error && /UNIQUE/.test(e.message)) throw new PetraError('DUPLICATE', 'area already exists', { what: 'area' });
    throw e;
  }
  return areaId;
}

interface CustomerDb {
  id: number; name: string; name_bn: string; phone: string; address: string; area_id: number | null; area_name: string | null; type: 'retail' | 'wholesale' | 'dealer';
  credit_limit: number; default_discount_bp: number; balance: number; status: 'active' | 'archived'; notes: string; last_sale: string | null;
}

export function listCustomers(ctx: Ctx, includeArchived: boolean): CustomerDto[] {
  return all<CustomerDb>(
    ctx.db,
    `SELECT c.*, a.name AS area_name, (SELECT MAX(s.business_date) FROM sales s WHERE s.customer_id = c.id AND s.status = 'posted') AS last_sale
       FROM customers c LEFT JOIN areas a ON a.id = c.area_id WHERE (? OR c.status = 'active') ORDER BY c.name COLLATE NOCASE`,
    includeArchived ? 1 : 0
  ).map((c) => ({
    id: c.id, name: c.name, nameBn: c.name_bn, phone: c.phone, address: c.address, areaId: c.area_id, areaName: c.area_name ?? '', type: c.type,
    creditLimit: c.credit_limit, defaultDiscountBp: c.default_discount_bp, balance: c.balance, status: c.status, notes: c.notes, lastSaleDate: c.last_sale
  }));
}

function checkPhone(phone: string): void {
  if (phone && !/^01[3-9]\d{8}$/.test(phone.replace(/[\s-]/g, ''))) throw new PetraError('INVALID_INPUT', 'phone must be a Bangladesh mobile number like 01712345678', { field: 'phone' });
}

export function saveCustomer(ctx: Ctx, i: CustomerSave): number {
  checkPhone(i.phone);
  if (!i.id) {
    return createCustomer(ctx, { name: i.name, nameBn: i.nameBn, phone: i.phone.replace(/[\s-]/g, ''), address: i.address, areaId: i.areaId, type: i.type, creditLimit: i.creditLimit, defaultDiscountBp: i.defaultDiscountBp, notes: i.notes, openingBalance: i.openingBalance, openingDate: i.openingDate });
  }
  const cid = i.id;
  requireRow(get(ctx.db, 'SELECT id FROM customers WHERE id = ?', cid), 'customer', cid);
  tx(ctx, () => {
    run(
      ctx.db,
      `UPDATE customers SET name=?, name_bn=?, phone=?, address=?, area_id=?, type=?, credit_limit=?, default_discount_bp=?, notes=?, status=COALESCE(?, status), updated_at=? WHERE id=?`,
      i.name, i.nameBn, i.phone.replace(/[\s-]/g, ''), i.address, i.areaId, i.type, i.creditLimit, i.defaultDiscountBp, i.notes, i.archived === undefined ? null : i.archived ? 'archived' : 'active', ctx.now(), cid
    );
    audit(ctx, { action: 'customer.update', entity: 'customer', entityId: cid });
  });
  return cid;
}

export function quickAddCustomer(ctx: Ctx, role: Role, i: { name: string; phone: string; address?: string; areaId: number | null; type?: 'retail' | 'wholesale' | 'dealer' }): number {
  checkPhone(i.phone);
  // a wholesale or dealer customer gets lower prices: only a manager or the owner may create one
  if (role === 'staff' && (i.type ?? 'retail') !== 'retail') throw new PetraError('PERMISSION', 'staff may add retail customers only');
  return createCustomer(ctx, { name: i.name, phone: i.phone.replace(/[\s-]/g, ''), address: i.address ?? '', areaId: i.areaId, type: i.type ?? 'retail' });
}

interface SaleListDb {
  id: number; doc_no: string; business_date: string; customer_id: number | null; customer_name: string | null; status: 'posted' | 'void'; revision: number;
  total: number; paid: number; due: number; tax: number; cogs: number | null; ret_net: number; ret_cogs: number;
}

export function listSales(ctx: Ctx, role: Role, today: string, input: { from?: string; to?: string; customerId?: number; search?: string }): SaleListItem[] {
  // Staff see today's invoices only (plan 13.1).
  const from = role === 'staff' ? today : input.from ?? null;
  const to = role === 'staff' ? today : input.to ?? null;
  const search = input.search?.trim() ? `%${input.search.trim().toLowerCase()}%` : null;
  const rows = all<SaleListDb>(
    ctx.db,
    `SELECT s.id, s.doc_no, s.business_date, s.customer_id, c.name AS customer_name, s.status, s.revision, s.total, s.paid, s.due, s.tax,
            (SELECT SUM(i.cogs) FROM sale_items i WHERE i.sale_id = s.id AND i.revision = s.revision) AS cogs,
            COALESCE((SELECT SUM(r.net_amount) FROM sale_returns r WHERE r.sale_id = s.id AND r.status = 'posted'), 0) AS ret_net,
            COALESCE((SELECT SUM(r.cogs_restored) FROM sale_returns r WHERE r.sale_id = s.id AND r.status = 'posted'), 0) AS ret_cogs
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE (? IS NULL OR s.business_date >= ?) AND (? IS NULL OR s.business_date <= ?) AND (? IS NULL OR s.customer_id = ?)
        AND (? IS NULL OR lower(s.doc_no) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ?)
      ORDER BY s.business_date DESC, s.id DESC LIMIT 2000`,
    from, from, to, to, input.customerId ?? null, input.customerId ?? null, search, search, search
  );
  return rows.map((r) => ({
    id: r.id, docNo: r.doc_no, date: r.business_date, customerId: r.customer_id, customerName: r.customer_name ?? '', status: r.status, revision: r.revision,
    total: r.total, paid: r.paid, due: r.due,
    profit: role === 'staff' || r.status === 'void' ? null : r.total - r.tax - r.ret_net - ((r.cogs ?? 0) - r.ret_cogs)
  }));
}

export function getSale(ctx: Ctx, role: Role, id: number): SaleDetail {
  const s = requireRow(
    get<Record<string, unknown> & { id: number; doc_no: string; business_date: string; status: 'posted' | 'void'; revision: number; customer_id: number | null }>(
      ctx.db,
      `SELECT s.*, c.name AS cname, c.phone AS cphone, c.address AS caddress, c.balance AS cbalance, a.name AS area_name, m.name AS account_name, u.display_name AS user_name
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN areas a ON a.id = c.area_id
         LEFT JOIN money_accounts m ON m.id = s.account_id LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      id
    ),
    'invoice', id
  );
  const hideCost = role === 'staff';
  const items = all<Record<string, unknown>>(
    ctx.db,
    `SELECT i.*, p.sku, p.name AS pname, p.name_bn AS pname_bn, p.base_unit AS base_unit, COALESCE(k.name_bn, '') AS pack_name_bn,
            COALESCE((SELECT SUM(ri.base_qty) FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id WHERE ri.sale_item_id = i.id AND r.status = 'posted'), 0) AS returned
       FROM sale_items i JOIN products p ON p.id = i.product_id LEFT JOIN product_packs k ON k.id = i.pack_id WHERE i.sale_id = ? AND i.revision = ? ORDER BY i.line_no`,
    id, s.revision
  );
  const itemDtos: SaleItemDto[] = items.map((i) => ({
    id: i.id as number, lineNo: i.line_no as number, kind: i.line_kind as 'normal' | 'bonus', productId: i.product_id as number, sku: i.sku as string,
    productName: i.pname as string, productNameBn: i.pname_bn as string, packId: (i.pack_id as number | null) ?? null, packName: i.pack_name as string, packNameBn: i.pack_name_bn as string, baseUnit: i.base_unit as string, factor: i.factor as number,
    qty: i.qty as number, baseQty: i.base_qty as number, price: i.price as number, discKind: (i.disc_kind as 'pct' | 'fixed' | null) ?? null, discValue: i.disc_value as number,
    discount: i.discount as number, amount: i.amount as number, allocDiscount: i.alloc_discount as number, cogs: hideCost ? null : (i.cogs as number), returnedBaseQty: i.returned as number
  }));
  const returns: SaleReturnDto[] = all<{ id: number; doc_no: string; business_date: string; refund_mode: 'due' | 'cash'; total: number; status: 'posted' | 'void'; reason: string }>(
    ctx.db, 'SELECT id, doc_no, business_date, refund_mode, total, status, reason FROM sale_returns WHERE sale_id = ? ORDER BY id', id
  ).map((r) => ({ id: r.id, docNo: r.doc_no, date: r.business_date, refundMode: r.refund_mode, total: r.total, status: r.status, reason: r.reason }));
  const cogs = itemDtos.reduce((a, i) => a + (i.cogs ?? 0), 0);
  const retNet = scalar(ctx.db, "SELECT COALESCE(SUM(net_amount),0) FROM sale_returns WHERE sale_id = ? AND status = 'posted'", [id]);
  const retCogs = scalar(ctx.db, "SELECT COALESCE(SUM(cogs_restored),0) FROM sale_returns WHERE sale_id = ? AND status = 'posted'", [id]);
  let previousDue: number | null = null;
  if (s.customer_id) {
    const first = scalar<number | null>(ctx.db, "SELECT MIN(id) FROM party_ledger WHERE ref_type = 'sale' AND ref_id = ? AND party_kind = 'customer'", [id], null);
    previousDue = first === null ? (s.cbalance as number) : scalar(ctx.db, "SELECT COALESCE(SUM(amount),0) FROM party_ledger WHERE party_kind = 'customer' AND party_id = ? AND id < ?", [s.customer_id, first]);
  }
  const posted = s.status === 'posted';
  return {
    id: s.id, docNo: s.doc_no, date: s.business_date, status: s.status, revision: s.revision, customerId: s.customer_id,
    customerName: (s.cname as string | null) ?? '', customerPhone: (s.cphone as string | null) ?? '', customerAddress: (s.caddress as string | null) ?? '', areaName: (s.area_name as string | null) ?? '',
    priceTier: s.price_tier as SaleDetail['priceTier'], subtotal: s.subtotal as number, discKind: (s.disc_kind as 'pct' | 'fixed' | null) ?? null, discValue: s.disc_value as number,
    discount: s.discount as number, taxBp: s.tax_bp as number, tax: s.tax as number, roundOff: s.round_off as number, total: s.total as number, paid: s.paid as number, due: s.due as number,
    accountName: (s.account_name as string | null) ?? '', note: s.note as string, voidReason: (s.void_reason as string | null) ?? null,
    previousDue, currentDue: s.customer_id ? (s.cbalance as number) : null, userName: (s.user_name as string | null) ?? '',
    items: itemDtos, returns,
    cogs: hideCost ? null : cogs,
    profit: hideCost || !posted ? null : (s.total as number) - (s.tax as number) - retNet - (cogs - retCogs)
  };
}

export function loadDraft(ctx: Ctx, userId: number): { payload: string | null; updatedAt: string | null } {
  const r = get<{ payload_json: string; updated_at: string }>(ctx.db, 'SELECT payload_json, updated_at FROM sale_drafts WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
  return { payload: r?.payload_json ?? null, updatedAt: r?.updated_at ?? null };
}

export function saveDraft(ctx: Ctx, userId: number, payload: string): void {
  const customerId = (() => {
    try {
      const v = (JSON.parse(payload) as { customerId?: unknown }).customerId;
      return typeof v === 'number' ? v : null;
    } catch {
      throw new PetraError('INVALID_INPUT', 'draft is not valid', { field: 'payload' });
    }
  })();
  tx(ctx, () => {
    run(ctx.db, 'DELETE FROM sale_drafts WHERE user_id = ?', userId);
    run(ctx.db, 'INSERT INTO sale_drafts(user_id, customer_id, payload_json, updated_at) VALUES(?,?,?,?)', userId, customerId, payload, ctx.now());
  });
}

export function clearDraft(ctx: Ctx, userId: number): void {
  run(ctx.db, 'DELETE FROM sale_drafts WHERE user_id = ?', userId);
}
