import { PetraError, mulDiv } from '@petra/core';
import { all, get, run } from './sql';
import { type Ctx, requireRow, tx } from './ctx';
import { audit } from './audit';

interface PackLite { id: number; factor: number }

/**
 * Which products a company supplies. The link is created by hand (Suppliers > Products) or automatically the
 * first time a product is bought from the company. `last_cost` is the cost of one default pack, in poisha.
 */
export function linkProducts(ctx: Ctx, supplierId: number, productIds: number[]): { added: number; already: number } {
  return tx(ctx, () => {
    requireRow(get(ctx.db, 'SELECT id FROM suppliers WHERE id = ?', supplierId), 'supplier', supplierId);
    let added = 0;
    let already = 0;
    let sort = Number(get<{ m: number | null }>(ctx.db, 'SELECT MAX(sort) AS m FROM supplier_products WHERE supplier_id = ?', supplierId)?.m ?? 0);
    for (const productId of [...new Set(productIds)]) {
      const p = get<{ id: number; default_purchase_pack_id: number | null }>(ctx.db, 'SELECT id, default_purchase_pack_id FROM products WHERE id = ?', productId);
      if (!p) throw new PetraError('NOT_FOUND', 'product not found', { what: 'product', id: productId });
      if (get(ctx.db, 'SELECT 1 AS x FROM supplier_products WHERE supplier_id = ? AND product_id = ?', supplierId, productId)) { already++; continue; }
      run(ctx.db, 'INSERT INTO supplier_products(supplier_id, product_id, default_pack_id, sort) VALUES(?,?,?,?)', supplierId, productId, p.default_purchase_pack_id, ++sort);
      added++;
    }
    if (added > 0) audit(ctx, { action: 'supplier.link', entity: 'supplier', entityId: supplierId, after: { added } });
    return { added, already };
  });
}

export function unlinkProducts(ctx: Ctx, supplierId: number, productIds: number[]): number {
  return tx(ctx, () => {
    let removed = 0;
    for (const productId of [...new Set(productIds)]) {
      removed += run(ctx.db, 'DELETE FROM supplier_products WHERE supplier_id = ? AND product_id = ?', supplierId, productId).changes;
    }
    if (removed > 0) audit(ctx, { action: 'supplier.unlink', entity: 'supplier', entityId: supplierId, after: { removed } });
    return removed;
  });
}

/** Inline edit: the box pack and the cost per box of one linked product. `lastCost` null clears the remembered cost. */
export function setSupplierProduct(ctx: Ctx, supplierId: number, productId: number, patch: { defaultPackId?: number | null; lastCost?: number | null }): void {
  tx(ctx, () => {
    requireRow(get(ctx.db, 'SELECT id FROM supplier_products WHERE supplier_id = ? AND product_id = ?', supplierId, productId), 'link', productId);
    if (patch.defaultPackId !== undefined && patch.defaultPackId !== null) {
      if (!get(ctx.db, 'SELECT 1 AS x FROM product_packs WHERE id = ? AND product_id = ?', patch.defaultPackId, productId)) throw new PetraError('NOT_FOUND', 'pack not found', { what: 'pack' });
    }
    if (patch.lastCost !== undefined && patch.lastCost !== null && (!Number.isSafeInteger(patch.lastCost) || patch.lastCost < 0)) throw new PetraError('INVALID_INPUT', 'cost must be a non-negative whole number of poisha', { field: 'cost' });
    // changing the pack re-expresses the remembered cost per the new pack so it keeps meaning the same price per piece
    const cur = get<{ default_pack_id: number | null; last_cost: number | null }>(ctx.db, 'SELECT default_pack_id, last_cost FROM supplier_products WHERE supplier_id = ? AND product_id = ?', supplierId, productId) as { default_pack_id: number | null; last_cost: number | null };
    const factorOf = (packId: number | null): number => (packId ? (get<{ factor: number }>(ctx.db, 'SELECT factor FROM product_packs WHERE id = ?', packId)?.factor ?? 1) : 1);
    const newPack = patch.defaultPackId !== undefined ? patch.defaultPackId : cur.default_pack_id;
    let newCost = patch.lastCost !== undefined ? patch.lastCost : cur.last_cost;
    if (patch.defaultPackId !== undefined && patch.lastCost === undefined && cur.last_cost !== null) newCost = mulDiv(cur.last_cost, factorOf(newPack), factorOf(cur.default_pack_id));
    run(ctx.db, 'UPDATE supplier_products SET default_pack_id = ?, last_cost = ? WHERE supplier_id = ? AND product_id = ?', newPack, newCost, supplierId, productId);
    audit(ctx, { action: 'supplier.link_edit', entity: 'supplier', entityId: supplierId, after: { productId, defaultPackId: newPack, lastCost: newCost } });
  });
}

/**
 * Called by every purchase line: creates the link the first time and remembers the cost per default pack.
 * `unitCost` is the cost per ONE unit of `pack`; null (free goods) links without touching the remembered cost.
 */
export function touchSupplierProduct(ctx: Ctx, supplierId: number, productId: number, pack: PackLite, unitCost: number | null): void {
  const row = get<{ id: number; default_pack_id: number | null }>(ctx.db, 'SELECT id, default_pack_id FROM supplier_products WHERE supplier_id = ? AND product_id = ?', supplierId, productId);
  if (!row) {
    const sort = Number(get<{ m: number | null }>(ctx.db, 'SELECT MAX(sort) AS m FROM supplier_products WHERE supplier_id = ?', supplierId)?.m ?? 0) + 1;
    const defaultPack = pack.factor > 1 ? pack.id : null;
    run(ctx.db, 'INSERT INTO supplier_products(supplier_id, product_id, default_pack_id, last_cost, sort) VALUES(?,?,?,?,?)', supplierId, productId, defaultPack, unitCost === null ? null : unitCost, sort);
    return;
  }
  if (unitCost === null) return;
  const defFactor = row.default_pack_id ? (get<{ factor: number }>(ctx.db, 'SELECT factor FROM product_packs WHERE id = ?', row.default_pack_id)?.factor ?? 1) : 1;
  run(ctx.db, 'UPDATE supplier_products SET last_cost = ? WHERE id = ?', mulDiv(unitCost, defFactor, pack.factor), row.id);
}

export interface SupplierProductRow {
  productId: number;
  defaultPackId: number | null;
  lastCost: number | null;
  sort: number;
}

export function supplierProductRows(ctx: Ctx, supplierId: number): SupplierProductRow[] {
  return all<{ product_id: number; default_pack_id: number | null; last_cost: number | null; sort: number }>(
    ctx.db, 'SELECT product_id, default_pack_id, last_cost, sort FROM supplier_products WHERE supplier_id = ? ORDER BY sort, id', supplierId
  ).map((r) => ({ productId: r.product_id, defaultPackId: r.default_pack_id, lastCost: r.last_cost, sort: r.sort }));
}
