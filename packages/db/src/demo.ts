import { addDays } from '@petra/core';
import type { Ctx } from './ctx';
import { all } from './sql';
import { createArea, createBrand, createCategory, createCustomer, createProduct, createSupplier } from './masters';
import { postExpense, postPayment } from './money';
import { postPurchase } from './purchases';
import { postSale } from './sales';
import { DEMO_PRODUCTS } from './demoCatalog';

const SHOPS: [string, string, string, string, 'retail' | 'wholesale' | 'dealer', number][] = [
  ['Rahman Store', 'রহমান স্টোর', 'Zindabazar', '01711000001', 'retail', 2000000],
  ['Karim Traders', 'করিম ট্রেডার্স', 'Ambarkhana', '01711000002', 'wholesale', 5000000],
  ['Salam Bhandar', 'সালাম ভান্ডার', 'Subid Bazar', '01711000003', 'retail', 1500000],
  ['Jamal Enterprise', 'জামাল এন্টারপ্রাইজ', 'Kumarpara', '01711000004', 'dealer', 8000000],
  ['Hasan Mart', 'হাসান মার্ট', 'Uposhahar', '01711000005', 'retail', 1000000],
  ['Nasir Corner', 'নাসির কর্নার', 'Tilagor', '01711000006', 'retail', 1000000],
  ['Faruk Stores', 'ফারুক স্টোরস', 'Mirboxtula', '01711000007', 'wholesale', 4000000],
  ['Mizan Trading', 'মিজান ট্রেডিং', 'Bondor Bazar', '01711000008', 'dealer', 6000000]
];

/**
 * Sample Bangladeshi FMCG data for trying the app: products and SKUs from the supplied list, eight shops, three suppliers,
 * stock bought in, ten days of invoices with part payments, and a few expenses. Deterministic, so screenshots and tests repeat.
 */
export function seedDemo(ctx: Ctx, endDate: string): { products: number; customers: number; sales: number } {
  let state = 4242;
  const r = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const ri = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1));
  const start = addDays(endDate, -9);

  const cats = new Map<string, number>();
  const brands = new Map<string, number>();
  const products: { id: number; retail: number }[] = [];
  for (const p of DEMO_PRODUCTS) {
    const cat = cats.get(p.category) ?? createCategory(ctx, p.category);
    cats.set(p.category, cat);
    const brandName = p.name.split(' ')[0] as string;
    const brand = brands.get(brandName) ?? createBrand(ctx, brandName);
    brands.set(brandName, brand);
    const retail = p.retail * 100;
    const id = createProduct(ctx, {
      sku: p.sku, name: p.name, categoryId: cat, brandId: brand, baseUnit: 'pcs', priceRetail: retail, priceWholesale: Math.round(retail * 0.96 / 100) * 100,
      priceDealer: Math.round(retail * 0.93 / 100) * 100, minPrice: Math.round(retail * 0.85 / 100) * 100, reorderLevel: 6, barcodes: []
    });
    products.push({ id, retail });
  }
  const areas = new Map<string, number>();
  const customers = SHOPS.map(([name, nameBn, area, phone, type, limit]) => {
    const a = areas.get(area) ?? createArea(ctx, area);
    areas.set(area, a);
    return createCustomer(ctx, { name, nameBn, phone, address: `${area}, Sylhet`, areaId: a, type, creditLimit: limit, openingBalance: r() < 0.3 ? ri(5, 40) * 10000 : 0, openingDate: start });
  });
  const suppliers = ['Marks Distribution', 'Ama Foods Depot', 'Shah Food Supply'].map((n, i) => createSupplier(ctx, { name: n, phone: `0181100000${i + 1}` }));

  for (let i = 0; i < products.length; i += 15) {
    postPurchase(ctx, {
      supplierId: suppliers[(i / 15) % suppliers.length] as number, date: start,
      lines: products.slice(i, i + 15).map((p) => ({ productId: p.id, qty: ri(40, 160), unitCost: Math.round(p.retail * 0.86) })), paid: 0
    });
  }

  let sales = 0;
  for (let n = 0; n < 36; n++) {
    const date = addDays(start, Math.min(9, Math.floor(n / 3.6)));
    const cust = customers[ri(0, customers.length - 1)] as number;
    const lines = Array.from({ length: ri(1, 4) }, () => ({ productId: (products[ri(0, products.length - 1)] as { id: number }).id, qty: ri(1, 6) }));
    try {
      postSale(ctx, { customerId: cust, date, lines, paid: 0, approvedBy: ctx.userId });
      sales++;
    } catch { /* a credit-limit stop on one sample bill is simply skipped */ }
    if (n % 4 === 3) {
      try { postPayment(ctx, { partyKind: 'customer', partyId: cust, amount: ri(5, 60) * 10000, date }); } catch { /* ignore */ }
    }
  }
  const [rent, transport] = all<{ id: number }>(ctx.db, "SELECT id FROM expense_categories WHERE status = 'active' ORDER BY id LIMIT 2");
  if (rent) postExpense(ctx, { categoryId: rent.id, amount: 1200000, date: addDays(endDate, -2), payee: 'Landlord' });
  if (transport) postExpense(ctx, { categoryId: transport.id, amount: 85000, date: addDays(endDate, -1), payee: 'Van' });
  return { products: products.length, customers: customers.length, sales };
}
