import { z } from 'zod';
import { ch, dateStr, id } from './define';
import { reportPrintDoc } from './reports';

// ===== DTOs =====
export type PriceTier = 'retail' | 'wholesale' | 'dealer';

export interface AreaDto {
  id: number;
  name: string;
  nameBn: string;
}

export interface CustomerDto {
  id: number;
  name: string;
  nameBn: string;
  phone: string;
  address: string;
  areaId: number | null;
  areaName: string;
  type: PriceTier;
  creditLimit: number;
  defaultDiscountBp: number;
  balance: number;
  status: 'active' | 'archived';
  notes: string;
  lastSaleDate: string | null;
}

export interface SaleListItem {
  id: number;
  docNo: string;
  date: string;
  customerId: number | null;
  customerName: string;
  status: 'posted' | 'void';
  revision: number;
  total: number;
  paid: number;
  due: number;
  /** Null for staff (plan 13.1: staff never see profit). */
  profit: number | null;
}

export interface SaleItemDto {
  id: number;
  lineNo: number;
  kind: 'normal' | 'bonus';
  productId: number;
  sku: string;
  productName: string;
  productNameBn: string;
  packId: number | null;
  packName: string;
  /** Bangla name of the pack, '' when none. */
  packNameBn: string;
  /** The product's base unit ("pcs"), for box + pcs text. */
  baseUnit: string;
  factor: number;
  qty: number;
  baseQty: number;
  price: number;
  discKind: 'pct' | 'fixed' | null;
  discValue: number;
  discount: number;
  amount: number;
  allocDiscount: number;
  cogs: number | null;
  returnedBaseQty: number;
}

export interface SaleReturnDto {
  id: number;
  docNo: string;
  date: string;
  refundMode: 'due' | 'cash';
  total: number;
  status: 'posted' | 'void';
  reason: string;
}

export interface SaleDetail {
  id: number;
  docNo: string;
  date: string;
  status: 'posted' | 'void';
  revision: number;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  areaName: string;
  priceTier: PriceTier;
  subtotal: number;
  discKind: 'pct' | 'fixed' | null;
  discValue: number;
  discount: number;
  taxBp: number;
  tax: number;
  roundOff: number;
  total: number;
  paid: number;
  due: number;
  accountName: string;
  note: string;
  voidReason: string | null;
  /** Customer balance just before this invoice (null for walk-in sales). */
  previousDue: number | null;
  /** Customer balance now (null for walk-in sales). */
  currentDue: number | null;
  userName: string;
  items: SaleItemDto[];
  returns: SaleReturnDto[];
  cogs: number | null;
  profit: number | null;
}

export interface SalePostResult {
  id: number;
  docNo: string;
  total: number;
  paid: number;
  due: number;
  revision: number;
  warnings: string[];
}

// ===== Inputs =====
const poisha = z.number().int().min(0).max(9_000_000_000_000);
const qty = z.number().int().positive().max(1_000_000_000);
const tier = z.enum(['retail', 'wholesale', 'dealer']);
const discKind = z.enum(['pct', 'fixed']).nullable().optional();

export const customerSaveInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(160),
  nameBn: z.string().trim().max(160).default(''),
  phone: z.string().trim().max(20).default(''),
  address: z.string().trim().max(300).default(''),
  areaId: z.number().int().positive().nullable().default(null),
  type: tier.default('retail'),
  creditLimit: poisha.default(0),
  defaultDiscountBp: z.number().int().min(0).max(10000).default(0),
  notes: z.string().trim().max(500).default(''),
  /** What the customer already owes today (new customers only). */
  openingBalance: poisha.default(0),
  openingDate: dateStr.optional(),
  archived: z.boolean().optional()
});

export const areaSaveInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80),
  nameBn: z.string().trim().max(80).default('')
});

export const saleLineInput = z.object({
  kind: z.enum(['normal', 'bonus']).default('normal'),
  productId: z.number().int().positive(),
  packId: z.number().int().positive().nullable().optional(),
  qty,
  price: poisha.optional(),
  discKind,
  discValue: z.number().int().min(0).max(9_000_000_000_000).default(0),
  batchId: z.number().int().positive().nullable().optional()
});

