import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createTestWorld } from './testkit';
import { applyOp, buildSimWorld, type Op, type SimConfig } from './sim';
import { checkIntegrity, formatViolations } from './integrity';

const smallInt = (max: number) => fc.integer({ min: 0, max });
const dayOff = fc.constantFrom(0, 0, 0, 0, 1, -1);
const discKind = fc.constantFrom('pct' as const, 'fixed' as const, null, null);

const purchaseOp: fc.Arbitrary<Op> = fc.record({
  t: fc.constant('purchase' as const),
  sup: fc.integer({ min: -1, max: 2 }),
  lines: fc.array(fc.record({
    p: smallInt(4), pack: smallInt(2), qty: fc.integer({ min: 0, max: 20 }), cost: fc.integer({ min: 0, max: 900_000 }), batch: smallInt(3), expiryDays: fc.integer({ min: -1, max: 400 }),
    // v1.1: loose pieces beside the boxes, free goods and line discounts
    loose: fc.integer({ min: 0, max: 40 }), free: fc.boolean().map((b) => b && Math.random() < 0.25), discKind, discValue: fc.integer({ min: 0, max: 3_000 })
  }), { minLength: 1, maxLength: 5 }),
  discount: fc.integer({ min: 0, max: 20_000 }), paidPct: fc.integer({ min: 0, max: 100 }), dayOff,
  billPct: fc.option(fc.integer({ min: 0, max: 1_500 }), { nil: undefined }),
  tax: fc.option(fc.integer({ min: 0, max: 30_000 }), { nil: undefined }),
  freight: fc.option(fc.integer({ min: 0, max: 50_000 }), { nil: undefined })
});

const saleOp: fc.Arbitrary<Op> = fc.record({
  t: fc.constant('sale' as const),
  cust: fc.integer({ min: -1, max: 3 }),
  lines: fc.array(fc.record({
    p: smallInt(4), pack: smallInt(2), qty: fc.integer({ min: 1, max: 15 }), priceMul: fc.integer({ min: 60, max: 130 }),
    bonus: fc.boolean().map((b) => b && Math.random() < 0.3), discKind, discValue: fc.integer({ min: 0, max: 3_000 })
  }), { minLength: 1, maxLength: 4 }),
  discKind, discValue: fc.integer({ min: 0, max: 5_000 }), paidPct: fc.integer({ min: 0, max: 100 }),
  tier: fc.constantFrom('retail' as const, 'wholesale' as const, 'dealer' as const, null), approved: fc.boolean(), dayOff
});

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: purchaseOp },
  { weight: 9, arbitrary: saleOp },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('editSale' as const), i: smallInt(50), qtyDelta: fc.integer({ min: -3, max: 5 }), paidPct: fc.integer({ min: 0, max: 100 }), approved: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('saleReturn' as const), i: smallInt(50), item: smallInt(3), qty: fc.integer({ min: 1, max: 30 }), mode: fc.constantFrom('due' as const, 'cash' as const), dayOff }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('purchaseReturnOf' as const), i: smallInt(50), line: smallInt(4), box: fc.integer({ min: 0, max: 3 }), pcs: fc.integer({ min: 0, max: 30 }), creditPct: fc.integer({ min: 50, max: 120 }), mode: fc.constantFrom('due' as const, 'cash' as const), dayOff }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('purchaseReturn' as const), sup: fc.integer({ min: -1, max: 2 }), p: smallInt(4), qty: fc.integer({ min: 1, max: 20 }), creditPct: fc.integer({ min: 50, max: 120 }), mode: fc.constantFrom('due' as const, 'cash' as const), dayOff }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('void' as const), what: fc.constantFrom('sale' as const, 'purchase' as const, 'payment' as const, 'expense' as const, 'saleReturn' as const, 'purchaseReturn' as const, 'adjustment' as const, 'salary' as const), i: smallInt(50) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('receive' as const), cust: smallInt(3), amount: fc.integer({ min: 1, max: 300_000 }), dayOff }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('paySupplier' as const), sup: smallInt(2), amount: fc.integer({ min: 1, max: 300_000 }), dayOff }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('expense' as const), cat: smallInt(1), amount: fc.integer({ min: 1, max: 80_000 }), account: smallInt(3), dayOff }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('adjust' as const), p: smallInt(4), kind: fc.constantFrom('opening' as const, 'adjust_in' as const, 'adjust_out' as const, 'damage' as const, 'expired' as const, 'internal_use' as const), qty: fc.integer({ min: 1, max: 12 }), value: fc.integer({ min: 0, max: 400_000 }), dayOff }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('salary' as const), month: smallInt(11), bonus: fc.integer({ min: 0, max: 100_000 }), deduction: fc.integer({ min: 0, max: 100_000 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('payEmployee' as const), emp: smallInt(2), amount: fc.integer({ min: 1, max: 900_000 }), advance: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('ledgerAdjust' as const), cust: smallInt(3), amount: fc.integer({ min: -50_000, max: 50_000 }) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('close' as const), actualDelta: fc.integer({ min: -2_000, max: 2_000 }) }) },
  { weight: 1, arbitrary: fc.constant({ t: 'reopen' as const }) },
  { weight: 3, arbitrary: fc.constant({ t: 'nextDay' as const }) }
);

