import { z } from 'zod';
import { ch } from './define';
import { IMPORT_KINDS, IMPORT_LIMITS, type ImportKind, type Mapping, type RowIssue } from '../importer';

export interface GameScore {
  player: string;
  score: number;
  at: string;
}

export interface ImportRowReport {
  /** Line number in the file (the header is line 1). */
  line: number;
  ok: boolean;
  cells: string[];
  issues: RowIssue[];
}

export interface ImportPreview {
  headers: string[];
  delimiter: string;
  mapping: Mapping;
  /** Problems with the column mapping itself; while any exist nothing can be imported. */
  mappingIssues: { field: string; code: string }[];
  total: number;
  good: number;
  bad: number;
  /** Every bad row (up to 500) followed by the first good rows, in file order within each group. */
  rows: ImportRowReport[];
  truncated: boolean;
}

export interface ImportResult {
  dryRun: boolean;
  created: number;
  skipped: number;
  /** Rows that were refused, with the reason (file problems and database conflicts). */
  failed: ImportRowReport[];
  newCategories: number;
  newBrands: number;
  newAreas: number;
  /** Companies created because a product row named one that was not in the app yet. */
  newSuppliers: number;
  stockLines: number;
  duesPosted: number;
  /** Company invoices saved by a purchase import. */
  purchasesPosted: number;
}

const mapping = z.record(z.string().max(40), z.number().int().min(0).max(500).nullable());
const body = {
  kind: z.enum(IMPORT_KINDS),
  text: z.string().max(IMPORT_LIMITS.maxChars),
  mapping: mapping.optional()
};

export interface ExportAllResult { path: string; bytes: number; files: number }

export const dataChannels = {
  'import:template': ch<{ path: string }>()(z.object({ kind: z.enum(IMPORT_KINDS) }), { access: 'manager' }),
  'import:preview': ch<ImportPreview>()(z.object(body), { access: 'manager' }),
  'import:run': ch<ImportResult>()(z.object({ ...body, mapping, dryRun: z.boolean(), skipBad: z.boolean() }), { access: 'manager', write: true }),
  'import:rejects': ch<{ path: string }>()(z.object({ ...body, problemHeader: z.string().max(60), messages: z.record(z.string().max(60), z.string().max(300)).default({}) }), { access: 'manager' }),
  'export:all': ch<ExportAllResult>()(z.undefined(), { access: 'owner' }),
  'demo:load': ch()(z.undefined(), { access: 'owner', write: true }),
  'game:scores': ch<GameScore[]>()(z.undefined(), { access: 'user' }),
  'game:submit': ch<GameScore[]>()(z.object({ score: z.number().int().min(0).max(1_000_000) }), { access: 'user' }),
  'demo:clear': ch<{ cleared: true }>()(z.object({ confirm: z.literal('DEMO') }), { access: 'owner' })
};
export type { ImportKind };
