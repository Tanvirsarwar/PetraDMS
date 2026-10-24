import { PetraError, mulDiv, type PriceSuggestion, type SupplierProductDto } from '@petra/core';
import type { z } from 'zod';
import type { priceChangeInput } from '@petra/core';
import { all, get, run } from '../sql';
import { type Ctx, requireRow, tx } from '../ctx';
import { audit } from '../audit';
import { findDuplicateInvoice } from '../purchases';
import { linkProducts, supplierProductRows } from '../supplierProducts';

type PriceChange = z.output<typeof priceChangeInput>;

export function listSupplierProducts(ctx: Ctx, supplierId: number): SupplierProductDto[] {
  requireRow(get(ctx.db, 'SELECT id FROM suppliers WHERE id = ?', supplierId), 'supplier', supplierId);
  return supplierProductRows(ctx, supplierId);
}

/** Link by explicit ids and/or "every active product of this brand / category". */
export function linkSelection(ctx: Ctx, i: { supplierId: number; productIds: number[]; brandId?: number; categoryId?: number }): { added: number; already: number } {
  const ids = new Set(i.productIds);
  if (i.brandId) for (const r of all<{ id: number }>(ctx.db, "SELECT id FROM products WHERE brand_id = ? AND status = 'active'", i.brandId)) ids.add(r.id);
  if (i.categoryId) for (const r of all<{ id: number }>(ctx.db, "SELECT id FROM products WHERE category_id = ? AND status = 'active'", i.categoryId)) ids.add(r.id);
  return linkProducts(ctx, i.supplierId, [...ids]);
}

export function checkInvoiceRef(ctx: Ctx, supplierId: number, ref: string): { docNo: string | null } {
  return { docNo: findDuplicateInvoice(ctx, supplierId, ref)?.docNo ?? null };
}

