import { asciiDigits, parseDateLoose, parseTaka, parseWhole, parseYesNo } from './csv';
import { isBdMobile } from './settings';

export const IMPORT_KINDS = ['products', 'customers', 'dues', 'purchases'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_LIMITS = { maxChars: 4_000_000, maxRows: 20_000 } as const;

export interface FieldDef {
  key: string;
  required: boolean;
  /** Header spellings recognised automatically (lower case, English and Bangla). */
  aliases: string[];
  /** Value shown in the downloadable template. */
  sample: string;
}

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  products: [
    { key: 'sku', required: true, aliases: ['sku', 'code', 'item code', 'product code', 'কোড', 'এসকেইউ'], sample: 'MARKS-PM-500G' },
    { key: 'name', required: true, aliases: ['name', 'product', 'product name', 'item', 'পণ্য', 'পণ্যের নাম', 'নাম'], sample: 'Marks Milk Powder 500g' },
    { key: 'nameBn', required: false, aliases: ['name bn', 'bangla name', 'name (bangla)', 'বাংলা নাম'], sample: 'মার্কস গুঁড়া দুধ ৫০০ গ্রাম' },
    { key: 'category', required: false, aliases: ['category', 'group', 'ক্যাটাগরি', 'বিভাগ'], sample: 'Dairy' },
    { key: 'brand', required: false, aliases: ['brand', 'ব্র্যান্ড'], sample: 'Marks' },
    { key: 'unit', required: false, aliases: ['unit', 'base unit', 'uom', 'একক'], sample: 'pcs' },
    { key: 'priceRetail', required: false, aliases: ['retail', 'retail price', 'price', 'mrp', 'selling price', 'খুচরা', 'খুচরা দাম', 'দাম'], sample: '640.00' },
    { key: 'priceWholesale', required: false, aliases: ['wholesale', 'wholesale price', 'পাইকারি', 'পাইকারি দাম'], sample: '610.00' },
    { key: 'priceDealer', required: false, aliases: ['dealer', 'dealer price', 'ডিলার', 'ডিলার দাম'], sample: '595.00' },
    { key: 'minPrice', required: false, aliases: ['min price', 'minimum price', 'সর্বনিম্ন দাম'], sample: '580.00' },
    { key: 'reorderLevel', required: false, aliases: ['reorder', 'reorder level', 'low stock', 'রিঅর্ডার'], sample: '10' },
    { key: 'barcode', required: false, aliases: ['barcode', 'ean', 'upc', 'বারকোড'], sample: '8901234567890' },
    { key: 'trackExpiry', required: false, aliases: ['track expiry', 'expiry', 'has expiry', 'মেয়াদ'], sample: 'no' },
    { key: 'openingQty', required: false, aliases: ['opening qty', 'opening stock', 'stock', 'quantity', 'qty', 'প্রারম্ভিক স্টক', 'স্টক'], sample: '' },
    { key: 'openingCost', required: false, aliases: ['opening cost', 'cost', 'unit cost', 'cost price', 'কেনা দাম', 'ক্রয়মূল্য'], sample: '' },
    // v1.1: box + pcs and the company
    { key: 'boxName', required: false, aliases: ['box name', 'pack name', 'pack', 'carton name', 'বক্সের নাম'], sample: 'Box' },
    { key: 'pcsPerBox', required: false, aliases: ['pcs per box', 'pieces per box', 'box size', 'pack size', 'per box', 'factor', 'বক্সে পিস'], sample: '24' },
    { key: 'boxRetail', required: false, aliases: ['box retail', 'box price', 'carton price', 'box retail price', 'বক্সের খুচরা দাম'], sample: '15000.00' },
    { key: 'boxWholesale', required: false, aliases: ['box wholesale', 'box wholesale price', 'বক্সের পাইকারি দাম'], sample: '14400.00' },
    { key: 'boxDealer', required: false, aliases: ['box dealer', 'box dealer price', 'বক্সের ডিলার দাম'], sample: '' },
    { key: 'defaultSaleUnit', required: false, aliases: ['default sale unit', 'sale unit', 'sell in', 'বিক্রির একক'], sample: 'box' },
    { key: 'defaultPurchaseUnit', required: false, aliases: ['default purchase unit', 'purchase unit', 'buy in', 'কেনার একক'], sample: 'box' },
    { key: 'supplier', required: false, aliases: ['supplier', 'company', 'vendor', 'কোম্পানি', 'সরবরাহকারী'], sample: 'Marks Ltd' },
    { key: 'openingBox', required: false, aliases: ['opening box', 'opening boxes', 'opening box qty', 'প্রারম্ভিক বক্স'], sample: '2' },
    { key: 'openingPcs', required: false, aliases: ['opening pcs', 'opening pieces', 'opening loose', 'প্রারম্ভিক পিস'], sample: '0' },
    { key: 'openingCostPerBox', required: false, aliases: ['opening cost per box', 'cost per box', 'box cost', 'বক্সের ক্রয়মূল্য'], sample: '13440.00' }
  ],
  customers: [
    { key: 'name', required: true, aliases: ['name', 'customer', 'customer name', 'shop', 'shop name', 'গ্রাহক', 'গ্রাহকের নাম', 'নাম', 'দোকান'], sample: 'Rahman Store' },
    { key: 'nameBn', required: false, aliases: ['name bn', 'bangla name', 'বাংলা নাম'], sample: 'রহমান স্টোর' },
    { key: 'phone', required: false, aliases: ['phone', 'mobile', 'cell', 'ফোন', 'মোবাইল'], sample: '01712345678' },
    { key: 'address', required: false, aliases: ['address', 'ঠিকানা'], sample: 'Zindabazar, Sylhet' },
    { key: 'area', required: false, aliases: ['area', 'route', 'zone', 'এলাকা', 'রুট'], sample: 'Zindabazar' },
    { key: 'type', required: false, aliases: ['type', 'customer type', 'tier', 'ধরন'], sample: 'retail' },
    { key: 'creditLimit', required: false, aliases: ['credit limit', 'limit', 'বাকির সীমা', 'ক্রেডিট লিমিট'], sample: '20000.00' },
    { key: 'openingDue', required: false, aliases: ['opening due', 'due', 'balance', 'opening balance', 'previous due', 'বাকি', 'পুরনো বাকি'], sample: '3500.00' },
    { key: 'openingDate', required: false, aliases: ['opening date', 'due date', 'as of', 'তারিখ'], sample: '2026-10-01' }
  ],
  dues: [
    { key: 'party', required: true, aliases: ['party', 'party type', 'kind', 'type', 'ধরন'], sample: 'customer' },
    { key: 'name', required: false, aliases: ['name', 'party name', 'customer', 'supplier', 'নাম'], sample: 'Rahman Store' },
    { key: 'phone', required: false, aliases: ['phone', 'mobile', 'ফোন', 'মোবাইল'], sample: '01712345678' },
    { key: 'amount', required: true, aliases: ['amount', 'due', 'balance', 'opening due', 'টাকা', 'বাকি', 'পরিমাণ'], sample: '3500.00' },
    { key: 'date', required: false, aliases: ['date', 'as of', 'তারিখ'], sample: '2026-10-01' }
  ],
  // v1.1: company invoices. Rows with the same company and invoice number become one purchase (on credit).
  purchases: [
    { key: 'supplier', required: true, aliases: ['supplier', 'company', 'vendor', 'কোম্পানি', 'সরবরাহকারী'], sample: 'Marks Ltd' },
    { key: 'invoiceNo', required: true, aliases: ['invoice', 'invoice no', 'invoice number', 'bill no', 'challan', 'চালান', 'চালান নং'], sample: 'MK-1001' },
    { key: 'date', required: false, aliases: ['date', 'invoice date', 'তারিখ'], sample: '2026-10-01' },
    { key: 'sku', required: true, aliases: ['sku', 'code', 'item code', 'product code', 'কোড'], sample: 'MARKS-PM-500G' },
    { key: 'box', required: false, aliases: ['box', 'boxes', 'ctn', 'carton', 'cartons', 'বক্স'], sample: '5' },
    { key: 'pcs', required: false, aliases: ['pcs', 'pieces', 'loose', 'পিস'], sample: '6' },
    { key: 'cost', required: true, aliases: ['cost', 'cost per box', 'rate', 'tp', 'trade price', 'দর'], sample: '13440.00' },
    { key: 'discount', required: false, aliases: ['discount', 'line discount', 'ছাড়'], sample: '0' }
  ]
};

