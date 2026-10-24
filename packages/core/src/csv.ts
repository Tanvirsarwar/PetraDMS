/** CSV reading and writing plus tolerant parsers for numbers, money, dates and yes/no, shared by the importer and its tests. */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Bangla digits to ASCII, so "১,২৫০" reads as 1,250. */
export function asciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  let best = ',';
  let bestN = 0;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let q = false;
    for (const c of firstLine) {
      if (c === '"') q = !q;
      else if (c === d && !q) n++;
    }
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

export interface ParsedCsv {
  delimiter: string;
  rows: string[][];
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF / LF / CR, a leading byte-order mark, comma / semicolon / tab. Blank lines are dropped. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(field);
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || (row[0] ?? '').trim() !== '' || wasQuoted) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
      wasQuoted = true;
    } else if (c === delimiter) endField();
    else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else if (c === '\n') endRow();
    else field += c;
  }
  if (field !== '' || row.length > 0) endRow();
  return { delimiter, rows };
}

function csvField(s: string): string {
  return /[",\r\n;\t]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Comma separated, CRLF line ends and a byte-order mark so Excel shows Bangla correctly. */
export function writeCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** Spreadsheet programs run text that starts with = + - @ as a formula; keep exported text inert. */
export function inertText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** "৳1,250.5", "Tk 1250", "১২৫০.৫০" to poisha. Null when it is not a plain amount. */
export function parseTaka(raw: string): number | null {
  let s = asciiDigits(raw).trim().replace(/[৳,\s]/g, '').replace(/^(tk\.?|bdt)/i, '').replace(/(tk\.?|bdt|\/-)$/i, '');
  if (s === '') return null;
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const p = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(p) ? sign * p : null;
}

/** A whole number of units (no decimals). */
export function parseWhole(raw: string): number | null {
  const s = asciiDigits(raw).trim().replace(/[,\s]/g, '');
  if (!/^-?\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

const YES = new Set(['1', 'y', 'yes', 'true', 't', 'হ্যাঁ', 'হ্যা', 'হাঁ', 'হ্যাঁ']);
const NO = new Set(['0', 'n', 'no', 'false', 'f', 'না', '']);

export function parseYesNo(raw: string): boolean | null {
  const s = asciiDigits(raw).trim().toLowerCase();
  if (YES.has(s)) return true;
  if (NO.has(s)) return false;
  return null;
}

/** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY or DD.MM.YYYY (day first, as used in Bangladesh) to an ISO date. Null when not a real calendar day. */
export function parseDateLoose(raw: string): string | null {
  const s = asciiDigits(raw).trim();
  let y: number;
  let mo: number;
  let d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  }
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
