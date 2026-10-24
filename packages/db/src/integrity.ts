import { type Db, all, get, scalar } from './sql';
import { getRaw } from './settings';

export interface IntegrityViolation {
  invariant: string;
  message: string;
  ids: (number | string)[];
}

const POSTING_TABLES = [
  'stock_movements', 'party_ledger', 'cash_transactions', 'sales', 'purchases', 'payments', 'expenses',
  'sale_returns', 'purchase_returns', 'stock_adjustments', 'salary_sheets'
] as const;

const VOID_DOCS: { ref: string; table: string }[] = [
  { ref: 'sale', table: 'sales' },
  { ref: 'purchase', table: 'purchases' },
  { ref: 'payment', table: 'payments' },
  { ref: 'expense', table: 'expenses' },
  { ref: 'sale_return', table: 'sale_returns' },
  { ref: 'purchase_return', table: 'purchase_returns' },
  { ref: 'stock_adjustment', table: 'stock_adjustments' },
  { ref: 'salary_sheet', table: 'salary_sheets' }
];

function ids(db: Db, sql: string, ...params: (string | number)[]): number[] {
  return all<{ id: number }>(db, sql, ...params).map((r) => r.id);
}

/**
 * Asserts invariants I1-I10 from section 7 of the plan and I11-I12 added in v1.1 (box + pcs lines, company links) and I13 in v1.1.2 (funds) (plus a few document-level consistency checks).
 * Returns every violation found; an empty array means the database is sound.
 */
