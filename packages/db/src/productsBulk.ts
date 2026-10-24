import { PetraError, type ProductDeleteBlockReason, type ProductsDeletePreview } from '@petra/core';
import { audit } from './audit';
import { type Ctx, tx } from './ctx';
import { type Db, all, get, run } from './sql';

/**
 * Bulk product actions (archive / restore / permanent delete).
 *
 * Accounting rule: a product that has history anywhere (documents, stock, batches, adjustments) is NEVER
 * hard deleted. It can only be archived, so every old invoice, ledger and report keeps resolving it.
 * Only a product nothing refers to (a mistaken import, a duplicate) can really be removed.
 */

/** Tables that belong to a product and go away with it. Every other table pointing at products is history. */
const OWNED_TABLES = new Set(['product_packs', 'product_barcodes', 'supplier_products']);

/** Why a history table blocks deletion. Tables not listed here (added by a future migration) count as plain history. */
const TABLE_REASON: Record<string, ProductDeleteBlockReason> = {
  sale_items: 'hasSales',
  sale_return_items: 'hasSales',
  purchase_items: 'hasPurchases',
  purchase_return_items: 'hasPurchases',
  stock_movements: 'hasStock',
  stock_batches: 'hasStock',
  stock_adjustments: 'hasHistory'
};

/** When several reasons apply, the user is told the most business-relevant one first. */
const REASON_RANK: ProductDeleteBlockReason[] = ['hasSales', 'hasPurchases', 'hasStock', 'hasHistory'];

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface HistoryRef {
  table: string;
  column: string;
  reason: ProductDeleteBlockReason;
}

/**
 * Finds every non-owned table with a foreign key to products straight from the schema, so a table added by a
 * later migration blocks deletion by default instead of being forgotten here.
 */
function historyRefs(db: Db): HistoryRef[] {
  const rows = all<{ tbl: string; col: string }>(
    db,
    `SELECT m.name AS tbl, f."from" AS col
       FROM sqlite_master m, pragma_foreign_key_list(m.name) f
      WHERE m.type = 'table' AND f."table" = 'products'`
  );
  const out: HistoryRef[] = [];
  for (const r of rows) {
    if (OWNED_TABLES.has(r.tbl)) continue;
    if (!IDENT.test(r.tbl) || !IDENT.test(r.col)) continue; // names come from sqlite_master, but never interpolate odd ones
    out.push({ table: r.tbl, column: r.col, reason: TABLE_REASON[r.tbl] ?? 'hasHistory' });
  }
  return out;
}

function blockReason(db: Db, refs: HistoryRef[], id: number): ProductDeleteBlockReason | null {
  const found = new Set<ProductDeleteBlockReason>();
  for (const ref of refs) {
    if (get(db, `SELECT 1 AS x FROM ${ref.table} WHERE ${ref.column} = ? LIMIT 1`, id)) found.add(ref.reason);
  }
  // stock on hand without a movement row would still be stock history that must not vanish
  const p = get<{ stock_qty: number; stock_value: number }>(db, 'SELECT stock_qty, stock_value FROM products WHERE id = ?', id);
  if (p && (p.stock_qty !== 0 || p.stock_value !== 0)) found.add('hasStock');
  for (const r of REASON_RANK) if (found.has(r)) return r;
  return null;
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
}

function exists(db: Db, id: number): boolean {
  return get(db, 'SELECT 1 AS x FROM products WHERE id = ?', id) !== undefined;
}

/**
 * Archives or restores many products in one transaction. changed + skipped always equals ids.length:
 * unknown ids, repeated ids and products already in the target state are skipped, never an error.
 * (archiveProduct has no refusal rules today, e.g. none for stock on hand; if one is added, apply it here too.)
 */
export function archiveProducts(ctx: Ctx, ids: number[], archived: boolean): { changed: number; skipped: number } {
  const wanted = uniqueIds(ids);
  const target = archived ? 'archived' : 'active';
  return tx(ctx, () => {
    const changedIds: number[] = [];
    for (const id of wanted) {
      const cur = get<{ status: string }>(ctx.db, 'SELECT status FROM products WHERE id = ?', id);
      if (!cur || cur.status === target) continue;
      run(ctx.db, 'UPDATE products SET status = ?, updated_at = ? WHERE id = ?', target, ctx.now(), id);
      changedIds.push(id);
    }
    const result = { changed: changedIds.length, skipped: ids.length - changedIds.length };
    audit(ctx, {
      action: archived ? 'products.bulkArchive' : 'products.bulkRestore',
      entity: 'product',
      after: { ids: changedIds, requested: ids.length, ...result }
    });
    return result;
  });
}

/** Read-only: which of these products could really be deleted and which have history. Unknown ids are ignored. */
export function previewProductsDelete(ctx: Ctx, ids: number[]): ProductsDeletePreview {
  const refs = historyRefs(ctx.db);
  const deletable: number[] = [];
  const blocked: ProductsDeletePreview['blocked'] = [];
  for (const id of uniqueIds(ids)) {
    if (!exists(ctx.db, id)) continue;
    const reason = blockReason(ctx.db, refs, id);
    if (reason) blocked.push({ id, reason });
    else deletable.push(id);
  }
  return { deletable, blocked };
}

/**
 * Permanently deletes the products nothing refers to, together with their packs, barcodes and company links,
 * which frees the SKU and barcodes for re-import. Products with history are archived instead. All or nothing.
 */
export function deleteProducts(ctx: Ctx, ids: number[], confirm: string): { deleted: number; archivedInstead: number } {
  if (confirm !== 'DELETE') throw new PetraError('INVALID_INPUT', 'type DELETE to confirm', { field: 'confirm' });
  const wanted = uniqueIds(ids);
  return tx(ctx, () => {
    const refs = historyRefs(ctx.db);
    const deleted: { id: number; sku: string; name: string }[] = [];
    const archivedIds: number[] = [];
    let archivedInstead = 0;
    for (const id of wanted) {
      const row = get<{ sku: string; name: string; status: string }>(ctx.db, 'SELECT sku, name, status FROM products WHERE id = ?', id);
      if (!row) continue;
      if (blockReason(ctx.db, refs, id)) {
        if (row.status !== 'archived') {
          run(ctx.db, "UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?", ctx.now(), id);
          archivedIds.push(id);
        }
        archivedInstead++;
        continue;
      }
      // products and their packs point at each other (default units), so release those links first
      run(ctx.db, 'UPDATE products SET default_sale_pack_id = NULL, default_purchase_pack_id = NULL WHERE id = ?', id);
      run(ctx.db, 'DELETE FROM supplier_products WHERE product_id = ?', id);
      run(ctx.db, 'DELETE FROM product_barcodes WHERE product_id = ?', id);
      run(ctx.db, 'DELETE FROM product_packs WHERE product_id = ?', id);
      run(ctx.db, 'DELETE FROM products WHERE id = ?', id);
      deleted.push({ id, sku: row.sku, name: row.name });
    }
    const result = { deleted: deleted.length, archivedInstead };
    audit(ctx, {
      action: 'products.bulkDelete',
      entity: 'product',
      // the rows are gone, so the audit entry keeps SKU and name of what was removed
      after: { deletedProducts: deleted, archivedIds, requested: ids.length, ...result }
    });
    return result;
  });
}
