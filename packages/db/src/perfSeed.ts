import { addDays } from '@petra/core';
import type { Ctx } from './ctx';
import { createArea, createBrand, createCategory, createCustomer, createProduct, createSupplier } from './masters';
import { postPurchase } from './purchases';
import { postPayment } from './money';
import { postSale } from './sales';
import { all } from './sql';

export interface PerfSeedOptions {
  products: number;
  customers: number;
  suppliers: number;
  /** Number of sales to post over `days` business days ending on `endDate`. */
  sales: number;
  days: number;
  endDate: string;
  seed?: number;
}

/** The dataset of plan section 14: 10,000 products, 5,000 customers, a quarter of trading. */
export const PERF_FULL: Omit<PerfSeedOptions, 'endDate'> = { products: 10000, customers: 5000, suppliers: 200, sales: 6000, days: 90 };

const BRANDS = ['Marks', 'Sylon', 'Pran', 'Fresh', 'Radhuni', 'Ispahani', 'Aci', 'Bashundhara', 'Square', 'Olympic', 'Danish', 'Meghna', 'Rupchanda', 'Teer', 'Akij', 'Kishwan'];
const ITEMS: [string, string][] = [
  ['Milk Powder', 'গুঁড়া দুধ'], ['Tea', 'চা পাতা'], ['Noodles', 'নুডলস'], ['Biscuit', 'বিস্কুট'], ['Soybean Oil', 'সয়াবিন তেল'], ['Rice', 'চাল'], ['Salt', 'লবণ'],
  ['Sugar', 'চিনি'], ['Soap', 'সাবান'], ['Detergent', 'ডিটারজেন্ট'], ['Juice', 'জুস'], ['Chips', 'চিপস'], ['Spice Mix', 'মসলা'], ['Ghee', 'ঘি'], ['Lentil', 'ডাল'], ['Toothpaste', 'টুথপেস্ট']
];
const SIZES = ['50g', '100g', '200g', '250g', '400g', '500g', '1kg', '2kg', '1L', '12pk'];
const GIVEN = ['Rahim', 'Karim', 'Jamal', 'Hasan', 'Nasir', 'Salam', 'Kabir', 'Mizan', 'Faruk', 'Alamin', 'Sumon', 'Rubel', 'Babul', 'Shahin', 'Tarek', 'Habib'];
const GIVEN_BN = ['রহিম', 'করিম', 'জামাল', 'হাসান', 'নাসির', 'সালাম', 'কবির', 'মিজান', 'ফারুক', 'আলামিন', 'সুমন', 'রুবেল', 'বাবুল', 'শাহীন', 'তারেক', 'হাবিব'];
const SHOPS = ['Store', 'Traders', 'Enterprise', 'Bhandar', 'Mart', 'Corner', 'Stores', 'Trading'];
const AREAS = ['Zindabazar', 'Ambarkhana', 'Subid Bazar', 'Kumarpara', 'Uposhahar', 'Tilagor', 'Mirboxtula', 'Bondor Bazar', 'Shibganj', 'Akhalia'];

/**
 * A realistic large shop for speed work (search under 50 ms, report timings, POS under load). Deterministic for a seed.
 * Stock is bought first in bulk, then sales are posted day by day with some payments, so every report has real content.
 */