export function checkIntegrity(db: Db, opts: { stopAtFirst?: boolean } = {}): IntegrityViolation[] {
  const out: IntegrityViolation[] = [];
  const add = (invariant: string, message: string, offending: (number | string)[]): boolean => {
    if (offending.length > 0) out.push({ invariant, message, ids: offending });
    return opts.stopAtFirst === true && out.length > 0;
  };
  const checks: (() => boolean)[] = [];

  // I1: sum(movement base_qty) == products.stock_qty
  checks.push(() => add('I1', 'product stock_qty differs from the sum of its stock movements',
    ids(db, `SELECT p.id FROM products p WHERE p.stock_qty != COALESCE((SELECT SUM(base_qty) FROM stock_movements m WHERE m.product_id = p.id), 0)`)));

  // I2: for track_expiry products, sum(qty_remaining) == stock_qty; and each batch matches its own movements
  checks.push(() => add('I2', 'batch quantities differ from stock_qty for an expiry-tracked product',
    ids(db, `SELECT p.id FROM products p WHERE p.track_expiry = 1 AND p.stock_qty != COALESCE((SELECT SUM(qty_remaining) FROM stock_batches b WHERE b.product_id = p.id), 0)`)));
  checks.push(() => add('I2', 'a batch quantity differs from the sum of its stock movements',
    ids(db, `SELECT b.id FROM stock_batches b WHERE b.qty_remaining != COALESCE((SELECT SUM(base_qty) FROM stock_movements m WHERE m.batch_id = b.id), 0)`)));

  // I3: sum(movement value) == products.stock_value
  checks.push(() => add('I3', 'product stock_value differs from the sum of its stock movements',
    ids(db, `SELECT p.id FROM products p WHERE p.stock_value != COALESCE((SELECT SUM(value) FROM stock_movements m WHERE m.product_id = p.id), 0)`)));

  // I4: cached party balances equal the ledger
  for (const [kind, table] of [['customer', 'customers'], ['supplier', 'suppliers'], ['employee', 'employees']] as const) {
    checks.push(() => add('I4', `${kind} balance differs from the sum of its ledger entries`,
      ids(db, `SELECT t.id FROM ${table} t WHERE t.balance != COALESCE((SELECT SUM(amount) FROM party_ledger l WHERE l.party_kind = '${kind}' AND l.party_id = t.id), 0)`)));
  }

  // I5: invoice arithmetic
  checks.push(() => add('I5', 'sale total != subtotal - discount + tax + round_off, or paid + due != total',
    ids(db, `SELECT id FROM sales WHERE total != subtotal - discount + tax + round_off OR paid + due != total OR due < 0`)));
  checks.push(() => add('I5', 'sale subtotal differs from the sum of its current lines, or the invoice discount is not fully allocated',
    ids(db, `SELECT s.id FROM sales s WHERE s.subtotal != COALESCE((SELECT SUM(amount) FROM sale_items i WHERE i.sale_id = s.id AND i.revision = s.revision), 0)
                OR s.discount != COALESCE((SELECT SUM(alloc_discount) FROM sale_items i WHERE i.sale_id = s.id AND i.revision = s.revision), 0)`)));
  checks.push(() => add('I5', 'purchase total != subtotal - discount + VAT/charge + freight, or paid + due != total',
    ids(db, `SELECT id FROM purchases WHERE total != subtotal - discount + tax + freight OR paid + due != total OR due < 0`)));
  checks.push(() => add('I5', 'purchase subtotal differs from the sum of its lines, or the bill discount / charges are not fully allocated to the lines',
    ids(db, `SELECT p.id FROM purchases p WHERE p.subtotal != COALESCE((SELECT SUM(amount) FROM purchase_items i WHERE i.purchase_id = p.id), 0)
                OR p.discount != COALESCE((SELECT SUM(alloc_discount) FROM purchase_items i WHERE i.purchase_id = p.id), 0)
                OR p.tax + p.freight != COALESCE((SELECT SUM(alloc_charge) FROM purchase_items i WHERE i.purchase_id = p.id), 0)`)));
  // Live documents: ledger and cash agree with the header.
  checks.push(() => add('I5', 'a live sale ledger or cash total disagrees with its header',
    ids(db, `SELECT s.id FROM sales s WHERE s.status = 'posted' AND (
        (s.customer_id IS NOT NULL AND COALESCE((SELECT SUM(amount) FROM party_ledger l WHERE l.ref_type = 'sale' AND l.ref_id = s.id), 0) != s.due)
        OR COALESCE((SELECT SUM(amount) FROM cash_transactions c WHERE c.ref_type = 'sale' AND c.ref_id = s.id), 0) != s.paid)`)));
  checks.push(() => add('I5', 'a live purchase ledger or cash total disagrees with its header',
    ids(db, `SELECT p.id FROM purchases p WHERE p.status = 'posted' AND (
        (p.supplier_id IS NOT NULL AND COALESCE((SELECT SUM(amount) FROM party_ledger l WHERE l.ref_type = 'purchase' AND l.ref_id = p.id), 0) != p.due)
        OR COALESCE((SELECT SUM(amount) FROM cash_transactions c WHERE c.ref_type = 'purchase' AND c.ref_id = p.id), 0) != -p.paid)`)));

  // I11: box + pcs. base_qty = qty * factor + loose_qty on every purchase line, free lines cost nothing,
  // and a live purchase posted exactly its lines' quantity into stock.
  checks.push(() => add('I11', 'a purchase line base quantity differs from boxes x box size + loose pieces, or a free line has an amount',
    ids(db, `SELECT id FROM purchase_items WHERE base_qty != qty * factor + loose_qty OR (line_kind = 'free' AND (amount != 0 OR unit_cost != 0)) OR amount < 0`)));
  checks.push(() => add('I11', 'a live purchase posted a different quantity into stock than its lines say',
    ids(db, `SELECT p.id FROM purchases p WHERE p.status = 'posted'
              AND COALESCE((SELECT SUM(base_qty) FROM stock_movements m WHERE m.ref_type = 'purchase' AND m.ref_id = p.id), 0)
                  != COALESCE((SELECT SUM(base_qty) FROM purchase_items i WHERE i.purchase_id = p.id), 0)`)));

  // I12: company links and default units point at packs of the same product
  checks.push(() => add('I12', 'a company link or a product default unit uses a pack of another product',
    [
      ...ids(db, `SELECT sp.id FROM supplier_products sp JOIN product_packs k ON k.id = sp.default_pack_id WHERE k.product_id != sp.product_id`),
      ...ids(db, `SELECT p.id FROM products p JOIN product_packs k ON k.id = p.default_sale_pack_id WHERE k.product_id != p.id`),
      ...ids(db, `SELECT p.id FROM products p JOIN product_packs k ON k.id = p.default_purchase_pack_id WHERE k.product_id != p.id`)
    ]));

  // I13: funds classify cash movements; they never change a balance by themselves.
  //  (a) a reversal sits in the same fund as the row it reverses, so the fund nets to zero after a void
  //  (b) only kinds of movement that may belong to a fund carry one (never sales, purchases, opening balances, day closes)
  checks.push(() => add('I13', 'a cash reversal is in a different fund than the row it reverses',
    ids(db, `SELECT r.id FROM cash_transactions r JOIN cash_transactions o ON o.id = r.reverses_id WHERE r.fund_id IS NOT o.fund_id`)));
  checks.push(() => add('I13', 'a cash movement that may not belong to a fund carries one',
    ids(db, `SELECT id FROM cash_transactions WHERE fund_id IS NOT NULL AND source NOT IN ('expense', 'void_reversal')`)));

  // I6: money account balance == sum of cash transactions
  checks.push(() => add('I6', 'money account balance differs from the sum of its cash transactions',
    ids(db, `SELECT a.id FROM money_accounts a WHERE a.balance != COALESCE((SELECT SUM(amount) FROM cash_transactions c WHERE c.account_id = a.id), 0)`)));

  // I7: every voided document nets to zero across stock, ledger and cash
  checks.push(() => {
    const bad: string[] = [];
    for (const d of VOID_DOCS) {
      const rows = all<{ id: number }>(db, `SELECT id FROM ${d.table} WHERE status = 'void'`);
      for (const r of rows) {
        const sq = scalar(db, "SELECT COALESCE(SUM(base_qty),0) FROM stock_movements WHERE ref_type = ? AND ref_id = ?", [d.ref, r.id]);
        const sv = scalar(db, "SELECT COALESCE(SUM(value),0) FROM stock_movements WHERE ref_type = ? AND ref_id = ?", [d.ref, r.id]);
        const lg = scalar(db, "SELECT COALESCE(SUM(amount),0) FROM party_ledger WHERE ref_type = ? AND ref_id = ?", [d.ref, r.id]);
        const cs = scalar(db, "SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE ref_type = ? AND ref_id = ?", [d.ref, r.id]);
        if (sq !== 0 || sv !== 0 || lg !== 0 || cs !== 0) bad.push(`${d.ref}:${r.id}`);
      }
    }
    return add('I7', 'a voided document does not net to zero', bad);
  });
  checks.push(() => add('I7', 'a reversal row does not exactly negate the row it reverses',
    [
      ...ids(db, `SELECT r.id FROM stock_movements r JOIN stock_movements o ON o.id = r.reverses_id WHERE r.base_qty != -o.base_qty OR r.value != -o.value OR r.product_id != o.product_id`),
      ...ids(db, `SELECT r.id FROM party_ledger r JOIN party_ledger o ON o.id = r.reverses_id WHERE r.amount != -o.amount OR r.party_id != o.party_id OR r.party_kind != o.party_kind`),
      ...ids(db, `SELECT r.id FROM cash_transactions r JOIN cash_transactions o ON o.id = r.reverses_id WHERE r.amount != -o.amount OR r.account_id != o.account_id`)
    ]));

  // I8: nothing was posted into a closed day after it was closed (a reopen sets the status away from 'closed')
  checks.push(() => {
    const bad: string[] = [];
    const closings = all<{ business_date: string; closed_at: string }>(db, "SELECT business_date, closed_at FROM day_closings WHERE status = 'closed'");
    for (const c of closings) {
      for (const t of POSTING_TABLES) {
        for (const r of all<{ id: number }>(db, `SELECT id FROM ${t} WHERE business_date <= ? AND created_at > ?`, c.business_date, c.closed_at)) bad.push(`${t}:${r.id}`);
      }
    }
    return add('I8', 'a posting exists inside a closed day that was made after the day was closed', bad);
  });

  // I9: no negative stock unless the setting allows it (never for expiry products or batches)
  checks.push(() => {
    const raw = getRaw(db, 'allow_negative_stock');
    const allowed = raw === '1' || raw === 'true';
    return add('I9', 'a product has negative stock', ids(db, allowed ? 'SELECT id FROM products WHERE stock_qty < 0 AND track_expiry = 1' : 'SELECT id FROM products WHERE stock_qty < 0'));
  });
  checks.push(() => add('I9', 'a batch has negative quantity', ids(db, 'SELECT id FROM stock_batches WHERE qty_remaining < 0')));

  // I10: SQLite's own checks
  checks.push(() => {
    const ic = all<{ integrity_check: string }>(db, 'PRAGMA integrity_check').map((r) => r.integrity_check);
    return add('I10', 'PRAGMA integrity_check reported problems', ic.length === 1 && ic[0] === 'ok' ? [] : ic);
  });
  checks.push(() => {
    const fk = all<{ table: string; rowid: number }>(db, 'PRAGMA foreign_key_check');
    return add('I10', 'PRAGMA foreign_key_check reported dangling references', fk.map((r) => `${r.table}:${r.rowid}`));
  });

  for (const c of checks) if (c()) break;
  return out;
}

export function formatViolations(v: IntegrityViolation[]): string {
  return v.map((x) => `${x.invariant}: ${x.message} -> ${x.ids.slice(0, 20).join(', ')}${x.ids.length > 20 ? ` (+${x.ids.length - 20} more)` : ''}`).join('\n');
}

export function counts(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ['products', 'customers', 'sales', 'purchases', 'stock_movements', 'party_ledger', 'cash_transactions']) {
    out[t] = Number((get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t}`) ?? { n: 0 }).n);
  }
  return out;
}
