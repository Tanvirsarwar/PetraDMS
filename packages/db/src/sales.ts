import {
  PetraError, computeInvoice, cumulativeShare, mulDiv, toBaseQty,
  type DiscountKind, type InvoiceResult
} from '@petra/core';
import { all, get, run, scalar } from './sql';
import { type Ctx, assertDateOpen, requireRow, tx, userRole } from './ctx';
import { loadSettings, nextDocNo } from './settings';
import { postCash, postLedger, resolveAccount } from './ledger';
import { loadProduct, stockIn, stockOut, type ProductRow } from './stock';
import { reverseDocument } from './reverse';
import { audit } from './audit';
import { postOnce } from './idempotency';

export type PriceTier = 'retail' | 'wholesale' | 'dealer';

export interface SaleLineInput {
  kind?: 'normal' | 'bonus';
  productId: number;
  /** Pack level; omit for the base unit. */
  packId?: number | null;
  qty: number;
  /** Price per ONE unit of the chosen pack level, in poisha. Omit to use the tier price. */
  price?: number;
  discKind?: DiscountKind | null;
  discValue?: number;
  /** Cashier override of earliest-expiry-first. */
  batchId?: number | null;
}

export interface SaleInput {
  customerId?: number | null;
  date: string;
  lines: SaleLineInput[];
  discKind?: DiscountKind | null;
  discValue?: number;
  paid: number;
  accountId?: number | null;
  note?: string;
  priceTier?: PriceTier;
  /** A manager/owner who approved a below-minimum price or a credit-limit breach. */
  approvedBy?: number | null;
  /** Client-chosen id: submitting the same one again (double click, retry) returns the first invoice and posts nothing new. */
  requestId?: string;
}

export interface SaleResult {
  id: number;
  docNo: string;
  total: number;
  paid: number;
  due: number;
  cogs: number;
  revision: number;
  warnings: string[];
}

interface PackRow { id: number; product_id: number; name: string; factor: number; price_retail: number | null; price_wholesale: number | null; price_dealer: number | null }
interface CustomerRow { id: number; name: string; type: PriceTier; credit_limit: number; balance: number; status: string }

interface PreparedLine {
  input: SaleLineInput;
  kind: 'normal' | 'bonus';
  product: ProductRow;
  pack: PackRow;
  baseQty: number;
  price: number;
}

interface Prepared {
  customer: CustomerRow | null;
  tier: PriceTier;
  lines: PreparedLine[];
  inv: InvoiceResult;
  taxBp: number;
  due: number;
  warnings: string[];
}

export function resolvePack(ctx: Ctx, productId: number, packId: number | null | undefined): PackRow {
  const row = packId
    ? get<PackRow>(ctx.db, 'SELECT id, product_id, name, factor, price_retail, price_wholesale, price_dealer FROM product_packs WHERE id = ? AND product_id = ?', packId, productId)
    : get<PackRow>(ctx.db, 'SELECT id, product_id, name, factor, price_retail, price_wholesale, price_dealer FROM product_packs WHERE product_id = ? AND factor = 1', productId);
  return requireRow(row, 'pack', packId ?? undefined);
}

export function tierPrice(product: ProductRow, pack: PackRow, tier: PriceTier): number {
  const override = tier === 'retail' ? pack.price_retail : tier === 'wholesale' ? pack.price_wholesale : pack.price_dealer;
  if (override !== null) return override;
  const per = tier === 'retail' ? product.price_retail : tier === 'wholesale' ? product.price_wholesale : product.price_dealer;
  return per * pack.factor;
}

function requireApprover(ctx: Ctx, approvedBy: number | null | undefined, why: string, params: Record<string, string | number>): void {
  if (!approvedBy) throw new PetraError('APPROVAL_REQUIRED', `manager approval required: ${why}`, { reason: why, ...params });
  const role = userRole(ctx.db, approvedBy);
  if (role !== 'owner' && role !== 'manager') throw new PetraError('PERMISSION', 'approver must be a manager or the owner', { reason: why });
}

