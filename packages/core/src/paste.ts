import { asciiDigits, parseCsv, parseTaka, parseWhole } from './csv';

/**
 * "Paste from Excel" for company invoices: rows copied from a spreadsheet (tab separated) or a CSV,
 * matched to products by SKU, barcode or exact name. Nothing is dropped silently: every row comes back,
 * either matched with numbers or with the problems that stop it.
 */
export const PASTE_FIELDS = ['product', 'box', 'pcs', 'cost'] as const;
export type PasteField = (typeof PASTE_FIELDS)[number];
export type PasteMapping = Record<PasteField, number | null>;

export type PasteProblem = 'noProduct' | 'badBox' | 'badPcs' | 'badCost' | 'noQty';

export interface PasteRow {
  /** 1-based line in the pasted text. */
  line: number;
  cells: string[];
  productText: string;
  productId: number | null;
  box: number;
  pcs: number;
  /** Cost per box in poisha; null when the column is not mapped or the cell is empty. */
  cost: number | null;
  problems: PasteProblem[];
  /** Not an invoice line (a total, a blank or a note row): no product and no quantity. Shown, skipped by default. */
  ignored: boolean;
}

export interface MatchableProduct {
  id: number;
  sku: string;
  name: string;
  nameBn: string;
  barcodes: string[];
}

const ALIASES: Record<PasteField, string[]> = {
  product: ['sku', 'code', 'product code', 'item code', 'product', 'item', 'name', 'description', 'particulars', 'পণ্য', 'নাম', 'কোড'],
  box: ['box', 'boxes', 'ctn', 'carton', 'cartons', 'case', 'cases', 'ctn qty', 'carton qty', 'box qty', 'বক্স', 'কার্টন'],
  pcs: ['pcs', 'pc', 'piece', 'pieces', 'loose', 'unit', 'units', 'pcs qty', 'loose qty', 'পিস'],
  cost: ['cost', 'rate', 'price', 'tp', 'trade price', 'cost per box', 'box rate', 'tp/ctn', 'tp per ctn', 'rate/ctn', 'price/ctn', 'tp/box', 'rate/box', 'price/box', 'দর', 'দাম', 'রেট']
};

const norm = (s: string): string => asciiDigits(s).trim().toLowerCase().replace(/\s+/g, ' ');
/** A heading cell: "TP / CTN" and "tp/ctn" are the same, "Rate (Tk)" reads as "rate". */
const normHead = (s: string): string => norm(s).replace(/\s*\/\s*/g, '/').replace(/\s*\((tk|taka|৳|bdt)\)$/, '').replace(/[:.]$/, '');

/** Splits pasted text into cells (tab from Excel, else comma or semicolon). */
export function pasteCells(text: string): string[][] {
  // Excel and Google Sheets copy cells separated by tabs. A sheet that starts with a title line ("Shapla Foods, Sylhet")
  // has no tab on its first line, so a tab anywhere means tabs, whatever the first line says.
  return parseCsv(text, /\t/.test(text) ? '\t' : undefined).rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/** Finds a heading row and maps it; without headings guesses product, box, pcs, cost from left to right. */
export function guessPasteMapping(rows: string[][]): { mapping: PasteMapping; hasHeader: boolean; start: number } {
  // A company's sheet often starts with its name, the invoice number and a blank line: the heading row is the row,
  // among the first ten, that names the most columns. Everything above it is not part of the table.
  let best = { at: -1, hits: 0, mapping: { product: null, box: null, pcs: null, cost: null } as PasteMapping };
  rows.slice(0, 10).forEach((row, at) => {
    const mapping: PasteMapping = { product: null, box: null, pcs: null, cost: null };
    let hits = 0;
    row.forEach((cell, i) => {
      const c = normHead(cell);
      for (const f of PASTE_FIELDS) {
        if (mapping[f] === null && ALIASES[f].includes(c)) {
          mapping[f] = i;
          hits++;
          break;
        }
      }
    });
    // the first row counts with one heading (the old rule); a later row needs two, so a lone word in a title does not win
    if (hits > best.hits && (at === 0 || hits >= 2)) best = { at, hits, mapping };
  });
  if (best.at >= 0) return { mapping: best.mapping, hasHeader: true, start: best.at };
  const n = rows[0]?.length ?? 0;
  return { mapping: { product: n > 0 ? 0 : null, box: n > 1 ? 1 : null, pcs: n > 2 ? 2 : null, cost: n > 3 ? 3 : null }, hasHeader: false, start: 0 };
}

/** SKU (any case), then barcode, then exact English or Bangla name (any case, extra spaces ignored). */
export function makeProductMatcher(products: MatchableProduct[]): (text: string) => number | null {
  const bySku = new Map<string, number>();
  const byCode = new Map<string, number>();
  const byName = new Map<string, number | null>();
  for (const p of products) {
    bySku.set(norm(p.sku), p.id);
    for (const b of p.barcodes) byCode.set(b.trim(), p.id);
    for (const n of [p.name, p.nameBn]) {
      if (!n) continue;
      const k = norm(n);
      // the same name on two products is ambiguous: never guess
      byName.set(k, byName.has(k) && byName.get(k) !== p.id ? null : p.id);
    }
  }
  return (text) => {
    const k = norm(text);
    if (!k) return null;
    return bySku.get(k) ?? byCode.get(text.trim()) ?? byName.get(k) ?? null;
  };
}

const TOTAL_WORDS = /^(sub ?total|grand total|total|net total|net|vat|discount|less|মোট|সর্বমোট|ছাড়)\b/i;

/** `start` is the first row of the table (the heading row when `hasHeader`); rows above it are not read. */
export function readPasteRows(rows: string[][], mapping: PasteMapping, hasHeader: boolean, match: (text: string) => number | null, start = 0): PasteRow[] {
  const cell = (r: string[], f: PasteField): string => (mapping[f] === null ? '' : (r[mapping[f] as number] ?? '').trim());
  const first = start + (hasHeader ? 1 : 0);
  return rows.slice(first).map((r, i) => {
    const problems: PasteProblem[] = [];
    const productText = cell(r, 'product');
    const productId = match(productText);
    if (productId === null) problems.push('noProduct');
    const whole = (f: 'box' | 'pcs', code: PasteProblem): number => {
      const raw = cell(r, f);
      if (raw === '') return 0;
      const v = parseWhole(raw);
      if (v === null || v < 0) {
        problems.push(code);
        return 0;
      }
      return v;
    };
    const box = whole('box', 'badBox');
    const pcs = whole('pcs', 'badPcs');
    const rawCost = cell(r, 'cost');
    let cost: number | null = null;
    if (rawCost !== '') {
      const c = parseTaka(rawCost);
      if (c === null || c < 0) problems.push('badCost');
      else cost = c;
    }
    if (box + pcs === 0 && !problems.includes('badBox') && !problems.includes('badPcs')) problems.push('noQty');
    // a total or note row: no product and no quantity, or a row that starts with "Total" and matches no product
    const anyText = r.find((c) => c.trim() !== '')?.trim() ?? '';
    const ignored = productId === null && ((cell(r, 'box') === '' && cell(r, 'pcs') === '') || TOTAL_WORDS.test(anyText) || TOTAL_WORDS.test(productText));
    return { line: first + i + 1, cells: r, productText, productId, box, pcs, cost, problems, ignored };
  });
}
