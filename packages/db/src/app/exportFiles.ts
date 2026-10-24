import { deflateRawSync } from 'node:zlib';
import type { ReportCell, ReportCol, ReportResult } from '@petra/core';

// ===== ZIP writer (deflate) =====
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array | string; date?: Date; /** Keep the bytes as they are (databases do not shrink enough to be worth the time). */ store?: boolean }

/** Minimal ZIP: one deflated entry per file, UTF-8 names. Enough for XLSX packages and "export everything". */
export function makeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data);
    const packed = e.store ? raw : deflateRawSync(raw);
    const method = e.store ? 0 : 8;
    const name = Buffer.from(e.name, 'utf8');
    const d = e.date ?? new Date(Date.UTC(2026, 0, 1));
    const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
    const day = (Math.max(0, d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(day, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(day, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

// ===== Cells =====
export type Dict = Record<string, string>;

/** `@key` cells and `key` columns hold i18n keys. */
export function translate(cell: ReportCell, dict: Dict): string {
  if (cell === null) return '';
  const s = String(cell);
  return s.startsWith('@') ? (dict[s.slice(1)] ?? s.slice(1)) : (dict[s] ?? s);
}

const isKey = (c: ReportCol, cell: ReportCell) => c.kind === 'key' || (typeof cell === 'string' && cell.startsWith('@'));

function plain(c: ReportCol, cell: ReportCell, dict: Dict): string {
  if (cell === null) return '';
  if (typeof cell === 'string') return isKey(c, cell) ? translate(cell, dict) : cell;
  if (c.kind === 'money') return (cell / 100).toFixed(2);
  if (c.kind === 'pct') return (cell / 100).toFixed(2);
  return String(cell);
}

/** A spreadsheet program treats =, +, - and @ at the start of text as a formula. Prefix those so a customer called "=cmd" stays text. */
export function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// ===== CSV =====
function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 with a byte-order mark so Excel opens Bangla text correctly; CRLF line ends; money as plain taka with two decimals. */
export function reportCsv(r: ReportResult, headers: string[], dict: Dict): string {
  const lines: string[] = [];
  lines.push(headers.map(csvField).join(','));
  const row = (cells: ReportCell[]) =>
    r.columns.map((c, i) => {
      const cell = cells[i] ?? null;
      const s = plain(c, cell, dict);
      return csvField(typeof cell === 'string' && !isKey(c, cell) ? safeText(s) : s);
    }).join(',');
  for (const cells of r.rows) lines.push(row(cells));
  if (r.totals) lines.push(row(r.totals));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ===== XLSX =====
// eslint-disable-next-line no-control-regex
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function serial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// style ids: 0 normal, 1 bold header, 2 money, 3 date, 4 percent, 5 bold money (totals), 6 bold text, 7 integer
export function reportXlsx(r: ReportResult, title: string, headers: string[], dict: Dict): Buffer {
  const cellXml = (ref: string, c: ReportCol, cell: ReportCell, bold: boolean): string => {
    if (cell === null) return bold ? `<c r="${ref}" s="6"/>` : '';
    if (typeof cell === 'number') {
      if (c.kind === 'money') return `<c r="${ref}" s="${bold ? 5 : 2}"><v>${(cell / 100).toFixed(2)}</v></c>`;
      if (c.kind === 'pct') return `<c r="${ref}" s="4"><v>${cell / 10000}</v></c>`;
      return `<c r="${ref}" s="${bold ? 6 : 7}"><v>${cell}</v></c>`;
    }
    if (c.kind === 'date') {
      const n = serial(cell);
      if (n !== null) return `<c r="${ref}" s="3"><v>${n}</v></c>`;
    }
    const text = isKey(c, cell) ? translate(cell, dict) : safeText(cell);
    return text === '' ? '' : `<c r="${ref}" s="${bold ? 6 : 0}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  };
  const rows: string[] = [];
  rows.push(`<row r="1">${headers.map((h, i) => `<c r="${colName(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(h)}</t></is></c>`).join('')}</row>`);
  let n = 2;
  for (const cells of r.rows) {
    rows.push(`<row r="${n}">${r.columns.map((c, i) => cellXml(`${colName(i)}${n}`, c, cells[i] ?? null, false)).join('')}</row>`);
    n++;
  }
  if (r.totals) rows.push(`<row r="${n}">${r.columns.map((c, i) => cellXml(`${colName(i)}${n}`, c, r.totals![i] ?? null, true)).join('')}</row>`);
  const widths = r.columns.map((c, i) => {
    const longest = Math.max((headers[i] ?? '').length, ...r.rows.slice(0, 200).map((row) => plain(c, row[i] ?? null, dict).length));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(48, Math.max(10, longest + 2))}" customWidth="1"/>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const sheetName = esc(title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ]);
}