export function seedPerf(ctx: Ctx, o: PerfSeedOptions): { products: number[]; customers: number[]; suppliers: number[] } {
  let state = (o.seed ?? 20261007) >>> 0;
  const r = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const ri = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1));
  const pick = <T>(xs: readonly T[]): T => xs[ri(0, xs.length - 1)] as T;
  const startDate = addDays(o.endDate, -(o.days - 1));

  const cats = ['Dairy', 'Beverage', 'Staples', 'Snacks', 'Household', 'Personal care'].map((c) => createCategory(ctx, c));
  const brands = BRANDS.map((b) => createBrand(ctx, b));
  const areas = AREAS.map((a) => createArea(ctx, a));
  const suppliers: number[] = [];
  for (let i = 0; i < o.suppliers; i++) suppliers.push(createSupplier(ctx, { name: `${pick(BRANDS)} Distributor ${i + 1}`, phone: `0171${String(1000000 + i).slice(-7)}` }));
  const products: number[] = [];
  for (let i = 0; i < o.products; i++) {
    const [item, bn] = pick(ITEMS);
    const brandIx = ri(0, BRANDS.length - 1);
    const size = pick(SIZES);
    const retail = ri(20, 900) * 100;
    products.push(createProduct(ctx, {
      sku: `SKU-${String(i + 1).padStart(5, '0')}`, name: `${BRANDS[brandIx]} ${item} ${size} #${i + 1}`, nameBn: `${bn} ${size}`,
      categoryId: pick(cats), brandId: brands[brandIx] as number, baseUnit: 'pcs', priceRetail: retail, priceWholesale: Math.round(retail * 0.9), priceDealer: Math.round(retail * 0.85),
      minPrice: Math.round(retail * 0.8), reorderLevel: ri(0, 20), barcodes: [String(8900000000000 + i * 7 + 13)],
      packs: r() < 0.5 ? [{ name: 'Carton', factor: pick([6, 12, 24]) }] : []
    }));
  }
  const customers: number[] = [];
  for (let i = 0; i < o.customers; i++) {
    const g = ri(0, GIVEN.length - 1);
    customers.push(createCustomer(ctx, {
      name: `${GIVEN[g]} ${pick(SHOPS)} ${i + 1}`, nameBn: `${GIVEN_BN[g]} স্টোর ${i + 1}`, phone: `018${String(10000000 + i * 3).slice(-8)}`, address: `${pick(AREAS)}, Sylhet`,
      areaId: pick(areas), type: pick(['retail', 'wholesale', 'dealer'] as const), creditLimit: ri(0, 5) * 1_000_000, openingBalance: r() < 0.2 ? ri(1, 200) * 1000 : 0, openingDate: startDate
    }));
  }

  // bulk stock in, 25 products per bill
  for (let i = 0; i < products.length; i += 25) {
    postPurchase(ctx, {
      supplierId: pick(suppliers), date: startDate,
      lines: products.slice(i, i + 25).map((p) => ({ productId: p, qty: ri(400, 4000), unitCost: ri(10, 700) * 100 })),
      paid: 0
    });
  }
  const packs = new Map<number, number[]>();
  for (const row of all<{ id: number; product_id: number }>(ctx.db, 'SELECT id, product_id FROM product_packs WHERE factor > 1')) packs.set(row.product_id, [...(packs.get(row.product_id) ?? []), row.id]);

  for (let n = 0; n < o.sales; n++) {
    const date = addDays(startDate, Math.min(o.days - 1, Math.floor((n * o.days) / o.sales)));
    const lines = Array.from({ length: ri(1, 4) }, () => {
      const p = pick(products);
      const pk = packs.get(p);
      return pk && r() < 0.2 ? { productId: p, packId: pk[0] as number, qty: ri(1, 2) } : { productId: p, qty: ri(1, 6) };
    });
    const cust = pick(customers);
    try {
      postSale(ctx, { customerId: cust, date, lines, paid: 0, approvedBy: ctx.userId });
    } catch {
      // a stock shortfall or a credit-limit stop on one random sale is simply skipped
    }
    if (n % 7 === 0) {
      try { postPayment(ctx, { partyKind: 'customer', partyId: cust, amount: ri(1, 40) * 1000, date }); } catch { /* ignore */ }
    }
  }
  return { products, customers, suppliers };
}

/**
 * Adds `count` stock movement rows straight with SQL (about 10 s for a million) so reports can be timed over the history
 * of a very busy shop. The rows are spread over `days` days, all products and five kinds, so every range and kind filter
 * has real work to do. They are not matched to documents or batches, so use this on a throwaway database only: the
 * integrity checks are expected to fail on it.
 */
export function bulkMovements(ctx: Ctx, count: number, endDate: string, days: number): void {
  const products = all<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM products')[0]?.n ?? 0;
  if (products === 0) throw new Error('seed products first');
  const step = 250_000;
  for (let done = 0; done < count; done += step) {
    const n = Math.min(step, count - done);
    ctx.db.prepare(
      `WITH RECURSIVE c(x) AS (SELECT ? UNION ALL SELECT x + 1 FROM c WHERE x < ?)
       INSERT INTO stock_movements(product_id, batch_id, business_date, kind, base_qty, value, ref_type, ref_id, user_id, note, created_at)
       SELECT 1 + (x * 7919) % ?, NULL, date(?, '-' || (x % ?) || ' day'),
              CASE x % 6 WHEN 0 THEN 'purchase' WHEN 1 THEN 'sale' WHEN 2 THEN 'sale' WHEN 3 THEN 'damage' WHEN 4 THEN 'adjust_in' ELSE 'sale' END,
              CASE x % 6 WHEN 0 THEN 12 WHEN 4 THEN 3 ELSE -1 - (x % 5) END, 100 * (1 + x % 50), NULL, NULL, NULL, '', ?
       FROM c`
    ).run(done + 1, done + n, products, endDate, days, ctx.now());
  }
}