/** For each field key, the zero-based CSV column it reads, or null when not mapped. */
export type Mapping = Record<string, number | null>;

const norm = (s: string) => asciiDigits(s).toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Matches column headings to fields by name (exact alias first, then the field key itself). Each column is used once. */
export function autoMap(kind: ImportKind, headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<number>();
  const heads = headers.map(norm);
  for (const f of IMPORT_FIELDS[kind]) {
    const names = [norm(f.key), ...f.aliases.map(norm)];
    const ix = heads.findIndex((h, i) => !used.has(i) && names.includes(h));
    out[f.key] = ix >= 0 ? ix : null;
    if (ix >= 0) used.add(ix);
  }
  return out;
}

/** Mapping problems that stop the import before any row is read: a required field with no column, or two fields on one column. */
export function mappingProblems(kind: ImportKind, m: Mapping, columns: number): { field: string; code: 'missingColumn' | 'sameColumn' | 'badColumn' }[] {
  const out: { field: string; code: 'missingColumn' | 'sameColumn' | 'badColumn' }[] = [];
  const seen = new Map<number, string>();
  for (const f of IMPORT_FIELDS[kind]) {
    const c = m[f.key] ?? null;
    if (c === null) {
      if (f.required) out.push({ field: f.key, code: 'missingColumn' });
      continue;
    }
    if (!Number.isInteger(c) || c < 0 || c >= columns) out.push({ field: f.key, code: 'badColumn' });
    else if (seen.has(c)) out.push({ field: f.key, code: 'sameColumn' });
    else seen.set(c, f.key);
  }
  if (kind === 'dues' && m.name === null && m.phone === null) out.push({ field: 'name', code: 'missingColumn' });
  return out;
}

