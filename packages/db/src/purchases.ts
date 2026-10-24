import { PetraError, computePurchase, mulDiv, type DiscountKind } from '@petra/core';
import { get, run, scalar } from './sql';
import { type Ctx, assertDateOpen, requireRow, tx } from './ctx';
import { nextDocNo } from './settings';
import { postCash, postLedger, resolveAccount } from './ledger';
import { loadProduct, stockIn, stockOut } from './stock';
import { resolvePack } from './sales';
import { reverseDocument } from './reverse';
import { audit } from './audit';
import { touchSupplierProduct } from './supplierProducts';
import { postOnce } from './idempotency';

export interface PurchaseLineInput {
  productId: number;
  /** The pack ("box") the cost is quoted in; omit for the base unit. */
  packId?: number | null;
  /** Whole packs (boxes). May be 0 when only pieces are bought. */
  qty: number;
  /** Extra pieces beside the boxes (5 box + 6 pcs). */
  looseQty?: number;
  /** Cost per ONE unit of the chosen pack level, in poisha. */
  unitCost: number;
  /** `free` is bonus stock from the company: it raises stock at zero cost and lowers the average cost. */
  kind?: 'normal' | 'free';
  discKind?: DiscountKind | null;
  /** pct: basis points. fixed: poisha. */
  discValue?: number;
  batchNo?: string;
  expiry?: string | null;
}

export interface PurchaseInput {
  supplierId?: number | null;
  /** The company's own invoice number. */
  supplierRef?: string;
  date: string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  lines: PurchaseLineInput[];
  /** Fixed discount on the whole bill, in poisha (kept from v1). Overridden by discKind/discValue. */
  discount?: number;
  discKind?: DiscountKind | null;
  discValue?: number;
  /** VAT or other charge, in poisha. Added to the total and to the stock cost. */
  tax?: number;
  /** Freight / extra cost, in poisha. Added to the total and allocated into the stock cost. */
  freight?: number;
  paid: number;
  accountId?: number | null;
  note?: string;
  /** Required to post a company invoice number that was already used for this company. */
  duplicateReason?: string;
  /** Client-chosen id: the same id twice (double click, retry) returns the first purchase and posts nothing new. */
  requestId?: string;
}

export interface PurchaseResult { id: number; docNo: string; total: number; paid: number; due: number }

/** The posted purchase of this company with the same invoice number, if any (case-insensitive). */
export function findDuplicateInvoice(ctx: Ctx, supplierId: number | null | undefined, ref: string | undefined): { id: number; docNo: string } | null {
  const r = (ref ?? '').trim();
  if (!supplierId || !r) return null;
  const row = get<{ id: number; doc_no: string }>(ctx.db, "SELECT id, doc_no FROM purchases WHERE supplier_id = ? AND lower(supplier_ref) = lower(?) AND status = 'posted' ORDER BY id LIMIT 1", supplierId, r);
  return row ? { id: row.id, docNo: row.doc_no } : null;
}

export function postPurchase(ctx: Ctx, input: PurchaseInput): PurchaseResult {
  const { requestId, ...data } = input;
  return postOnce(ctx, 'purchase', requestId, data, () => postPurchaseOnce(ctx, input));
}

