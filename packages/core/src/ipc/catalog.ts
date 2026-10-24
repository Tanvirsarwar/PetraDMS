import { z } from 'zod';
import { ch, dateStr, id, none } from './define';

// ===== DTOs =====
export interface PackDto {
  id: number;
  name: string;
  nameBn: string;
  factor: number;
  priceRetail: number | null;
  priceWholesale: number | null;
  priceDealer: number | null;
  /** The pack's own barcode (scanning it adds one of this pack). */
  barcode: string | null;
}

export interface ProductDto {
  id: number;
  sku: string;
  name: string;
  nameBn: string;
  categoryId: number | null;
  categoryName: string;
  brandId: number | null;
  brandName: string;
  baseUnit: string;
  trackExpiry: boolean;
  /** Pack used by default when selling / buying; null means the base unit. */
  defaultSalePackId: number | null;
  defaultPurchasePackId: number | null;
  /** Selling prices are per ONE base unit, in poisha. */
  priceRetail: number;
  priceWholesale: number;
  priceDealer: number;
  minPrice: number;
  stockQty: number;
  /** Cost fields are null for Staff (plan 13.1). */
  stockValue: number | null;
  avgCost: number | null;
  lastCost: number | null;
  reorderLevel: number;
  favourite: boolean;
  status: 'active' | 'archived';
  notes: string;
  packs: PackDto[];
  barcodes: string[];
  hasHistory: boolean;
  nearestExpiry: string | null;
}

export interface LookupDto {
  id: number;
  name: string;
  nameBn: string;
  status: 'active' | 'archived';
}

export interface SupplierDto {
  id: number;
  name: string;
  nameBn: string;
  phone: string;
  address: string;
  /** Positive = we owe the supplier. */
  balance: number;
  status: 'active' | 'archived';
  notes: string;
}

export interface MoneyAccountDto {
  id: number;
  name: string;
  nameBn: string;
  kind: string;
  balance: number;
  isDefault: boolean;
}

export interface LedgerRow {
  id: number;
  date: string;
  kind: string;
  amount: number;
  balanceAfter: number;
  note: string;
  refType: string | null;
  refId: number | null;
  refNo: string;
  reversal: boolean;
}

export interface LedgerView {
  party: { id: number; name: string; balance: number; phone: string };
  rows: LedgerRow[];
}

export interface PurchaseListItem {
  id: number;
  docNo: string;
  date: string;
  supplierId: number | null;
  supplierName: string;
  supplierRef: string;
  total: number;
  paid: number;
  due: number;
  status: 'posted' | 'void';
  itemCount: number;
}

export interface SupplierProductDto {
  productId: number;
  /** Pack ("box") this company sells the product in; null = base unit. */
  defaultPackId: number | null;
  /** Cost of ONE default pack from this company's last invoice, in poisha. */
  lastCost: number | null;
  sort: number;
}

export interface PriceSuggestion {
  productId: number;
  sku: string;
  name: string;
  nameBn: string;
  baseUnit: string;
  /** The box pack bought; null when the product is bought by the base unit. */
  packId: number | null;
  packName: string;
  factor: number;
  /** Landed cost of ONE pack (discount, VAT and freight included) from this invoice, in poisha. */
  costPerPack: number;
  /** What the product sells for now per ONE pack: the pack's own price, else base price x factor. */
  current: { retail: number; wholesale: number; dealer: number };
}

export interface PurchaseItemDto {
  lineNo: number;
  productId: number;
  sku: string;
  productName: string;
  productNameBn: string;
  baseUnit: string;
  packName: string;
  packNameBn: string;
  factor: number;
  /** Whole packs (boxes). */
  qty: number;
  /** Extra pieces beside the boxes. */
  looseQty: number;
  baseQty: number;
  kind: 'normal' | 'free';
  unitCost: number;
  discKind: 'pct' | 'fixed' | null;
  discValue: number;
  discount: number;
  allocCharge: number;
  amount: number;
  batchNo: string;
  expiry: string | null;
  batchId: number | null;
}

export interface PurchaseDetail extends PurchaseListItem {
  subtotal: number;
  discount: number;
  invoiceDate: string | null;
  dueDate: string | null;
  discKind: 'pct' | 'fixed' | null;
  discValue: number;
  tax: number;
  freight: number;
  dupReason: string;
  note: string;
  accountId: number | null;
  voidReason: string | null;
  items: PurchaseItemDto[];
  returns: { id: number; docNo: string; date: string; credit: number; status: 'posted' | 'void' }[];
  /** Base units already returned to the company per product, by live returns of this purchase. */
  returnedByProduct: { productId: number; baseQty: number }[];
}