export interface RowIssue {
  /** Field key, or null for a problem with the whole row. */
  field: string | null;
  code: string;
}

export interface ProductRow {
  sku: string; name: string; nameBn: string; category: string; brand: string; unit: string;
  priceRetail: number; priceWholesale: number | null; priceDealer: number | null; minPrice: number; reorderLevel: number;
  barcode: string; trackExpiry: boolean; openingQty: number; openingCost: number | null;
  /** v1.1 box: pcsPerBox 0 means the product has no box. */
  boxName: string; pcsPerBox: number; boxRetail: number | null; boxWholesale: number | null; boxDealer: number | null;
  defaultSaleUnit: 'box' | 'pcs'; defaultPurchaseUnit: 'box' | 'pcs'; supplier: string;
  openingBox: number; openingPcs: number; openingCostPerBox: number | null;
}
/** Opening stock of an imported product in base units (the old "opening stock" column counts pieces). */
export const openingBase = (r: ProductRow): number => r.openingQty + r.openingBox * Math.max(1, r.pcsPerBox) + r.openingPcs;
export interface PurchaseImportRow { supplier: string; invoiceNo: string; date: string | null; sku: string; box: number; pcs: number; cost: number; discount: number }
export interface CustomerRow {
  name: string; nameBn: string; phone: string; address: string; area: string; type: 'retail' | 'wholesale' | 'dealer';
  creditLimit: number; openingDue: number; openingDate: string | null;
}
export interface DueRow { party: 'customer' | 'supplier'; name: string; phone: string; amount: number; date: string | null }
export type ParsedRow = ProductRow | CustomerRow | DueRow | PurchaseImportRow;