function postPurchaseOnce(ctx: Ctx, input: PurchaseInput): PurchaseResult {
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    if (input.lines.length === 0) throw new PetraError('INVALID_INPUT', 'add at least one item', { field: 'lines' });
    if (!Number.isSafeInteger(input.paid) || input.paid < 0) throw new PetraError('INVALID_INPUT', 'paid must be a non-negative whole number of poisha', { field: 'paid' });
    const legacy = input.discount ?? 0;
    if (!Number.isSafeInteger(legacy) || legacy < 0) throw new PetraError('INVALID_INPUT', 'discount must be a non-negative whole number of poisha', { field: 'discount' });
    if (input.supplierId) {
      const s = requireRow(get<{ status: string }>(ctx.db, 'SELECT status FROM suppliers WHERE id = ?', input.supplierId), 'supplier', input.supplierId);
      if (s.status !== 'active') throw new PetraError('INVALID_INPUT', 'supplier is archived', { field: 'supplier' });
    }
    const dup = findDuplicateInvoice(ctx, input.supplierId, input.supplierRef);
    const dupReason = (input.duplicateReason ?? '').trim();
    if (dup && !dupReason) throw new PetraError('DUPLICATE_INVOICE', 'this company invoice number was already entered', { docNo: dup.docNo, ref: (input.supplierRef ?? '').trim() });

    const prepared = input.lines.map((l) => {
      const product = loadProduct(ctx, l.productId);
      if (product.status !== 'active') throw new PetraError('INVALID_INPUT', `${product.name} is archived`, { field: 'product', product: product.name });
      const pack = resolvePack(ctx, l.productId, l.packId);
      return { l, product, pack };
    });
    const calc = computePurchase({
      lines: prepared.map((x) => ({ kind: x.l.kind ?? 'normal', factor: x.pack.factor, boxes: x.l.qty, pcs: x.l.looseQty ?? 0, costPerBox: x.l.unitCost, discKind: x.l.discKind ?? null, discValue: x.l.discValue ?? 0 })),
      billDiscKind: input.discKind ?? (legacy > 0 ? 'fixed' : null),
      billDiscValue: input.discKind ? input.discValue ?? 0 : legacy,
      tax: input.tax ?? 0,
      freight: input.freight ?? 0
    });
    if (input.paid > calc.total) throw new PetraError('OVER_PAYMENT', 'paid is more than the bill total', { total: calc.total, paid: input.paid });
    const due = calc.total - input.paid;
    if (!input.supplierId && due !== 0) throw new PetraError('INVALID_INPUT', 'a purchase without a supplier must be paid in full', { field: 'paid' });

    const accountId = input.paid > 0 ? resolveAccount(ctx, input.accountId) : null;
    const docNo = nextDocNo(ctx, 'PUR');
    const id = run(
      ctx.db,
      `INSERT INTO purchases(doc_no, supplier_id, supplier_ref, status, business_date, invoice_date, due_date, subtotal, disc_kind, disc_value, discount, tax, freight, total, paid, due, account_id, note, dup_reason, user_id, created_at)
       VALUES(?,?,?,'posted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      docNo, input.supplierId ?? null, (input.supplierRef ?? '').trim(), input.date, input.invoiceDate ?? null, input.dueDate ?? null, calc.subtotal,
      input.discKind ?? (legacy > 0 ? 'fixed' : null), input.discKind ? input.discValue ?? 0 : legacy, calc.discount, calc.tax, calc.freight,
      calc.total, input.paid, due, accountId, input.note ?? '', dup ? dupReason : '', ctx.userId, ctx.now()
    ).id;

    prepared.forEach((x, i) => {
      const r = calc.lines[i] as (typeof calc.lines)[number];
      // Whole boxes keep the box pack and carry the extra pieces; pieces alone are stored on the base pack.
      const useBox = r.boxes > 0;
      const stored = useBox ? x.pack : resolvePack(ctx, x.product.id, null);
      const qty = useBox ? r.boxes : r.pcs;
      const loose = useBox ? r.pcs : 0;
      const unitCost = useBox ? x.l.unitCost : mulDiv(x.l.unitCost, 1, x.pack.factor);
      const kind = x.l.kind ?? 'normal';
      const itemId = run(
        ctx.db,
        `INSERT INTO purchase_items(purchase_id, line_no, product_id, pack_id, pack_name, factor, qty, loose_qty, base_qty, unit_cost, line_kind, disc_kind, disc_value, discount, amount, alloc_discount, alloc_charge, batch_no, expiry_date)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, i + 1, x.product.id, stored.id, stored.name, stored.factor, qty, loose, r.baseQty, kind === 'free' ? 0 : unitCost, kind,
        kind === 'free' ? null : x.l.discKind ?? null, kind === 'free' ? 0 : x.l.discValue ?? 0, r.discount, r.amount, r.allocDiscount, r.allocCharge, x.l.batchNo ?? '', x.l.expiry ?? null
      ).id;
      const s = stockIn(ctx, { productId: x.product.id, baseQty: r.baseQty, value: r.cost, kind: 'purchase', date: input.date, refType: 'purchase', refId: id, batch: { batchNo: x.l.batchNo, expiry: x.l.expiry }, updateLastCost: kind === 'normal' });
      if (s.batchId) run(ctx.db, 'UPDATE purchase_items SET batch_id = ? WHERE id = ?', s.batchId, itemId);
      if (input.supplierId) touchSupplierProduct(ctx, input.supplierId, x.product.id, x.pack, kind === 'normal' ? x.l.unitCost : null);
    });

    if (input.supplierId) {
      if (calc.total !== 0) postLedger(ctx, { partyKind: 'supplier', partyId: input.supplierId, kind: 'purchase', amount: calc.total, refType: 'purchase', refId: id, date: input.date });
      if (input.paid > 0) postLedger(ctx, { partyKind: 'supplier', partyId: input.supplierId, kind: 'payment', amount: -input.paid, refType: 'purchase', refId: id, date: input.date, note: 'Paid at purchase' });
    }
    if (input.paid > 0 && accountId !== null) {
      postCash(ctx, { accountId, date: input.date, amount: -input.paid, source: 'purchase', refType: 'purchase', refId: id, partyKind: input.supplierId ? 'supplier' : null, partyId: input.supplierId ?? null });
    }
    audit(ctx, { action: 'purchase.create', entity: 'purchase', entityId: id, after: { docNo, total: calc.total, paid: input.paid, lines: input.lines.length } });
    return { id, docNo, total: calc.total, paid: input.paid, due };
  });
}

