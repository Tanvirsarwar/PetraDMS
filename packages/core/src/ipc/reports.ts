import { z } from 'zod';
import { ch, dateStr } from './define';

export const REPORT_IDS = [
  'summary', 'sales', 'purchases', 'aging', 'collection', 'statement', 'supplierDue', 'stockValue', 'lowStock', 'expiring', 'stockLedger',
  'profitProduct', 'profitCustomer', 'cashbook', 'dayclose', 'expenses', 'salary'
] as const;
export type ReportId = (typeof REPORT_IDS)[number];

/** Reports staff may open. They never contain cost, profit or stock value. */
export const STAFF_REPORTS: readonly ReportId[] = ['summary', 'sales', 'aging', 'collection', 'lowStock', 'expiring', 'statement'];

export type ReportCell = string | number | null;

export interface ReportCol {
  key: string;
  /** i18n key of the column heading. */
  labelKey: string;
  /**
   * text: shown as is. key: the value is an i18n key. date: YYYY-MM-DD. money: poisha. qty/int: whole numbers.
   * pct: basis points. days: whole days. stock: box + pcs text such as "12 Box 5 pcs" (ASCII digits; screens and prints
   * show them in the reader's digits; the raw quantity stays in its own qty column for exports).
   */
  kind: 'text' | 'key' | 'date' | 'money' | 'qty' | 'int' | 'pct' | 'days' | 'stock';
}

export interface ReportResult {
  id: ReportId;
  /** i18n key of the title. */
  titleKey: string;
  columns: ReportCol[];
  rows: ReportCell[][];
  /** One bold row under the table, aligned to the columns. Null cells are blank. */
  totals: ReportCell[] | null;
  /** Lines above the table: label i18n key, value and how to show it. */
  summary: { labelKey: string; value: ReportCell; kind: ReportCol['kind'] }[];
}

const posId = z.number().int().positive();

export const reportParams = z.object({
  id: z.enum(REPORT_IDS),
  from: dateStr.optional(),
  to: dateStr.optional(),
  /** Due aging, stock valuation and similar "as of today" reports. */
  asOf: dateStr.optional(),
  groupBy: z.enum(['product', 'customer', 'area', 'date']).optional(),
  areaId: posId.optional(),
  customerId: posId.optional(),
  supplierId: posId.optional(),
  productId: posId.optional(),
  accountId: posId.optional(),
  categoryId: posId.optional(),
  soonDays: z.number().int().min(1).max(730).optional()
});
export type ReportParams = z.infer<typeof reportParams>;

export const reportExportInput = z.object({
  params: reportParams,
  format: z.enum(['csv', 'xlsx']),
  title: z.string().trim().min(1).max(120),
  /** Column headings as the user sees them, in the same order as the result columns. */
  headers: z.array(z.string().max(80)).min(1).max(40),
  /** Translations for every `key` cell in the result. */
  dict: z.record(z.string(), z.string().max(200)).default({})
});

export const reportPrintDoc = z.object({
  type: z.literal('report'),
  params: reportParams,
  title: z.string().trim().min(1).max(120),
  headers: z.array(z.string().max(80)).min(1).max(40),
  dict: z.record(z.string(), z.string().max(200)).default({})
});

export interface DashboardDto {
  date: string;
  today: { invoices: number; sales: number; returns: number; collected: number; due: number; profit: number };
  month: { sales: number; profit: number; expenses: number; salary: number; stockLoss: number; netProfit: number; purchases: number };
  receivables: number;
  payables: number;
  stockValue: number;
  cash: number;
  accountsTotal: number;
  lowStock: number;
  expiring: number;
  expired: number;
  unclosedDays: number;
  lastClosed: string | null;
  trend: { date: string; sales: number }[];
  topProducts: { productId: number; name: string; nameBn: string; net: number }[];
  recent: { id: number; docNo: string; customer: string; total: number; due: number; status: 'posted' | 'void' }[];
  topDue: { customerId: number; name: string; due: number }[];
}

export const reportChannels = {
  'report:run': ch<ReportResult>()(reportParams),
  'report:export': ch<{ path: string }>()(reportExportInput, { access: 'manager' }),
  'dash:get': ch<DashboardDto>()(z.undefined(), { access: 'manager' })
};