function prepareSale(ctx: Ctx, input: SaleInput, excludeDue = 0): Prepared {
  if (input.lines.length === 0) throw new PetraError('INVALID_INPUT', 'add at least one item', { field: 'lines' });
  if (!Number.isSafeInteger(input.paid) || input.paid < 0) throw new PetraError('INVALID_INPUT', 'paid must be a non-negative whole number of poisha', { field: 'paid' });
  const settings = loadSettings(ctx.db);
  let customer: CustomerRow | null = null;
  if (input.customerId) {
    customer = requireRow(get<CustomerRow>(ctx.db, 'SELECT id, name, type, credit_limit, balance, status FROM customers WHERE id = ?', input.customerId), 'customer', input.customerId);
    if (customer.status !== 'active') throw new PetraError('INVALID_INPUT', 'customer is archived', { field: 'customer' });
  }
  const tier: PriceTier = input.priceTier ?? customer?.type ?? 'retail';

  const lines: PreparedLine[] = input.lines.map((l) => {
    const product = loadProduct(ctx, l.productId);
    if (product.status !== 'active') throw new PetraError('INVALID_INPUT', `${product.name} is archived`, { field: 'product', product: product.name });
    const pack = resolvePack(ctx, l.productId, l.packId);
    const kind = l.kind ?? 'normal';
    const baseQty = toBaseQty(l.qty, pack.factor);
    const price = kind === 'bonus' ? 0 : (l.price ?? tierPrice(product, pack, tier));
    return { input: l, kind, product, pack, baseQty, price };
  });

  const inv = computeInvoice({
    lines: lines.map((l) => ({ kind: l.kind, qty: l.input.qty, price: l.price, discKind: l.input.discKind ?? null, discValue: l.input.discValue ?? 0 })),
    discKind: input.discKind ?? null,
    discValue: input.discValue ?? 0,
    taxBp: settings.taxBp,
    roundOff: settings.roundOff
  });

  if (input.paid > inv.total) throw new PetraError('OVER_PAYMENT', 'paid is more than the invoice total', { total: inv.total, paid: input.paid });
  const due = inv.total - input.paid;
  if (!customer && due !== 0) throw new PetraError('INVALID_INPUT', 'a walk-in sale must be paid in full; choose a customer for credit', { field: 'paid', total: inv.total });

  const warnings: string[] = [];
  if (settings.minPriceMode === 'approval') {
    lines.forEach((l, i) => {
      if (l.kind !== 'normal' || l.product.min_price <= 0) return;
      const unitNet = Math.floor((inv.lines[i] as { net: number }).net / l.baseQty);
      if (unitNet < l.product.min_price) requireApprover(ctx, input.approvedBy, 'min_price', { product: l.product.name });
    });
  }
  if (customer && customer.credit_limit > 0 && due > 0) {
    const projected = customer.balance - excludeDue + due;
    if (projected > customer.credit_limit) {
      if (settings.creditLimitMode === 'block') throw new PetraError('CREDIT_LIMIT', 'credit limit exceeded', { limit: customer.credit_limit, projected });
      if (settings.creditLimitMode === 'approval') requireApprover(ctx, input.approvedBy, 'credit_limit', { limit: customer.credit_limit, projected });
      if (settings.creditLimitMode === 'warn') warnings.push('credit_limit');
    }
  }
  return { customer, tier, lines, inv, taxBp: settings.taxBp, due, warnings };
}