// ===== Purchase draft: one per user, replaced on every autosave, cleared when the purchase is saved =====
export function loadPurchaseDraft(ctx: Ctx, userId: number): { payload: string | null; updatedAt: string | null } {
  const r = get<{ payload_json: string; updated_at: string }>(ctx.db, 'SELECT payload_json, updated_at FROM purchase_drafts WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
  return { payload: r?.payload_json ?? null, updatedAt: r?.updated_at ?? null };
}

export function savePurchaseDraft(ctx: Ctx, userId: number, payload: string): void {
  const supplierId = (() => {
    try {
      const v = (JSON.parse(payload) as { supplierId?: unknown }).supplierId;
      return typeof v === 'number' && get(ctx.db, 'SELECT id FROM suppliers WHERE id = ?', v) ? v : null;
    } catch {
      throw new PetraError('INVALID_INPUT', 'draft is not valid', { field: 'payload' });
    }
  })();
  tx(ctx, () => {
    run(ctx.db, 'DELETE FROM purchase_drafts WHERE user_id = ?', userId);
    run(ctx.db, 'INSERT INTO purchase_drafts(user_id, supplier_id, payload_json, updated_at) VALUES(?,?,?,?)', userId, supplierId, payload, ctx.now());
  });
}

export function clearPurchaseDraft(ctx: Ctx, userId: number): void {
  run(ctx.db, 'DELETE FROM purchase_drafts WHERE user_id = ?', userId);
}

// ===== Update selling prices after a purchase =====

/** One row per product bought on the invoice (free goods do not set a price), with this invoice's landed cost per pack. */
export function priceSuggestions(ctx: Ctx, purchaseId: number): PriceSuggestion[] {
  requireRow(get(ctx.db, 'SELECT id FROM purchases WHERE id = ?', purchaseId), 'purchase', purchaseId);
  const lines = all<{ product_id: number; pack_id: number | null; pack_name: string; factor: number; base_qty: number; cost: number; sku: string; name: string; name_bn: string; base_unit: string; pr: number; pw: number; pd: number }>(
    ctx.db,
    `SELECT i.product_id, i.pack_id, i.pack_name, i.factor, i.base_qty, (i.amount - i.alloc_discount + i.alloc_charge) AS cost, p.sku, p.name, p.name_bn, p.base_unit,
            p.price_retail AS pr, p.price_wholesale AS pw, p.price_dealer AS pd
       FROM purchase_items i JOIN products p ON p.id = i.product_id WHERE i.purchase_id = ? AND i.line_kind = 'normal' ORDER BY i.line_no`, purchaseId
  );
  const out = new Map<number, { sum: PriceSuggestion; cost: number; qty: number; boxFactor: number }>();
  for (const l of lines) {
    // The price step works in the largest pack the invoice used for the product.
    const box = get<{ id: number; name: string; factor: number; price_retail: number | null; price_wholesale: number | null; price_dealer: number | null }>(
      ctx.db, 'SELECT id, name, factor, price_retail, price_wholesale, price_dealer FROM product_packs WHERE product_id = ? AND factor = (SELECT MAX(i2.factor) FROM purchase_items i2 WHERE i2.purchase_id = ? AND i2.product_id = ?)', l.product_id, purchaseId, l.product_id
    );
    const f = box?.factor ?? 1;
    const cur = out.get(l.product_id);
    if (cur) { cur.cost += l.cost; cur.qty += l.base_qty; continue; }
    out.set(l.product_id, {
      cost: l.cost, qty: l.base_qty, boxFactor: f,
      sum: {
        productId: l.product_id, sku: l.sku, name: l.name, nameBn: l.name_bn, baseUnit: l.base_unit,
        packId: f > 1 ? box?.id ?? null : null, packName: f > 1 ? box?.name ?? l.pack_name : l.base_unit, factor: f, costPerPack: 0,
        current: { retail: box?.price_retail ?? l.pr * f, wholesale: box?.price_wholesale ?? l.pw * f, dealer: box?.price_dealer ?? l.pd * f }
      }
    });
  }
  return [...out.values()].map((v) => ({ ...v.sum, costPerPack: v.qty > 0 ? mulDiv(v.cost, v.boxFactor, v.qty) : 0 }));
}

/** Applies confirmed selling prices. A box price is the pack's own price; `alsoBase` sets the per-piece price from it. */
export function applyPrices(ctx: Ctx, changes: PriceChange[]): number {
  return tx(ctx, () => {
    for (const c of changes) {
      const prod = requireRow(get<{ id: number; min_price: number; price_retail: number; price_wholesale: number; price_dealer: number }>(ctx.db, 'SELECT id, min_price, price_retail, price_wholesale, price_dealer FROM products WHERE id = ?', c.productId), 'product', c.productId);
      const before = { retail: prod.price_retail, wholesale: prod.price_wholesale, dealer: prod.price_dealer };
      let packFactor = 1;
      if (c.packId) {
        const pack = requireRow(get<{ id: number; factor: number }>(ctx.db, 'SELECT id, factor FROM product_packs WHERE id = ? AND product_id = ?', c.packId, c.productId), 'pack', c.packId);
        packFactor = pack.factor;
        run(ctx.db, 'UPDATE product_packs SET price_retail = ?, price_wholesale = ?, price_dealer = ? WHERE id = ?', c.priceRetail, c.priceWholesale, c.priceDealer, pack.id);
      }
      if (!c.packId || c.alsoBase) {
        const r = mulDiv(c.priceRetail, 1, packFactor);
        const w = mulDiv(c.priceWholesale, 1, packFactor);
        const d = mulDiv(c.priceDealer, 1, packFactor);
        if (prod.min_price > 0 && r > 0 && prod.min_price > r) throw new PetraError('INVALID_INPUT', 'minimum price is above the retail price', { field: 'minPrice' });
        run(ctx.db, 'UPDATE products SET price_retail = ?, price_wholesale = ?, price_dealer = ?, updated_at = ? WHERE id = ?', r, w, d, ctx.now(), c.productId);
      }
      audit(ctx, { action: 'product.prices', entity: 'product', entityId: c.productId, before, after: { packId: c.packId, retail: c.priceRetail, wholesale: c.priceWholesale, dealer: c.priceDealer, alsoBase: c.alsoBase } });
    }
    return changes.length;
  });
}