export interface StockMovementRow {
  id: number;
  date: string;
  kind: string;
  baseQty: number;
  balanceQty: number;
  value: number | null;
  refType: string | null;
  refId: number | null;
  refNo: string;
  batchNo: string;
  note: string;
  reversal: boolean;
}

export interface BatchDto {
  id: number;
  productId: number;
  sku: string;
  productName: string;
  batchNo: string;
  expiry: string | null;
  qty: number;
  daysToExpiry: number | null;
  state: 'expired' | 'soon' | 'ok' | 'none';
}

export interface StockAlerts {
  low: { productId: number; sku: string; name: string; stockQty: number; reorderLevel: number; baseUnit: string }[];
  expiring: BatchDto[];
  expired: BatchDto[];
}

export interface AdjustmentListItem {
  id: number;
  docNo: string;
  date: string;
  productId: number;
  sku: string;
  productName: string;
  kind: string;
  baseQty: number;
  value: number | null;
  reason: string;
  status: 'posted' | 'void';
}

// ===== Inputs =====
const poisha = z.number().int().min(0).max(9_000_000_000_000);
const qty = z.number().int().positive().max(1_000_000_000);
const optPrice = z.number().int().min(0).nullable().optional();

export const packInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(40),
  nameBn: z.string().trim().max(40).default(''),
  factor: z.number().int().min(2).max(100000),
  priceRetail: optPrice,
  priceWholesale: optPrice,
  priceDealer: optPrice,
  /** Barcode printed on the box itself. */
  barcode: z.string().trim().min(3).max(40).nullable().optional()
});

export const productSaveInput = z.object({
  id: z.number().int().positive().optional(),
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  nameBn: z.string().trim().max(160).default(''),
  categoryId: z.number().int().positive().nullable().default(null),
  brandId: z.number().int().positive().nullable().default(null),
  baseUnit: z.string().trim().min(1).max(20).default('pcs'),
  trackExpiry: z.boolean().default(false),
  priceRetail: poisha,
  priceWholesale: poisha,
  priceDealer: poisha,
  minPrice: poisha.default(0),
  reorderLevel: z.number().int().min(0).max(1_000_000_000).default(0),
  /** Pieces per box of the default sale / purchase unit; null or 1 = base unit. */
  defaultSaleFactor: z.number().int().min(1).max(100000).nullable().default(null),
  defaultPurchaseFactor: z.number().int().min(1).max(100000).nullable().default(null),
  favourite: z.boolean().default(false),
  notes: z.string().trim().max(500).default(''),
  /** Extra pack levels above the base unit (the base pack is created and kept automatically). */
  packs: z.array(packInput).max(8).default([]),
  barcodes: z.array(z.string().trim().min(3).max(40)).max(10).default([])
});

export const lookupSaveInput = z.object({
  kind: z.enum(['category', 'brand']),
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80),
  nameBn: z.string().trim().max(80).default(''),
  archived: z.boolean().optional()
});

export const supplierSaveInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  nameBn: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(300).default(''),
  notes: z.string().trim().max(500).default(''),
  /** Only when creating: what we already owe this supplier. */
  openingBalance: poisha.optional(),
  openingDate: dateStr.optional(),
  archived: z.boolean().optional()
});

const qty0 = z.number().int().min(0).max(1_000_000_000);
const discKindEnum = z.enum(['pct', 'fixed']);

export const purchaseSaveInput = z.object({
  supplierId: z.number().int().positive().nullable().default(null),
  /** The company's invoice number. */
  supplierRef: z.string().trim().max(60).default(''),
  date: dateStr,
  invoiceDate: dateStr.nullable().default(null),
  dueDate: dateStr.nullable().default(null),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        packId: z.number().int().positive().nullable().default(null),
        /** Whole packs (boxes); 0 when only pieces are bought. */
        qty: qty0,
        /** Pieces beside the boxes: "5 Box + 6 Pcs". */
        looseQty: qty0.default(0),
        /** Cost of ONE pack (box) in poisha. */
        unitCost: poisha,
        kind: z.enum(['normal', 'free']).default('normal'),
        discKind: discKindEnum.nullable().default(null),
        discValue: z.number().int().min(0).max(9_000_000_000_000).default(0),
        batchNo: z.string().trim().max(40).default(''),
        expiry: dateStr.nullable().default(null)
      }).refine((l) => l.qty + l.looseQty > 0, { message: 'quantity must be positive', path: ['qty'] })
    )
    .min(1)
    .max(300),
  discount: poisha.default(0),
  discKind: discKindEnum.nullable().default(null),
  discValue: z.number().int().min(0).max(9_000_000_000_000).default(0),
  tax: poisha.default(0),
  freight: poisha.default(0),
  paid: poisha.default(0),
  accountId: z.number().int().positive().nullable().default(null),
  note: z.string().trim().max(300).default(''),
  /** Needed to post a company invoice number that was already entered for this company. */
  duplicateReason: z.string().trim().max(200).default(''),
  /** Optional id chosen by the screen when the form opens; sending it again (double click, retry) never posts twice. */
  requestId: z.string().min(8).max(64).optional()
});