/** Inserts the lines of one revision and posts stock, ledger and cash. Returns total COGS. */
function postSaleBody(ctx: Ctx, saleId: number, revision: number, date: string, input: SaleInput, p: Prepared, accountId: number | null): number {
  let totalCogs = 0;
  p.lines.forEach((l, i) => {
    const r = p.inv.lines[i] as InvoiceResultLine;
    const itemId = run(
      ctx.db,
      `INSERT INTO sale_items(sale_id, revision, line_no, line_kind, product_id, pack_id, pack_name, factor, qty, base_qty, price, disc_kind, disc_value, discount, amount, alloc_discount, cogs)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      saleId, revision, i + 1, l.kind, l.product.id, l.pack.id, l.pack.name, l.pack.factor, l.input.qty, l.baseQty, l.price,
      l.kind === 'bonus' ? null : (l.input.discKind ?? null), l.kind === 'bonus' ? 0 : (l.input.discValue ?? 0), r.discount, r.amount, r.allocDiscount
    ).id;
    const out = stockOut(ctx, { productId: l.product.id, baseQty: l.baseQty, kind: l.kind === 'bonus' ? 'bonus' : 'sale', date, refType: 'sale', refId: saleId, preferBatchId: l.input.batchId });
    run(ctx.db, 'UPDATE sale_items SET cogs = ? WHERE id = ?', out.cogs, itemId);
    for (const s of out.slices) if (s.batchId) run(ctx.db, 'INSERT INTO sale_item_batches(sale_item_id, batch_id, base_qty) VALUES(?,?,?)', itemId, s.batchId, s.baseQty);
    totalCogs += out.cogs;
  });
  if (p.customer) {
    if (p.inv.total !== 0) postLedger(ctx, { partyKind: 'customer', partyId: p.customer.id, kind: 'sale', amount: p.inv.total, refType: 'sale', refId: saleId, date });
    if (input.paid > 0) postLedger(ctx, { partyKind: 'customer', partyId: p.customer.id, kind: 'payment', amount: -input.paid, refType: 'sale', refId: saleId, date, note: 'Paid at sale' });
  }
  if (input.paid > 0 && accountId !== null) {
    postCash(ctx, { accountId, date, amount: input.paid, source: 'sale', refType: 'sale', refId: saleId, partyKind: p.customer ? 'customer' : null, partyId: p.customer?.id ?? null });
  }
  return totalCogs;
}

type InvoiceResultLine = InvoiceResult['lines'][number];

export function postSale(ctx: Ctx, input: SaleInput): SaleResult {
  const { requestId, approvedBy, ...data } = input;
  void approvedBy; // who approved is not part of what was sold
  return postOnce(ctx, 'sale', requestId, data, () => postSaleOnce(ctx, input));
}

function postSaleOnce(ctx: Ctx, input: SaleInput): SaleResult {
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    const p = prepareSale(ctx, input);
    const accountId = input.paid > 0 ? resolveAccount(ctx, input.accountId) : null;
    const docNo = nextDocNo(ctx, 'INV');
    const t = ctx.now();
    const saleId = run(
      ctx.db,
      `INSERT INTO sales(doc_no, customer_id, status, revision, business_date, price_tier, subtotal, disc_kind, disc_value, discount, tax_bp, tax, round_off, total, paid, due, account_id, note, approved_by, user_id, created_at, updated_at)
       VALUES(?,?,'posted',1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      docNo, p.customer?.id ?? null, input.date, p.tier, p.inv.subtotal, input.discKind ?? null, input.discValue ?? 0, p.inv.discount, p.taxBp, p.inv.tax, p.inv.roundOff,
      p.inv.total, input.paid, p.due, accountId, input.note ?? '', input.approvedBy ?? null, ctx.userId, t, t
    ).id;
    const cogs = postSaleBody(ctx, saleId, 1, input.date, input, p, accountId);
    audit(ctx, { action: 'sale.create', entity: 'sale', entityId: saleId, after: { docNo, total: p.inv.total, paid: input.paid } });
    return { id: saleId, docNo, total: p.inv.total, paid: input.paid, due: p.due, cogs, revision: 1, warnings: p.warnings };
  });
}

interface SaleRow {
  id: number; doc_no: string; customer_id: number | null; status: string; revision: number; business_date: string;
  subtotal: number; discount: number; tax: number; total: number; paid: number; due: number;
}

function loadSale(ctx: Ctx, id: number): SaleRow {
  return requireRow(get<SaleRow>(ctx.db, 'SELECT id, doc_no, customer_id, status, revision, business_date, subtotal, discount, tax, total, paid, due FROM sales WHERE id = ?', id), 'sale', id);
}

function hasLiveReturns(ctx: Ctx, saleId: number): boolean {
  return scalar(ctx.db, "SELECT COUNT(*) FROM sale_returns WHERE sale_id = ? AND status = 'posted'", [saleId]) > 0;
}

export function snapshotSale(ctx: Ctx, saleId: number): unknown {
  const sale = get(ctx.db, 'SELECT * FROM sales WHERE id = ?', saleId);
  const items = all(ctx.db, 'SELECT * FROM sale_items WHERE sale_id = ? AND revision = (SELECT revision FROM sales WHERE id = ?)', saleId, saleId);
  return { sale, items };
}

/**
 * Edit invoice (Owner/Manager, open day only): one atomic transaction that reverses the live
 * postings and re-posts them under the same invoice number with revision + 1.
 * The previous revision's snapshot is written to the audit log.
 */
export function editSale(ctx: Ctx, saleId: number, input: Omit<SaleInput, 'date'>, reason: string): SaleResult {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to edit an invoice');
  return tx(ctx, () => {
    const old = loadSale(ctx, saleId);
    if (old.status !== 'posted') throw new PetraError('ALREADY_VOID', 'this invoice is void');
    assertDateOpen(ctx, old.business_date);
    if (hasLiveReturns(ctx, saleId)) throw new PetraError('HAS_RETURNS', 'void the returns first');
    const before = snapshotSale(ctx, saleId);
    const full: SaleInput = { ...input, date: old.business_date };
    // Prepare against the state AFTER reversal so stock checks and the credit limit see the true picture.
    reverseDocument(ctx, 'sale', saleId, old.business_date, `Edit: ${reason}`);
    const p = prepareSale(ctx, full);
    const accountId = full.paid > 0 ? resolveAccount(ctx, full.accountId) : null;
    const revision = old.revision + 1;
    run(
      ctx.db,
      `UPDATE sales SET customer_id = ?, revision = ?, price_tier = ?, subtotal = ?, disc_kind = ?, disc_value = ?, discount = ?, tax_bp = ?, tax = ?, round_off = ?, total = ?, paid = ?, due = ?, account_id = ?, note = ?, approved_by = ?, updated_at = ? WHERE id = ?`,
      p.customer?.id ?? null, revision, p.tier, p.inv.subtotal, full.discKind ?? null, full.discValue ?? 0, p.inv.discount, p.taxBp, p.inv.tax, p.inv.roundOff,
      p.inv.total, full.paid, p.due, accountId, full.note ?? '', full.approvedBy ?? null, ctx.now(), saleId
    );
    const cogs = postSaleBody(ctx, saleId, revision, old.business_date, full, p, accountId);
    audit(ctx, { action: 'sale.edit', entity: 'sale', entityId: saleId, before, after: { revision, total: p.inv.total, paid: full.paid }, reason });
    return { id: saleId, docNo: old.doc_no, total: p.inv.total, paid: full.paid, due: p.due, cogs, revision, warnings: p.warnings };
  });
}

export function voidSale(ctx: Ctx, saleId: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void an invoice');
  tx(ctx, () => {
    const s = loadSale(ctx, saleId);
    if (s.status === 'void') throw new PetraError('ALREADY_VOID', 'this invoice is already void');
    assertDateOpen(ctx, s.business_date);
    if (hasLiveReturns(ctx, saleId)) throw new PetraError('HAS_RETURNS', 'void the returns first');
    const before = snapshotSale(ctx, saleId);
    reverseDocument(ctx, 'sale', saleId, s.business_date, `Void: ${reason}`);
    run(ctx.db, "UPDATE sales SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?", reason, ctx.now(), ctx.userId, ctx.now(), saleId);
    audit(ctx, { action: 'sale.void', entity: 'sale', entityId: saleId, before, reason });
  });
}

// ===== Sales returns =====

export interface SaleReturnInput {
  saleId: number;
  date: string;
  items: { saleItemId: number; baseQty: number }[];
  refundMode: 'due' | 'cash';
  accountId?: number | null;
  reason?: string;
  /** Client-chosen id: the same id twice returns the first return and posts nothing new. */
  requestId?: string;
}

export interface SaleReturnResult {
  id: number;
  docNo: string;
  netAmount: number;
  taxAmount: number;
  total: number;
  cogsRestored: number;
}

interface ItemRow { id: number; product_id: number; base_qty: number; amount: number; alloc_discount: number; cogs: number }

export function returnedQty(ctx: Ctx, saleItemId: number): number {
  return scalar(ctx.db, "SELECT COALESCE(SUM(ri.base_qty),0) FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id WHERE ri.sale_item_id = ? AND r.status = 'posted'", [saleItemId]);
}

export function postSaleReturn(ctx: Ctx, input: SaleReturnInput): SaleReturnResult {
  const { requestId, ...data } = input;
  return postOnce(ctx, 'sale_return', requestId, data, () => postSaleReturnOnce(ctx, input));
}

function postSaleReturnOnce(ctx: Ctx, input: SaleReturnInput): SaleReturnResult {
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    const sale = loadSale(ctx, input.saleId);
    if (sale.status !== 'posted') throw new PetraError('ALREADY_VOID', 'this invoice is void');
    if (input.date < sale.business_date) throw new PetraError('INVALID_INPUT', 'return date cannot be before the invoice date', { field: 'date' });
    if (input.items.length === 0) throw new PetraError('INVALID_INPUT', 'choose at least one item to return', { field: 'items' });
    if (input.refundMode === 'due' && !sale.customer_id) throw new PetraError('INVALID_INPUT', 'a walk-in sale can only be refunded in cash', { field: 'refundMode' });

    const taxable = sale.subtotal - sale.discount;
    const prevNet = scalar(ctx.db, "SELECT COALESCE(SUM(net_amount),0) FROM sale_returns WHERE sale_id = ? AND status = 'posted'", [sale.id]);
    const prevTax = scalar(ctx.db, "SELECT COALESCE(SUM(tax_amount),0) FROM sale_returns WHERE sale_id = ? AND status = 'posted'", [sale.id]);

    const seen = new Set<number>();
    const lines: { item: ItemRow; baseQty: number; net: number; cogs: number }[] = [];
    for (const it of input.items) {
      if (seen.has(it.saleItemId)) throw new PetraError('INVALID_INPUT', 'an item appears twice', { field: 'items' });
      seen.add(it.saleItemId);
      if (!Number.isSafeInteger(it.baseQty) || it.baseQty <= 0) throw new PetraError('INVALID_INPUT', 'return quantity must be a positive whole number', { field: 'qty' });
      const item = requireRow(get<ItemRow>(ctx.db, 'SELECT id, product_id, base_qty, amount, alloc_discount, cogs FROM sale_items WHERE id = ? AND sale_id = ? AND revision = ?', it.saleItemId, sale.id, sale.revision), 'invoice item', it.saleItemId);
      const before = returnedQty(ctx, item.id);
      const net = cumulativeShare(item.amount - item.alloc_discount, before, it.baseQty, item.base_qty);
      const cogs = cumulativeShare(item.cogs, before, it.baseQty, item.base_qty);
      lines.push({ item, baseQty: it.baseQty, net, cogs });
    }
    const netAmount = lines.reduce((a, l) => a + l.net, 0);
    const cogsRestored = lines.reduce((a, l) => a + l.cogs, 0);
    const cumNet = prevNet + netAmount;
    const taxCum = taxable > 0 ? (cumNet >= taxable ? sale.tax : mulDiv(sale.tax, cumNet, taxable)) : 0;
    const taxAmount = Math.max(0, taxCum - prevTax);
    const total = netAmount + taxAmount;

    const docNo = nextDocNo(ctx, 'SRN');
    const accountId = input.refundMode === 'cash' && total > 0 ? resolveAccount(ctx, input.accountId) : null;
    const returnId = run(
      ctx.db,
      `INSERT INTO sale_returns(doc_no, sale_id, business_date, refund_mode, account_id, net_amount, tax_amount, total, cogs_restored, status, reason, user_id, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,'posted',?,?,?)`,
      docNo, sale.id, input.date, input.refundMode, accountId, netAmount, taxAmount, total, cogsRestored, input.reason ?? '', ctx.userId, ctx.now()
    ).id;

    for (const l of lines) {
      run(ctx.db, 'INSERT INTO sale_return_items(return_id, sale_item_id, product_id, base_qty, net_amount, cogs) VALUES(?,?,?,?,?,?)', returnId, l.item.id, l.item.product_id, l.baseQty, l.net, l.cogs);
      const product = loadProduct(ctx, l.item.product_id);
      if (product.track_expiry) {
        // Restock into the batches the item was sold from, in the order they were consumed.
        const rows = all<{ id: number; batch_id: number; base_qty: number; returned_qty: number }>(ctx.db, 'SELECT id, batch_id, base_qty, returned_qty FROM sale_item_batches WHERE sale_item_id = ? ORDER BY id', l.item.id);
        let need = l.baseQty;
        const parts: { batchId: number; qty: number; rowId: number }[] = [];
        for (const r of rows) {
          if (need === 0) break;
          const take = Math.min(r.base_qty - r.returned_qty, need);
          if (take > 0) { parts.push({ batchId: r.batch_id, qty: take, rowId: r.id }); need -= take; }
        }
        if (need > 0) throw new PetraError('OVER_RETURN', 'returning more than was sold', { item: l.item.id });
        let valueLeft = l.cogs;
        parts.forEach((part, idx) => {
          const v = idx === parts.length - 1 ? valueLeft : mulDiv(l.cogs, part.qty, l.baseQty);
          valueLeft -= v;
          stockIn(ctx, { productId: l.item.product_id, baseQty: part.qty, value: v, kind: 'sales_return', date: input.date, refType: 'sale_return', refId: returnId, batchId: part.batchId, updateLastCost: false });
          run(ctx.db, 'UPDATE sale_item_batches SET returned_qty = returned_qty + ? WHERE id = ?', part.qty, part.rowId);
        });
      } else {
        stockIn(ctx, { productId: l.item.product_id, baseQty: l.baseQty, value: l.cogs, kind: 'sales_return', date: input.date, refType: 'sale_return', refId: returnId, updateLastCost: false });
      }
    }

    if (total > 0) {
      if (sale.customer_id) {
        postLedger(ctx, { partyKind: 'customer', partyId: sale.customer_id, kind: 'return', amount: -total, refType: 'sale_return', refId: returnId, date: input.date, note: docNo });
        if (input.refundMode === 'cash') postLedger(ctx, { partyKind: 'customer', partyId: sale.customer_id, kind: 'payment', amount: total, refType: 'sale_return', refId: returnId, date: input.date, note: 'Cash refund' });
      }
      if (input.refundMode === 'cash' && accountId !== null) {
        postCash(ctx, { accountId, date: input.date, amount: -total, source: 'refund', refType: 'sale_return', refId: returnId, partyKind: sale.customer_id ? 'customer' : null, partyId: sale.customer_id });
      }
    }
    audit(ctx, { action: 'sale_return.create', entity: 'sale_return', entityId: returnId, after: { docNo, saleId: sale.id, total }, reason: input.reason });
    return { id: returnId, docNo, netAmount, taxAmount, total, cogsRestored };
  });
}

