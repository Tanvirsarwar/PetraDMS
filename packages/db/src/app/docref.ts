import { all, type Db } from '../sql';

const DOC_TABLE: Record<string, string> = {
  sale: 'sales',
  sale_return: 'sale_returns',
  purchase: 'purchases',
  purchase_return: 'purchase_returns',
  payment: 'payments',
  stock_adjustment: 'stock_adjustments',
  expense: 'expenses'
};

/** Resolves `ref_type + ref_id` pairs to printable document numbers in one query per type. */
export function docNumbers(db: Db, refs: { refType: string | null; refId: number | null }[]): Map<string, string> {
  const byType = new Map<string, Set<number>>();
  for (const r of refs) {
    if (r.refType && r.refId !== null && DOC_TABLE[r.refType]) {
      if (!byType.has(r.refType)) byType.set(r.refType, new Set());
      byType.get(r.refType)!.add(r.refId);
    }
  }
  const out = new Map<string, string>();
  for (const [type, ids] of byType) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const rows = all<{ id: number; doc_no: string }>(db, `SELECT id, doc_no FROM ${DOC_TABLE[type]} WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
      for (const r of rows) out.set(`${type}:${r.id}`, r.doc_no);
    }
  }
  return out;
}

export const docKey = (refType: string | null, refId: number | null): string => `${refType ?? ''}:${refId ?? ''}`;
