import { PetraError } from '@petra/core';
import { all, get, run } from './sql';
import { type Ctx, requireRow, tx } from './ctx';
import { postCash, postLedger } from './ledger';
import { audit } from './audit';

export interface PackInput {
  name: string;
  nameBn?: string;
  factor: number;
  priceRetail?: number | null;
  priceWholesale?: number | null;
  priceDealer?: number | null;
  barcode?: string | null;
}

export interface ProductInput {
  sku: string;
  name: string;
  nameBn?: string;
  categoryId?: number | null;
  brandId?: number | null;
  baseUnit?: string;
  trackExpiry?: boolean;
  priceRetail?: number;
  priceWholesale?: number;
  priceDealer?: number;
  minPrice?: number;
  reorderLevel?: number;
  packs?: PackInput[];
  barcodes?: string[];
  notes?: string;
  /** Pieces per box of the pack used by default when selling / buying (null or 1 = the base unit). */
  defaultSaleFactor?: number | null;
  defaultPurchaseFactor?: number | null;
}

function assertNonNegInt(n: number | undefined, field: string): void {
  if (n !== undefined && (!Number.isSafeInteger(n) || n < 0)) throw new PetraError('INVALID_INPUT', `${field} must be a non-negative whole number`, { field });
}

function uniqueGuard<T>(fn: () => T, what: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) throw new PetraError('DUPLICATE', `${what} already exists`, { what });
    throw e;
  }
}