export function voidSaleReturn(ctx: Ctx, returnId: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void a return');
  tx(ctx, () => {
    const r = requireRow(get<{ id: number; status: string; business_date: string }>(ctx.db, 'SELECT id, status, business_date FROM sale_returns WHERE id = ?', returnId), 'return', returnId);
    if (r.status === 'void') throw new PetraError('ALREADY_VOID', 'this return is already void');
    assertDateOpen(ctx, r.business_date);
    reverseDocument(ctx, 'sale_return', returnId, r.business_date, `Void: ${reason}`);
    // Give back the per-batch "returned" allowance so the items can be returned again.
    const items = all<{ sale_item_id: number; product_id: number; base_qty: number }>(ctx.db, 'SELECT sale_item_id, product_id, base_qty FROM sale_return_items WHERE return_id = ?', returnId);
    for (const it of items) {
      if (!loadProduct(ctx, it.product_id).track_expiry) continue;
      let need = it.base_qty;
      const rows = all<{ id: number; returned_qty: number }>(ctx.db, 'SELECT id, returned_qty FROM sale_item_batches WHERE sale_item_id = ? AND returned_qty > 0 ORDER BY id DESC', it.sale_item_id);
      for (const row of rows) {
        if (need === 0) break;
        const take = Math.min(row.returned_qty, need);
        run(ctx.db, 'UPDATE sale_item_batches SET returned_qty = returned_qty - ? WHERE id = ?', take, row.id);
        need -= take;
      }
    }
    run(ctx.db, "UPDATE sale_returns SET status = 'void', void_reason = ? WHERE id = ?", reason, returnId);
    audit(ctx, { action: 'sale_return.void', entity: 'sale_return', entityId: returnId, reason });
  });
}