const TYPES: Record<string, CustomerRow['type']> = {
  retail: 'retail', r: 'retail', খুচরা: 'retail', wholesale: 'wholesale', w: 'wholesale', পাইকারি: 'wholesale', পাইকারী: 'wholesale', dealer: 'dealer', d: 'dealer', ডিলার: 'dealer'
};
const UNITS: Record<string, 'box' | 'pcs'> = { box: 'box', b: 'box', ctn: 'box', carton: 'box', pack: 'box', বক্স: 'box', কার্টন: 'box', pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', unit: 'pcs', p: 'pcs', পিস: 'pcs' };
const PARTIES: Record<string, DueRow['party']> = { customer: 'customer', c: 'customer', গ্রাহক: 'customer', ক্রেতা: 'customer', supplier: 'supplier', s: 'supplier', vendor: 'supplier', সরবরাহকারী: 'supplier', সাপ্লায়ার: 'supplier' };

/** Phones are stored as 01XXXXXXXXX: spaces, dashes and a +88 / 88 prefix are accepted on the way in. */
export function cleanPhone(raw: string): string {
  let s = asciiDigits(raw).replace(/[\s\-()]/g, '');
  if (s.startsWith('+88')) s = s.slice(3);
  else if (s.startsWith('88') && s.length === 13) s = s.slice(2);
  return s;
}

const MAX_TEXT = 200;

/**
 * Turns the cells of one row into typed values, or says what is wrong with each field. Checks that need the database
 * (a SKU already in use, an unknown customer) are done by the caller.
 */
export function checkRow(kind: ImportKind, cells: string[], m: Mapping): { value: ParsedRow | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const raw = (k: string): string => {
    const c = m[k];
    return c === null || c === undefined ? '' : (cells[c] ?? '').trim();
  };
  const text = (k: string, required = false): string => {
    const v = raw(k);
    if (required && v === '') issues.push({ field: k, code: 'required' });
    else if (v.length > MAX_TEXT) issues.push({ field: k, code: 'tooLong' });
    return v;
  };
  const money = (k: string, opts: { min?: number; blankNull?: boolean } = {}): number | null => {
    const v = raw(k);
    if (v === '') return opts.blankNull ? null : 0;
    const p = parseTaka(v);
    if (p === null) {
      issues.push({ field: k, code: 'number' });
      return opts.blankNull ? null : 0;
    }
    if (p < (opts.min ?? 0)) {
      issues.push({ field: k, code: 'negative' });
      return 0;
    }
    return p;
  };
  const whole = (k: string): number => {
    const v = raw(k);
    if (v === '') return 0;
    const n = parseWhole(v);
    if (n === null) {
      issues.push({ field: k, code: 'whole' });
      return 0;
    }
    if (n < 0) {
      issues.push({ field: k, code: 'negative' });
      return 0;
    }
    return n;
  };
  const date = (k: string): string | null => {
    const v = raw(k);
    if (v === '') return null;
    const d = parseDateLoose(v);
    if (d === null) issues.push({ field: k, code: 'date' });
    return d;
  };

  if (kind === 'products') {
    const sku = text('sku', true);
    const name = text('name', true);
    const row: ProductRow = {
      sku, name, nameBn: text('nameBn'), category: text('category'), brand: text('brand'), unit: text('unit') || 'pcs',
      priceRetail: money('priceRetail') as number, priceWholesale: money('priceWholesale', { blankNull: true }), priceDealer: money('priceDealer', { blankNull: true }),
      minPrice: money('minPrice') as number, reorderLevel: whole('reorderLevel'), barcode: asciiDigits(text('barcode')).replace(/\s/g, ''), trackExpiry: false,
      openingQty: whole('openingQty'), openingCost: money('openingCost', { blankNull: true }),
      boxName: '', pcsPerBox: 0, boxRetail: null, boxWholesale: null, boxDealer: null, defaultSaleUnit: 'pcs', defaultPurchaseUnit: 'pcs', supplier: '', openingBox: 0, openingPcs: 0, openingCostPerBox: null
    };
    const te = raw('trackExpiry');
    const yn = parseYesNo(te);
    if (yn === null) issues.push({ field: 'trackExpiry', code: 'yesNo' });
    else row.trackExpiry = yn;
    if (row.barcode && !/^[0-9A-Za-z-]{3,40}$/.test(row.barcode)) issues.push({ field: 'barcode', code: 'barcode' });
    if (row.minPrice > 0 && row.priceRetail > 0 && row.minPrice > row.priceRetail) issues.push({ field: 'minPrice', code: 'minAboveRetail' });
    // box + pcs
    row.pcsPerBox = whole('pcsPerBox');
    row.boxName = text('boxName');
    row.boxRetail = money('boxRetail', { blankNull: true });
    row.boxWholesale = money('boxWholesale', { blankNull: true });
    row.boxDealer = money('boxDealer', { blankNull: true });
    row.supplier = text('supplier');
    row.openingBox = whole('openingBox');
    row.openingPcs = whole('openingPcs');
    row.openingCostPerBox = money('openingCostPerBox', { blankNull: true });
    const unit = (k: 'defaultSaleUnit' | 'defaultPurchaseUnit'): 'box' | 'pcs' => {
      const v = asciiDigits(raw(k)).toLowerCase();
      if (v === '') return 'pcs';
      const u = UNITS[v];
      if (!u) issues.push({ field: k, code: 'choice' });
      return u ?? 'pcs';
    };
    row.defaultSaleUnit = unit('defaultSaleUnit');
    row.defaultPurchaseUnit = unit('defaultPurchaseUnit');
    if (row.pcsPerBox === 1 || row.pcsPerBox > 100_000) issues.push({ field: 'pcsPerBox', code: 'boxSize' });
    const wantsBox = row.boxName !== '' || row.boxRetail !== null || row.boxWholesale !== null || row.boxDealer !== null || row.openingBox > 0 || row.openingCostPerBox !== null || row.defaultSaleUnit === 'box' || row.defaultPurchaseUnit === 'box';
    if (wantsBox && row.pcsPerBox === 0) issues.push({ field: 'pcsPerBox', code: 'required' });
    if (row.pcsPerBox >= 2 && !row.boxName) row.boxName = 'Box';
    if (row.boxName && row.boxName.toLowerCase() === row.unit.toLowerCase()) issues.push({ field: 'boxName', code: 'sameAsUnit' });
    const opening = openingBase(row);
    if (opening > 0 && row.openingCost === null && row.openingCostPerBox === null) issues.push({ field: row.openingBox > 0 ? 'openingCostPerBox' : 'openingCost', code: 'required' });
    if (opening > 0 && row.trackExpiry) issues.push({ field: row.openingQty > 0 ? 'openingQty' : 'openingBox', code: 'expiryStock' });
    return { value: issues.length ? null : row, issues };
  }

  if (kind === 'customers') {
    const phone = cleanPhone(raw('phone'));
    if (phone !== '' && !isBdMobile(phone)) issues.push({ field: 'phone', code: 'phone' });
    const tRaw = raw('type');
    const type = tRaw === '' ? 'retail' : TYPES[asciiDigits(tRaw).toLowerCase()];
    if (!type) issues.push({ field: 'type', code: 'choice' });
    const row: CustomerRow = {
      name: text('name', true), nameBn: text('nameBn'), phone, address: text('address'), area: text('area'), type: type ?? 'retail',
      creditLimit: money('creditLimit') as number, openingDue: money('openingDue', { min: Number.MIN_SAFE_INTEGER }) as number, openingDate: date('openingDate')
    };
    return { value: issues.length ? null : row, issues };
  }

  if (kind === 'purchases') {
    const row: PurchaseImportRow = {
      supplier: text('supplier', true), invoiceNo: text('invoiceNo', true), date: date('date'), sku: text('sku', true),
      box: whole('box'), pcs: whole('pcs'), cost: 0, discount: money('discount') as number
    };
    const c = raw('cost');
    if (c === '') issues.push({ field: 'cost', code: 'required' });
    else row.cost = money('cost') as number;
    if (row.box + row.pcs === 0 && !issues.some((x) => x.field === 'box' || x.field === 'pcs')) issues.push({ field: 'box', code: 'noQty' });
    return { value: issues.length ? null : row, issues };
  }

  const pRaw = raw('party');
  const party = pRaw === '' ? undefined : PARTIES[asciiDigits(pRaw).toLowerCase()];
  if (pRaw === '') issues.push({ field: 'party', code: 'required' });
  else if (!party) issues.push({ field: 'party', code: 'choice' });
  const phone = cleanPhone(raw('phone'));
  if (phone !== '' && !isBdMobile(phone)) issues.push({ field: 'phone', code: 'phone' });
  const name = text('name');
  if (name === '' && phone === '') issues.push({ field: 'name', code: 'nameOrPhone' });
  const amountRaw = raw('amount');
  let amount = 0;
  if (amountRaw === '') issues.push({ field: 'amount', code: 'required' });
  else {
    const a = parseTaka(amountRaw);
    if (a === null) issues.push({ field: 'amount', code: 'number' });
    else if (a === 0) issues.push({ field: 'amount', code: 'zero' });
    else amount = a;
  }
  const row: DueRow = { party: party ?? 'customer', name, phone, amount, date: date('date') };
  return { value: issues.length ? null : row, issues };
}

/** The header row and one sample row of the downloadable template, in the field order the importer expects. */
export function templateRows(kind: ImportKind): string[][] {
  const f = IMPORT_FIELDS[kind];
  return [f.map((x) => x.key), f.map((x) => x.sample)];
}