export const supplierLinkInput = z.object({
  supplierId: z.number().int().positive(),
  productIds: z.array(z.number().int().positive()).max(5000).default([]),
  /** Link every active product of this brand / category as well. */
  brandId: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional()
});

export const priceChangeInput = z.object({
  productId: z.number().int().positive(),
  /** The pack the prices are for; null = the base unit. */
  packId: z.number().int().positive().nullable().default(null),
  priceRetail: poisha,
  priceWholesale: poisha,
  priceDealer: poisha,
  /** Also set the per-piece price to price / box size (rounded to a whole poisha). */
  alsoBase: z.boolean().default(false)
});

export const purchaseReturnInput = z.object({
  supplierId: z.number().int().positive().nullable().default(null),
  purchaseId: z.number().int().positive().nullable().default(null),
  date: dateStr,
  lines: z.array(z.object({ productId: z.number().int().positive(), baseQty: qty, credit: poisha, batchId: z.number().int().positive().nullable().default(null) })).min(1).max(100),
  refundMode: z.enum(['due', 'cash']),
  accountId: z.number().int().positive().nullable().default(null),
  reason: z.string().trim().max(300).default(''),
  /** Optional id chosen by the screen when the form opens; sending it again (double click, retry) never posts twice. */
  requestId: z.string().min(8).max(64).optional()
});

export const paymentSaveInput = z.object({
  partyKind: z.enum(['customer', 'supplier']),
  partyId: z.number().int().positive(),
  amount: z.number().int().positive().max(9_000_000_000_000),
  date: dateStr,
  accountId: z.number().int().positive().nullable().default(null),
  reference: z.string().trim().max(60).default(''),
  note: z.string().trim().max(300).default(''),
  /** Optional id chosen by the screen when the form opens; sending it again (double click, retry) never posts twice. */
  requestId: z.string().min(8).max(64).optional()
});

export const adjustInput = z.object({
  productId: z.number().int().positive(),
  kind: z.enum(['opening', 'adjust_in', 'adjust_out', 'damage', 'expired', 'internal_use']),
  baseQty: qty,
  date: dateStr,
  reason: z.string().trim().max(300).default(''),
  /** Total value in poisha for `opening` and `adjust_in`. Omit to use the average cost. */
  value: poisha.optional(),
  batch: z.object({ batchNo: z.string().trim().max(40).default(''), expiry: dateStr.nullable().default(null) }).optional(),
  batchId: z.number().int().positive().nullable().optional(),
  /** Optional id chosen by the screen when the form opens; sending it again (double click, retry) never posts twice. */
  requestId: z.string().min(8).max(64).optional()
});

const range = z.object({ from: dateStr.optional(), to: dateStr.optional() });

// ===== Bulk product actions =====
export type ProductDeleteBlockReason = 'hasSales' | 'hasPurchases' | 'hasStock' | 'hasHistory';

export interface ProductsDeletePreview {
  /** Products with no history anywhere: these would really be deleted. */
  deletable: number[];
  /** Products that have history: these can only be archived. */
  blocked: { id: number; reason: ProductDeleteBlockReason }[];
}

/** Most products one bulk action may touch; keeps a single transaction short and bounded. */
export const BULK_PRODUCT_MAX = 2000;
const bulkIds = z.array(z.number().int().positive()).min(1).max(BULK_PRODUCT_MAX);