/** Every product gets a base pack (factor 1) named after its base unit, so selling always goes through a pack. */
export function createProduct(ctx: Ctx, input: ProductInput): number {
  if (!input.sku.trim() || !input.name.trim()) throw new PetraError('INVALID_INPUT', 'SKU and name are required', { field: 'name' });
  for (const [f, v] of [['priceRetail', input.priceRetail], ['priceWholesale', input.priceWholesale], ['priceDealer', input.priceDealer], ['minPrice', input.minPrice], ['reorderLevel', input.reorderLevel]] as const) assertNonNegInt(v, f);
  return tx(ctx, () => {
    const t = ctx.now();
    const id = uniqueGuard(
      () => run(
        ctx.db,
        `INSERT INTO products(sku, name, name_bn, category_id, brand_id, base_unit, track_expiry, price_retail, price_wholesale, price_dealer, min_price, reorder_level, notes, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        input.sku.trim(), input.name.trim(), input.nameBn ?? '', input.categoryId ?? null, input.brandId ?? null, input.baseUnit ?? 'pcs',
        input.trackExpiry ? 1 : 0, input.priceRetail ?? 0, input.priceWholesale ?? input.priceRetail ?? 0, input.priceDealer ?? input.priceWholesale ?? input.priceRetail ?? 0,
        input.minPrice ?? 0, input.reorderLevel ?? 0, input.notes ?? '', t, t
      ).id,
      'SKU'
    );
    const packs = [...(input.packs ?? [])];
    if (!packs.some((p) => p.factor === 1)) packs.unshift({ name: input.baseUnit ?? 'pcs', factor: 1 });
    packs.forEach((p, i) => {
      if (!Number.isSafeInteger(p.factor) || p.factor < 1) throw new PetraError('INVALID_INPUT', 'pack factor must be a whole number of at least 1', { field: 'factor' });
      const packId = uniqueGuard(
        () => run(ctx.db, 'INSERT INTO product_packs(product_id, name, name_bn, factor, price_retail, price_wholesale, price_dealer, sort) VALUES(?,?,?,?,?,?,?,?)',
          id, p.name, p.nameBn ?? '', p.factor, p.priceRetail ?? null, p.priceWholesale ?? null, p.priceDealer ?? null, i).id,
        'pack'
      );
      const code = p.barcode;
      if (code) uniqueGuard(() => run(ctx.db, 'INSERT INTO product_barcodes(product_id, pack_id, barcode) VALUES(?,?,?)', id, packId, code), 'barcode');
    });
    for (const code of input.barcodes ?? []) uniqueGuard(() => run(ctx.db, 'INSERT INTO product_barcodes(product_id, barcode) VALUES(?,?)', id, code), 'barcode');
    setProductDefaults(ctx, id, input.defaultSaleFactor ?? null, input.defaultPurchaseFactor ?? null);
    audit(ctx, { action: 'product.create', entity: 'product', entityId: id, after: { sku: input.sku, name: input.name } });
    return id;
  });
}

/**
 * Default sale / purchase unit of a product, given as pieces per box. null or 1 means the base unit (stored as NULL).
 * A factor that is not one of the product's packs is rejected.
 */
export function setProductDefaults(ctx: Ctx, productId: number, saleFactor: number | null, purchaseFactor: number | null): void {
  const resolve = (factor: number | null): number | null => {
    if (factor === null || factor === 1) return null;
    const row = get<{ id: number }>(ctx.db, 'SELECT id FROM product_packs WHERE product_id = ? AND factor = ?', productId, factor);
    if (!row) throw new PetraError('INVALID_INPUT', 'the default unit must be one of the product\'s boxes', { field: 'defaultUnit' });
    return row.id;
  };
  run(ctx.db, 'UPDATE products SET default_sale_pack_id = ?, default_purchase_pack_id = ? WHERE id = ?', resolve(saleFactor), resolve(purchaseFactor), productId);
}

export interface PartyInput {
  name: string;
  nameBn?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export function createArea(ctx: Ctx, name: string, nameBn = ''): number {
  const existing = get<{ id: number }>(ctx.db, 'SELECT id FROM areas WHERE name = ?', name);
  if (existing) return existing.id;
  return run(ctx.db, 'INSERT INTO areas(name, name_bn) VALUES(?,?)', name, nameBn).id;
}

export function createCategory(ctx: Ctx, name: string, nameBn = ''): number {
  return uniqueGuard(() => run(ctx.db, 'INSERT INTO categories(name, name_bn, created_at) VALUES(?,?,?)', name, nameBn, ctx.now()).id, 'category');
}

export function createBrand(ctx: Ctx, name: string, nameBn = ''): number {
  return uniqueGuard(() => run(ctx.db, 'INSERT INTO brands(name, name_bn, created_at) VALUES(?,?,?)', name, nameBn, ctx.now()).id, 'brand');
}

export interface CustomerInput extends PartyInput {
  areaId?: number | null;
  type?: 'retail' | 'wholesale' | 'dealer';
  creditLimit?: number;
  defaultDiscountBp?: number;
  /** Opening due (positive = customer owes us). */
  openingBalance?: number;
  openingDate?: string;
}

export function createCustomer(ctx: Ctx, input: CustomerInput): number {
  if (!input.name.trim()) throw new PetraError('INVALID_INPUT', 'name is required', { field: 'name' });
  assertNonNegInt(input.creditLimit, 'creditLimit');
  return tx(ctx, () => {
    const t = ctx.now();
    const id = run(
      ctx.db,
      'INSERT INTO customers(name, name_bn, phone, address, area_id, type, credit_limit, default_discount_bp, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      input.name.trim(), input.nameBn ?? '', input.phone ?? '', input.address ?? '', input.areaId ?? null, input.type ?? 'retail',
      input.creditLimit ?? 0, input.defaultDiscountBp ?? 0, input.notes ?? '', t, t
    ).id;
    if (input.openingBalance) {
      postLedger(ctx, { partyKind: 'customer', partyId: id, kind: 'opening', amount: input.openingBalance, date: input.openingDate ?? t.slice(0, 10), note: 'Opening due' });
    }
    audit(ctx, { action: 'customer.create', entity: 'customer', entityId: id, after: { name: input.name } });
    return id;
  });
}

export function createSupplier(ctx: Ctx, input: PartyInput & { openingBalance?: number; openingDate?: string }): number {
  if (!input.name.trim()) throw new PetraError('INVALID_INPUT', 'name is required', { field: 'name' });
  return tx(ctx, () => {
    const t = ctx.now();
    const id = run(ctx.db, 'INSERT INTO suppliers(name, name_bn, phone, address, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', input.name.trim(), input.nameBn ?? '', input.phone ?? '', input.address ?? '', input.notes ?? '', t, t).id;
    if (input.openingBalance) postLedger(ctx, { partyKind: 'supplier', partyId: id, kind: 'opening', amount: input.openingBalance, date: input.openingDate ?? t.slice(0, 10), note: 'Opening payable' });
    audit(ctx, { action: 'supplier.create', entity: 'supplier', entityId: id, after: { name: input.name } });
    return id;
  });
}

export function createEmployee(ctx: Ctx, input: PartyInput & { jobTitle?: string; baseSalary?: number; joinedOn?: string }): number {
  if (!input.name.trim()) throw new PetraError('INVALID_INPUT', 'name is required', { field: 'name' });
  assertNonNegInt(input.baseSalary, 'baseSalary');
  const t = ctx.now();
  const id = run(ctx.db, 'INSERT INTO employees(name, name_bn, phone, job_title, base_salary, joined_on, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', input.name.trim(), input.nameBn ?? '', input.phone ?? '', input.jobTitle ?? '', input.baseSalary ?? 0, input.joinedOn ?? null, t, t).id;
  audit(ctx, { action: 'employee.create', entity: 'employee', entityId: id, after: { name: input.name } });
  return id;
}

export function createExpenseCategory(ctx: Ctx, name: string, nameBn = ''): number {
  return uniqueGuard(() => run(ctx.db, 'INSERT INTO expense_categories(name, name_bn) VALUES(?,?)', name, nameBn).id, 'expense category');
}

export function createMoneyAccount(ctx: Ctx, input: { name: string; nameBn?: string; kind: 'cash' | 'bank' | 'bkash' | 'nagad' | 'other'; openingBalance?: number; date: string; isDefault?: boolean }): number {
  return tx(ctx, () => {
    if (input.isDefault) run(ctx.db, 'UPDATE money_accounts SET is_default = 0');
    const id = uniqueGuard(() => run(ctx.db, 'INSERT INTO money_accounts(name, name_bn, kind, is_default, created_at) VALUES(?,?,?,?,?)', input.name, input.nameBn ?? '', input.kind, input.isDefault ? 1 : 0, ctx.now()).id, 'account');
    if (input.openingBalance) postCash(ctx, { accountId: id, date: input.date, amount: input.openingBalance, source: 'opening', note: 'Opening balance' });
    return id;
  });
}

export function createUser(ctx: Ctx, input: { username: string; displayName: string; role: 'owner' | 'manager' | 'staff'; pinHash?: string | null }): number {
  const t = ctx.now();
  return uniqueGuard(() => run(ctx.db, 'INSERT INTO users(username, display_name, role, pin_hash, created_at, updated_at) VALUES(?,?,?,?,?,?)', input.username, input.displayName, input.role, input.pinHash ?? null, t, t).id, 'user');
}

/** Archives instead of deleting once a record has history. */
export function archive(ctx: Ctx, table: 'products' | 'customers' | 'suppliers' | 'employees' | 'categories' | 'brands', id: number): void {
  requireRow(get(ctx.db, `SELECT id FROM ${table} WHERE id = ?`, id), table, id);
  run(ctx.db, `UPDATE ${table} SET status = 'archived' WHERE id = ?`, id);
  audit(ctx, { action: `${table}.archive`, entity: table, entityId: id });
}

export const DEFAULT_ACCOUNTS: { name: string; nameBn: string; kind: 'cash' | 'bank' | 'bkash' | 'nagad' }[] = [
  { name: 'Cash in hand', nameBn: 'নগদ টাকা', kind: 'cash' },
  { name: 'Bank', nameBn: 'ব্যাংক', kind: 'bank' },
  { name: 'bKash', nameBn: 'বিকাশ', kind: 'bkash' },
  { name: 'Nagad', nameBn: 'নগদ (ডিজিটাল)', kind: 'nagad' }
];

export const DEFAULT_EXPENSE_CATEGORIES: [string, string][] = [
  ['Rent', 'ভাড়া'], ['Electricity & utilities', 'বিদ্যুৎ ও ইউটিলিটি'], ['Transport & delivery', 'পরিবহন ও ডেলিভারি'],
  ['Mobile & internet', 'মোবাইল ও ইন্টারনেট'], ['Repairs', 'মেরামত'], ['Tea & food', 'চা ও খাবার'], ['Marketing', 'বিপণন'], ['Miscellaneous', 'বিবিধ']
];

/** Idempotent first-run defaults: money accounts, expense categories and the business profile row. */
export function seedDefaults(ctx: Ctx, date: string): void {
  tx(ctx, () => {
    const t = ctx.now();
    run(ctx.db, 'INSERT OR IGNORE INTO business_profile(id, created_at, updated_at) VALUES(1,?,?)', t, t);
    if (!get(ctx.db, 'SELECT id FROM money_accounts LIMIT 1')) {
      DEFAULT_ACCOUNTS.forEach((a, i) => createMoneyAccount(ctx, { name: a.name, nameBn: a.nameBn, kind: a.kind, date, isDefault: i === 0 }));
    }
    if (!get(ctx.db, 'SELECT id FROM expense_categories LIMIT 1')) {
      for (const [n, bn] of DEFAULT_EXPENSE_CATEGORIES) createExpenseCategory(ctx, n, bn);
    }
  });
}

export function listAccounts(ctx: Ctx): { id: number; name: string; kind: string; balance: number }[] {
  return all(ctx.db, 'SELECT id, name, kind, balance FROM money_accounts WHERE active = 1 ORDER BY is_default DESC, id');
}