const configArb: fc.Arbitrary<SimConfig> = fc.record({
  allowNegativeStock: fc.boolean(),
  roundOff: fc.boolean(),
  taxBp: fc.constantFrom(0, 0, 500, 1500),
  creditLimitMode: fc.constantFrom('off' as const, 'warn' as const, 'approval' as const, 'block' as const),
  minPriceMode: fc.constantFrom('off' as const, 'approval' as const)
});

/**
 * THE KEY TEST (plan section 7): random sequences of purchase (box + pcs, free goods, line and bill discounts, VAT, freight), sale, bonus, return (box + pcs against a purchase), void, payment, expense,
 * adjustment, salary and day-close operations; after every sequence all of I1-I12 must hold.
 */
export function runProperty(numRuns: number, minLen: number, maxLen: number, seed?: number): { operations: number; rejected: number; boxPcs: Record<string, number> } {
  let operations = 0;
  let rejected = 0;
  const boxPcs: Record<string, number> = { looseLines: 0, freeLines: 0, discountedLines: 0, chargedBills: 0, returnsOfPurchase: 0, voidedBoxPurchases: 0 };
  const count = (db: ReturnType<typeof createTestWorld>['ctx']['db'], sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
  fc.assert(
    fc.property(configArb, fc.array(opArb, { minLength: minLen, maxLength: maxLen }), (config, ops) => {
      const world = createTestWorld();
      try {
        const w = buildSimWorld(world.ctx, world.managerId, config);
        for (const op of ops) applyOp(w, op);
        operations += ops.length;
        rejected += w.stats.rejected;
        const db = world.ctx.db;
        boxPcs.looseLines! += count(db, 'SELECT COUNT(*) AS n FROM purchase_items WHERE loose_qty > 0');
        boxPcs.freeLines! += count(db, "SELECT COUNT(*) AS n FROM purchase_items WHERE line_kind = 'free'");
        boxPcs.discountedLines! += count(db, 'SELECT COUNT(*) AS n FROM purchase_items WHERE discount > 0');
        boxPcs.chargedBills! += count(db, 'SELECT COUNT(*) AS n FROM purchases WHERE tax + freight > 0');
        boxPcs.returnsOfPurchase! += count(db, 'SELECT COUNT(*) AS n FROM purchase_returns WHERE purchase_id IS NOT NULL');
        boxPcs.voidedBoxPurchases! += count(db, "SELECT COUNT(*) AS n FROM purchases p WHERE p.status = 'void' AND EXISTS (SELECT 1 FROM purchase_items i WHERE i.purchase_id = p.id AND (i.loose_qty > 0 OR i.line_kind = 'free'))");
        const v = checkIntegrity(world.ctx.db);
        expect(formatViolations(v)).toBe('');
      } finally {
        world.close();
      }
    }),
    { numRuns, seed, verbose: false }
  );
  return { operations, rejected, boxPcs };
}

describe('random operation sequences keep every invariant', () => {
  const runs = Number(process.env.PETRA_PROPERTY_RUNS ?? 1000);

  it(`${runs} random scenarios hold I1-I12`, () => {
    const r = runProperty(runs, 3, 30);
    expect(r.operations).toBeGreaterThan(runs);
    // the v1.1 paths were really exercised, not just generated and rejected
    for (const [k, n] of Object.entries(r.boxPcs)) expect(n, k).toBeGreaterThan(0);
  }, 600_000);
});

describe('the 10,000-operation gate (phase 6)', () => {
  it('10,000 random operations in 250 sequences still satisfy I1-I12', () => {
    const r = runProperty(250, 40, 40);
    expect(r.operations).toBe(10_000);
  }, 600_000);
});