export const catalogChannels = {
  'catalog:products': ch<ProductDto[]>()(z.object({ includeArchived: z.boolean().default(false) })),
  'catalog:productSave': ch<{ id: number }>()(productSaveInput, { access: 'manager', write: true }),
  'catalog:productArchive': ch()(z.object({ id: z.number().int().positive(), archived: z.boolean() }), { access: 'manager', write: true }),
  'catalog:productsArchive': ch<{ changed: number; skipped: number }>()(z.object({ ids: bulkIds, archived: z.boolean() }), { access: 'manager', write: true }),
  'catalog:productsDeletePreview': ch<ProductsDeletePreview>()(z.object({ ids: bulkIds }), { access: 'manager' }),
  'catalog:productsDelete': ch<{ deleted: number; archivedInstead: number }>()(z.object({ ids: bulkIds, confirm: z.literal('DELETE') }), { access: 'manager', write: true }),
  'catalog:lookups': ch<{ categories: LookupDto[]; brands: LookupDto[] }>()(none),
  'catalog:lookupSave': ch<{ id: number }>()(lookupSaveInput, { access: 'manager', write: true }),
  'catalog:suppliers': ch<SupplierDto[]>()(z.object({ includeArchived: z.boolean().default(false) }), { access: 'manager' }),
  'catalog:supplierSave': ch<{ id: number }>()(supplierSaveInput, { access: 'manager', write: true }),

  'money:accounts': ch<MoneyAccountDto[]>()(none),
  'party:ledger': ch<LedgerView>()(z.object({ kind: z.enum(['customer', 'supplier', 'employee']), id: z.number().int().positive(), from: dateStr.optional(), to: dateStr.optional() })),
  'payment:save': ch<{ id: number; docNo: string }>()(paymentSaveInput, { write: true }),
  'payment:void': ch()(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }), { access: 'manager', write: true }),

  'purchase:save': ch<{ id: number; docNo: string; total: number; paid: number; due: number }>()(purchaseSaveInput, { access: 'manager', write: true }),
  'purchase:list': ch<PurchaseListItem[]>()(range.extend({ supplierId: z.number().int().positive().optional(), search: z.string().max(60).optional() }), { access: 'manager' }),
  'purchase:get': ch<PurchaseDetail>()(id, { access: 'manager' }),
  'purchase:checkRef': ch<{ docNo: string | null }>()(z.object({ supplierId: z.number().int().positive(), ref: z.string().trim().max(60) }), { access: 'manager' }),
  'purchase:draftGet': ch<{ payload: string | null; updatedAt: string | null }>()(none, { access: 'manager' }),
  'purchase:draftSave': ch()(z.object({ payload: z.string().max(2_000_000) }), { access: 'manager', write: true }),
  'purchase:draftClear': ch()(none, { access: 'manager', write: true }),
  'purchase:priceSuggest': ch<PriceSuggestion[]>()(id, { access: 'manager' }),
  'purchase:applyPrices': ch<{ updated: number }>()(z.object({ changes: z.array(priceChangeInput).min(1).max(300) }), { access: 'manager', write: true }),
  'supplier:products': ch<SupplierProductDto[]>()(z.object({ supplierId: z.number().int().positive() }), { access: 'manager' }),
  'supplier:link': ch<{ added: number; already: number }>()(supplierLinkInput, { access: 'manager', write: true }),
  'supplier:unlink': ch<{ removed: number }>()(z.object({ supplierId: z.number().int().positive(), productIds: z.array(z.number().int().positive()).min(1).max(5000) }), { access: 'manager', write: true }),
  'supplier:linkEdit': ch()(z.object({ supplierId: z.number().int().positive(), productId: z.number().int().positive(), defaultPackId: z.number().int().positive().nullable().optional(), lastCost: poisha.nullable().optional() }), { access: 'manager', write: true }),
  'purchase:void': ch()(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }), { access: 'manager', write: true }),
  'purchase:return': ch<{ id: number; docNo: string; credit: number; costValue: number; variance: number }>()(purchaseReturnInput, { access: 'manager', write: true }),
  'purchase:returnVoid': ch()(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }), { access: 'manager', write: true }),

  'stock:movements': ch<StockMovementRow[]>()(range.extend({ productId: z.number().int().positive(), limit: z.number().int().min(1).max(2000).default(500) }), { access: 'manager' }),
  'stock:batches': ch<BatchDto[]>()(z.object({ productId: z.number().int().positive().optional(), includeEmpty: z.boolean().default(false) })),
  'stock:alerts': ch<StockAlerts>()(z.object({ soonDays: z.number().int().min(1).max(365).default(30) })),
  'stock:adjust': ch<{ id: number; docNo: string; value: number }>()(adjustInput, { access: 'manager', write: true }),
  'stock:adjustments': ch<AdjustmentListItem[]>()(range, { access: 'manager' }),
  'stock:adjustVoid': ch()(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }), { access: 'manager', write: true })
};
