import { SearchIndex, type Role, type SearchDoc, type SearchHit, type SearchKind } from '@petra/core';
import { all } from '../sql';
import type { Ctx } from '../ctx';

/** Builds the searchable records from the database. Staff get products and customers only. */
export function buildSearchDocs(ctx: Ctx): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const barcodes = new Map<number, string[]>();
  for (const b of all<{ product_id: number; barcode: string }>(ctx.db, 'SELECT product_id, barcode FROM product_barcodes')) barcodes.set(b.product_id, [...(barcodes.get(b.product_id) ?? []), b.barcode]);
  for (const p of all<{ id: number; sku: string; name: string; name_bn: string; cat: string | null; brand: string | null }>(
    ctx.db, "SELECT p.id, p.sku, p.name, p.name_bn, c.name AS cat, b.name AS brand FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id WHERE p.status = 'active'"
  )) docs.push({ kind: 'product', id: p.id, title: p.name, subtitle: p.sku, text: [p.name, p.name_bn, p.sku, ...(barcodes.get(p.id) ?? []), p.cat ?? '', p.brand ?? ''], weight: 4 });
  for (const c of all<{ id: number; name: string; name_bn: string; phone: string; address: string; area: string | null }>(
    ctx.db, "SELECT c.id, c.name, c.name_bn, c.phone, c.address, a.name AS area FROM customers c LEFT JOIN areas a ON a.id = c.area_id WHERE c.status = 'active'"
  )) docs.push({ kind: 'customer', id: c.id, title: c.name, subtitle: [c.phone, c.area].filter(Boolean).join(' · '), text: [c.name, c.name_bn, c.phone, c.address, c.area ?? ''], weight: 3 });
  for (const s of all<{ id: number; name: string; name_bn: string; phone: string }>(ctx.db, "SELECT id, name, name_bn, phone FROM suppliers WHERE status = 'active'")) {
    docs.push({ kind: 'supplier', id: s.id, title: s.name, subtitle: s.phone, text: [s.name, s.name_bn, s.phone], weight: 2 });
  }
  for (const s of all<{ id: number; doc_no: string; date: string; cname: string | null; status: string }>(
    ctx.db, 'SELECT s.id, s.doc_no, s.business_date AS date, c.name AS cname, s.status FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id DESC LIMIT 20000'
  )) docs.push({ kind: 'sale', id: s.id, title: s.doc_no, subtitle: [s.date, s.cname, s.status === 'void' ? 'void' : ''].filter(Boolean).join(' · '), text: [s.doc_no, s.cname ?? ''], weight: 1 });
  for (const p of all<{ id: number; doc_no: string; date: string; sname: string | null; supplier_ref: string }>(
    ctx.db, 'SELECT p.id, p.doc_no, p.business_date AS date, s.name AS sname, p.supplier_ref FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.id DESC LIMIT 20000'
  )) docs.push({ kind: 'purchase', id: p.id, title: p.doc_no, subtitle: [p.date, p.sname].filter(Boolean).join(' · '), text: [p.doc_no, p.sname ?? '', p.supplier_ref], weight: 1 });
  return docs;
}

/** Lazily rebuilt: the dispatcher counts writes, and the next query after a write rebuilds the index. */
export class SearchService {
  readonly index = new SearchIndex();
  private builtAt = -1;
  lastBuildMs = 0;

  ensure(ctx: Ctx, generation: number): void {
    if (this.builtAt === generation) return;
    const t0 = performance.now();
    this.index.build(buildSearchDocs(ctx));
    this.lastBuildMs = performance.now() - t0;
    this.builtAt = generation;
  }

  query(ctx: Ctx, generation: number, role: Role, q: string, limit: number): { hits: SearchHit[]; ms: number; size: number } {
    this.ensure(ctx, generation);
    const allowed: SearchKind[] = role === 'staff' ? ['product', 'customer'] : ['product', 'customer', 'supplier', 'sale', 'purchase'];
    const t0 = performance.now();
    const hits = this.index.search(q, limit, (k) => allowed.includes(k));
    return { hits, ms: performance.now() - t0, size: this.index.size };
  }
}