export function voidPurchase(ctx: Ctx, purchaseId: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void a purchase');
  tx(ctx, () => {
    const p = requireRow(get<{ id: number; status: string; business_date: string }>(ctx.db, 'SELECT id, status, business_date FROM purchases WHERE id = ?', purchaseId), 'purchase', purchaseId);
    if (p.status === 'void') throw new PetraError('ALREADY_VOID', 'this purchase is already void');
    assertDateOpen(ctx, p.business_date);
    // like an invoice: undo the returns made against it first, so a return never points at stock that is gone
    if (scalar(ctx.db, "SELECT COUNT(*) FROM purchase_returns WHERE purchase_id = ? AND status = 'posted'", [purchaseId]) > 0) throw new PetraError('HAS_RETURNS', 'void the returns first');
    reverseDocument(ctx, 'purchase', purchaseId, p.business_date, `Void: ${reason}`);
    run(ctx.db, "UPDATE purchases SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ? WHERE id = ?", reason, ctx.now(), ctx.userId, purchaseId);
    audit(ctx, { action: 'purchase.void', entity: 'purchase', entityId: purchaseId, reason });
  });
}

export interface PurchaseReturnInput {
  supplierId?: number | null;
  purchaseId?: number | null;
  date: string;
  lines: { productId: number; baseQty: number; /** Total credit the supplier gives for this line, in poisha. */ credit: number; batchId?: number | null }[];
  refundMode: 'due' | 'cash';
  accountId?: number | null;
  reason?: string;
  /** Client-chosen id: the same id twice returns the first return and posts nothing new. */
  requestId?: string;
}

/**
 * Purchase return: stock leaves at the CURRENT average cost; any difference to the credit the supplier
 * gives is booked to COGS (section 5.4) via `variance = cost_value - credit`.
 */
export function postPurchaseReturn(ctx: Ctx, input: PurchaseReturnInput): PurchaseReturnResult {
  const { requestId, ...data } = input;
  return postOnce(ctx, 'purchase_return', requestId, data, () => postPurchaseReturnOnce(ctx, input));
}

type PurchaseReturnResult = { id: number; docNo: string; credit: number; costValue: number; variance: number };