export const saleBodyInput = z.object({
  customerId: z.number().int().positive().nullable().default(null),
  lines: z.array(saleLineInput).min(1).max(300),
  discKind,
  discValue: z.number().int().min(0).max(9_000_000_000_000).default(0),
  paid: poisha.default(0),
  accountId: z.number().int().positive().nullable().default(null),
  note: z.string().trim().max(300).default(''),
  priceTier: tier.optional(),
  /** One-time token from `auth:approve` when a staff sale needs manager approval. */
  approvalToken: z.string().max(80).optional()
});

export const saleSaveInput = saleBodyInput.extend({ date: dateStr, requestId: z.string().min(8).max(64).optional() });
export const saleEditInput = saleBodyInput.extend({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) });

export const saleReturnInput = z.object({
  saleId: z.number().int().positive(),
  date: dateStr,
  items: z.array(z.object({ saleItemId: z.number().int().positive(), baseQty: qty })).min(1).max(300),
  refundMode: z.enum(['due', 'cash']),
  accountId: z.number().int().positive().nullable().default(null),
  reason: z.string().trim().max(300).default(''),
  requestId: z.string().min(8).max(64).optional()
});

export const printFormat = z.enum(['a4', 'thermal80', 'thermal58']);
export type PrintFormat = z.infer<typeof printFormat>;

export const printDoc = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invoice'), id: z.number().int().positive() }),
  z.object({ type: z.literal('payment'), id: z.number().int().positive() }),
  /** Goods received note for a purchase (Manager and Owner: it shows cost). */
  z.object({ type: z.literal('purchase'), id: z.number().int().positive() }),
  reportPrintDoc,
  z.object({ type: z.literal('labels'), items: z.array(z.object({ productId: z.number().int().positive(), copies: z.number().int().min(1).max(200) })).min(1).max(200) }),
  z.object({ type: z.literal('statement'), kind: z.enum(['customer', 'supplier']), id: z.number().int().positive(), from: dateStr.optional(), to: dateStr.optional() })
]);
export type PrintDoc = z.infer<typeof printDoc>;

export const printInput = z.object({
  doc: printDoc,
  format: printFormat.optional(),
  action: z.enum(['print', 'pdf'])
});

const range = z.object({ from: dateStr.optional(), to: dateStr.optional() });

export const salesChannels = {
  'area:list': ch<AreaDto[]>()(z.undefined()),
  'area:save': ch<{ id: number }>()(areaSaveInput, { access: 'manager', write: true }),
  'customer:list': ch<CustomerDto[]>()(z.object({ includeArchived: z.boolean().default(false) })),
  'customer:save': ch<{ id: number }>()(customerSaveInput, { access: 'manager', write: true }),
  /** Adds a customer while selling; credit limit stays 0 until a manager changes it. Staff may add retail customers only. */
  'customer:quickAdd': ch<{ id: number }>()(z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().max(20).default(''), address: z.string().trim().max(300).default(''), areaId: z.number().int().positive().nullable().default(null), type: z.enum(['retail', 'wholesale', 'dealer']).default('retail') }), { write: true }),

  'sale:save': ch<SalePostResult>()(saleSaveInput, { write: true }),
  'sale:edit': ch<SalePostResult>()(saleEditInput, { access: 'manager', write: true }),
  'sale:void': ch()(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }), { access: 'manager', write: true }),
  'sale:list': ch<SaleListItem[]>()(range.extend({ customerId: z.number().int().positive().optional(), search: z.string().max(60).optional() })),
  'sale:get': ch<SaleDetail>()(id),
  'sale:return': ch<{ id: number; docNo: string; total: number }>()(saleReturnInput, { access: 'manager', write: true }),
  'sale:returnVoid': ch()(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }), { access: 'manager', write: true }),

  'draft:get': ch<{ payload: string | null; updatedAt: string | null }>()(z.undefined()),
  'draft:save': ch()(z.object({ payload: z.string().max(400_000) })),
  'draft:clear': ch()(z.undefined()),

  'print:run': ch<{ path: string | null }>()(printInput)
};