function postPurchaseReturnOnce(ctx: Ctx, input: PurchaseReturnInput): PurchaseReturnResult {
  return tx(ctx, () => {
    assertDateOpen(ctx, input.date);
    if (input.lines.length === 0) throw new PetraError('INVALID_INPUT', 'choose at least one item', { field: 'lines' });
    if (input.refundMode === 'due' && !input.supplierId) throw new PetraError('INVALID_INPUT', 'a return without a supplier must be refunded in cash', { field: 'refundMode' });
    for (const l of input.lines) {
      if (!Number.isSafeInteger(l.credit) || l.credit < 0) throw new PetraError('INVALID_INPUT', 'credit must be a non-negative whole number of poisha', { field: 'credit' });
      if (!Number.isSafeInteger(l.baseQty) || l.baseQty <= 0) throw new PetraError('INVALID_INPUT', 'return quantity must be a positive whole number', { field: 'qty' });
    }
    if (input.purchaseId) assertWithinPurchase(ctx, input.purchaseId, input.lines);
    const docNo = nextDocNo(ctx, 'PRN');
    const credit = input.lines.reduce((a, l) => a + l.credit, 0);
    const accountId = input.refundMode === 'cash' && credit > 0 ? resolveAccount(ctx, input.accountId) : null;
    const id = run(
      ctx.db,
      `INSERT INTO purchase_returns(doc_no, purchase_id, supplier_id, business_date, refund_mode, account_id, credit, cost_value, variance, status, reason, user_id, created_at)
       VALUES(?,?,?,?,?,?,?,0,0,'posted',?,?,?)`,
      docNo, input.purchaseId ?? null, input.supplierId ?? null, input.date, input.refundMode, accountId, credit, input.reason ?? '', ctx.userId, ctx.now()
    ).id;
    let costValue = 0;
    for (const l of input.lines) {
      const out = stockOut(ctx, { productId: l.productId, baseQty: l.baseQty, kind: 'purchase_return', date: input.date, refType: 'purchase_return', refId: id, preferBatchId: l.batchId });
      costValue += out.cogs;
      run(ctx.db, 'INSERT INTO purchase_return_items(return_id, product_id, batch_id, base_qty, credit, cost_value) VALUES(?,?,?,?,?,?)', id, l.productId, l.batchId ?? null, l.baseQty, l.credit, out.cogs);
    }
    const variance = costValue - credit;
    run(ctx.db, 'UPDATE purchase_returns SET cost_value = ?, variance = ? WHERE id = ?', costValue, variance, id);
    if (credit > 0) {
      if (input.supplierId) {
        postLedger(ctx, { partyKind: 'supplier', partyId: input.supplierId, kind: 'return', amount: -credit, refType: 'purchase_return', refId: id, date: input.date, note: docNo });
        if (input.refundMode === 'cash') postLedger(ctx, { partyKind: 'supplier', partyId: input.supplierId, kind: 'payment', amount: credit, refType: 'purchase_return', refId: id, date: input.date, note: 'Cash refund received' });
      }
      if (input.refundMode === 'cash' && accountId !== null) {
        postCash(ctx, { accountId, date: input.date, amount: credit, source: 'refund', refType: 'purchase_return', refId: id, partyKind: input.supplierId ? 'supplier' : null, partyId: input.supplierId ?? null });
      }
    }
    audit(ctx, { action: 'purchase_return.create', entity: 'purchase_return', entityId: id, after: { docNo, credit, costValue }, reason: input.reason });
    return { id, docNo, credit, costValue, variance };
  });
}

/** Returns against a purchase can never exceed what that purchase brought in minus what was already returned (box + pcs, in base units). */
function assertWithinPurchase(ctx: Ctx, purchaseId: number, lines: { productId: number; baseQty: number }[]): void {
  requireRow(get(ctx.db, 'SELECT id FROM purchases WHERE id = ?', purchaseId), 'purchase', purchaseId);
  const wanted = new Map<number, number>();
  for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.baseQty);
  for (const [productId, qty] of wanted) {
    const bought = scalar(ctx.db, 'SELECT COALESCE(SUM(base_qty),0) FROM purchase_items WHERE purchase_id = ? AND product_id = ?', [purchaseId, productId]);
    const returned = scalar(ctx.db, "SELECT COALESCE(SUM(ri.base_qty),0) FROM purchase_return_items ri JOIN purchase_returns r ON r.id = ri.return_id WHERE r.purchase_id = ? AND r.status = 'posted' AND ri.product_id = ?", [purchaseId, productId]);
    if (qty > bought - returned) throw new PetraError('OVER_RETURN', 'returning more than was bought', { bought, returned, wanted: qty });
  }
}

export function voidPurchaseReturn(ctx: Ctx, returnId: number, reason: string): void {
  if (!reason.trim()) throw new PetraError('REASON_REQUIRED', 'a reason is required to void a return');
  tx(ctx, () => {
    const r = requireRow(get<{ id: number; status: string; business_date: string }>(ctx.db, 'SELECT id, status, business_date FROM purchase_returns WHERE id = ?', returnId), 'return', returnId);
    if (r.status === 'void') throw new PetraError('ALREADY_VOID', 'this return is already void');
    assertDateOpen(ctx, r.business_date);
    reverseDocument(ctx, 'purchase_return', returnId, r.business_date, `Void: ${reason}`);
    run(ctx.db, "UPDATE purchase_returns SET status = 'void', void_reason = ? WHERE id = ?", reason, returnId);
    audit(ctx, { action: 'purchase_return.void', entity: 'purchase_return', entityId: returnId, reason });
  });
}

export { mulDiv };
