import { formatDate } from '../businessDate';
import { formatInt, formatMoney, toBnDigits } from '../money';
import { label, type LabelKey, type PrintLang } from './labels';
import type { PrintFormat } from '../ipc/sales';
import type { SaleDetail } from '../ipc/sales';
import type { PurchaseDetail } from '../ipc/catalog';
import { formatBoxPcs, groupBoxPcsItems } from '../boxpcs';

export interface PrintBusiness {
  name: string;
  nameBn: string;
  address: string;
  phone: string;
  taxNo: string;
  footerNote: string;
  /** The trader's logo as a data URL (printed in the header), or empty. */
  logo?: string;
}

export interface PrintOpts {
  format: PrintFormat;
  lang: PrintLang;
  bilingual: boolean;
  bnDigits: boolean;
  grouping: 'lakh' | 'intl';
  /** @font-face rules with embedded fonts (so PDFs carry Bangla glyphs). */
  fontCss: string;
}

export const esc = (s: string | number | null | undefined): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Fmt {
  money: (p: number) => string;
  int: (n: number) => string;
  date: (iso: string) => string;
  t: (k: LabelKey) => string;
  digits: (s: string) => string;
}

export function makeFmt(o: PrintOpts): Fmt {
  return {
    money: (p) => formatMoney(p, { grouping: o.grouping, bnDigits: o.bnDigits, symbol: true, fixedDecimals: false }),
    int: (n) => formatInt(n, { grouping: o.grouping, bnDigits: o.bnDigits }),
    date: (iso) => (o.bnDigits ? toBnDigits(formatDate(iso)) : formatDate(iso)),
    t: (k) => label(k, o.lang, o.bilingual),
    digits: (s) => (o.bnDigits ? toBnDigits(s) : s)
  };
}

const BASE_CSS = `
*{box-sizing:border-box}
html{font-synthesis:none}
body{margin:0;font-family:'Nunito','Tiro Bangla','Noto Serif Bengali','Segoe UI','Nirmala UI',sans-serif;color:#0F172A;font-size:12px;line-height:1.45;font-variant-numeric:tabular-nums}
:lang(bn) body,body:lang(bn){line-height:1.7}
h1,h2,h3{margin:0;font-family:'Nunito','Tiro Bangla','Noto Serif Bengali','Nirmala UI',sans-serif;font-weight:600}
td.r,.r .num,.num{font-family:'JetBrains Mono','Tiro Bangla',ui-monospace,monospace}
.logo{max-height:46px;max-width:120px;object-fit:contain;margin-right:10px;vertical-align:middle}
.bizrow{display:flex;align-items:center}
table{border-collapse:collapse;width:100%}
.r{text-align:right}.c{text-align:center}
.muted{color:#555}
.stamp{display:inline-block;border:3px solid #C8202F;color:#C8202F;font-weight:600;letter-spacing:.12em;padding:2px 12px;transform:rotate(-6deg);text-transform:uppercase}
.stamp.paid{border-color:#2E6B43;color:#2E6B43}
.stamp.void{border-color:#555;color:#555}
`;

const A4_CSS = `
@page{size:A4;margin:14mm}
body{font-size:12px}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #14B8A6;padding-bottom:8px;margin-bottom:10px}
.biz h1{font-size:22px;color:#0F172A}
.doc{text-align:right}.doc h2{font-size:18px;text-transform:uppercase;letter-spacing:.06em}
.meta{display:flex;justify-content:space-between;gap:16px;margin:8px 0 12px}
.meta div{flex:1}
.items th{background:#0F172A;color:#fff;padding:5px 6px;text-align:left;font-weight:600}
.items th.r{text-align:right}
.items td{padding:5px 6px;border-bottom:1px solid #ddd;vertical-align:top}
.totals{margin-left:auto;width:55%;margin-top:10px}
.totals td{padding:3px 6px}
.totals tr.grand td{font-size:14px;font-weight:600;border-top:2px solid #0F172A}
.foot{margin-top:18px;border-top:1px solid #aaa;padding-top:6px;display:flex;justify-content:space-between;align-items:flex-end}
`;

const thermalCss = (w: number, fs: number): string => `
@page{size:${w}mm auto;margin:2mm}
body{width:${w - 6}mm;font-size:${fs}px}
.head{text-align:center;border-bottom:1px dashed #000;padding-bottom:4px;margin-bottom:4px}
.biz h1{font-size:${fs + 4}px}
.doc h2{font-size:${fs + 1}px;margin-top:2px;text-transform:uppercase}
.meta div{margin:1px 0}
.items td{padding:1px 0;vertical-align:top}
.items tr.line td{border-top:1px dotted #999;padding-top:3px}
.totals{width:100%;margin-top:4px;border-top:1px dashed #000}
.totals td{padding:1px 0}
.totals tr.grand td{font-weight:600;font-size:${fs + 2}px}
.foot{text-align:center;margin-top:6px;border-top:1px dashed #000;padding-top:4px}
.stamp{font-size:${fs + 2}px;padding:0 6px;border-width:2px}
`;

export function wrapDoc(title: string, body: string, o: PrintOpts): string {
  const css = o.format === 'a4' ? A4_CSS : o.format === 'thermal80' ? thermalCss(80, 11) : thermalCss(58, 10);
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${o.fontCss}${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}

export function businessHeader(b: PrintBusiness, o: PrintOpts, docTitle: string, docNo: string, extra = ''): string {
  const name = o.lang === 'bn' && b.nameBn ? b.nameBn : b.name;
  const sub = o.bilingual && b.nameBn && b.name ? `<div class="muted">${esc(o.lang === 'bn' ? b.name : b.nameBn)}</div>` : '';
  const f = makeFmt(o);
  const logo = b.logo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo) ? `<img class="logo" src="${b.logo}" alt="">` : '';
  return `<div class="head"><div class="biz bizrow">${logo}<div><h1>${esc(name)}</h1>${sub}<div>${esc(b.address)}</div><div>${b.phone ? esc(f.digits(b.phone)) : ''}${b.taxNo ? ` · ${esc(f.t('vatNo'))}: ${esc(b.taxNo)}` : ''}</div></div></div><div class="doc"><h2>${esc(docTitle)}</h2><div>${esc(docNo)}</div>${extra}</div></div>`;
}

export function stampFor(status: 'posted' | 'void', due: number, f: Fmt): string {
  if (status === 'void') return `<span class="stamp void">${esc(f.t('stampVoid'))}</span>`;
  return due > 0 ? `<span class="stamp">${esc(f.t('stampDue'))}</span>` : `<span class="stamp paid">${esc(f.t('stampPaid'))}</span>`;
}


type SaleItem = SaleDetail['items'][number];

/** One printed invoice row: a box line and the loose pieces of the same product that follow it print as "2 Box + 5 pcs". */
export interface InvoiceRow {
  items: SaleItem[];
  kind: 'normal' | 'bonus';
  qtyText: string;
  priceText: string;
  discount: number;
  discText: string;
  amount: number;
}

/** "29 pcs total" / "মোট ২৯ pcs": the base-unit count beside a quantity sold in boxes. */
export function pcsTotalText(qty: string, lang: PrintLang = 'en'): string {
  return lang === 'bn' ? `মোট ${qty}` : `${qty} total`;
}

export function invoiceRows(items: SaleItem[], f: Fmt, lang: PrintLang = 'en'): InvoiceRow[] {
  const pname = (it: SaleItem): string => (lang === 'bn' && it.packNameBn ? it.packNameBn : it.packName);
  return groupBoxPcsItems(items).map((g) => {
    const first = g[0]!;
    // a line sold in boxes also shows its piece count: "2 Box + 5 pcs (29 pcs total)"
    const pcsTotal = first.factor > 1 ? ` (${pcsTotalText(`${f.int(g.reduce((a, it) => a + it.baseQty, 0))} ${first.baseUnit}`, lang)})` : '';
    const qtyText = g.map((it) => `${f.int(it.qty)} ${pname(it)}`).join(' + ') + pcsTotal;
    const priceText = first.kind === 'bonus' ? f.money(0) : g.length === 1 ? f.money(first.price) : g.map((it) => `${f.money(it.price)}/${pname(it)}`).join(' + ');
    const discount = g.reduce((a, it) => a + it.discount, 0);
    const discText = first.kind === 'bonus' || discount <= 0 ? '' : g.every((it) => it.discKind === 'pct') ? f.digits(`${(first.discValue / 100).toFixed(first.discValue % 100 === 0 ? 0 : 2)}%`) : f.money(discount);
    return { items: g, kind: first.kind, qtyText, priceText, discount, discText, amount: g.reduce((a, it) => a + it.amount, 0) };
  });
}

export function renderInvoice(sale: SaleDetail, b: PrintBusiness, o: PrintOpts): string {
  const f = makeFmt(o);
  const thermal = o.format !== 'a4';
  const iname = (it: SaleItem) => (o.lang === 'bn' && it.productNameBn ? it.productNameBn : it.productName) + (it.kind === 'bonus' ? ` (${f.t('bonus')})` : '');
  const customer = sale.customerId ? `${esc(sale.customerName)}${sale.customerPhone ? ` · ${esc(f.digits(sale.customerPhone))}` : ''}` : esc(f.t('walkIn'));
  const rev = sale.revision > 1 ? `<div class="muted">${esc(f.t('revision'))} ${esc(f.int(sale.revision))}</div>` : '';
  const head = businessHeader(b, o, f.t('invoice'), sale.docNo, rev);
  const meta = `<div class="meta"><div><strong>${esc(f.t('customer'))}:</strong> ${customer}${sale.customerAddress ? `<br>${esc(sale.customerAddress)}` : ''}${sale.areaName ? `<br>${esc(f.t('area'))}: ${esc(sale.areaName)}` : ''}</div><div class="${thermal ? '' : 'r'}"><strong>${esc(f.t('date'))}:</strong> ${esc(f.date(sale.date))}</div></div>`;
  const grouped = invoiceRows(sale.items, f, o.lang);
  const rows = thermal
    ? grouped.map((r) => `<tr class="line"><td colspan="2">${esc(iname(r.items[0]!))}</td></tr><tr><td>${esc(r.qtyText)} × ${esc(r.priceText)}${r.discText ? ` −${esc(r.discText)}` : ''}</td><td class="r">${esc(f.money(r.amount))}</td></tr>`).join('')
    : grouped.map((r) => `<tr><td>${esc(iname(r.items[0]!))}</td><td class="r">${esc(r.qtyText)}</td><td class="r">${esc(r.priceText)}</td><td class="r">${esc(r.discText)}</td><td class="r">${esc(f.money(r.amount))}</td></tr>`).join('');
  const table = thermal
    ? `<table class="items"><tbody>${rows}</tbody></table>`
    : `<table class="items"><thead><tr><th>${esc(f.t('item'))}</th><th class="r">${esc(f.t('qty'))}</th><th class="r">${esc(f.t('price'))}</th><th class="r">${esc(f.t('disc'))}</th><th class="r">${esc(f.t('amount'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  const tr = (k: LabelKey, v: string, cls = '') => `<tr class="${cls}"><td>${esc(f.t(k))}</td><td class="r">${esc(v)}</td></tr>`;
  const totals = [
    tr('subtotal', f.money(sale.subtotal)),
    sale.discount > 0 ? tr('discount', `−${f.money(sale.discount)}`) : '',
    sale.tax > 0 ? tr('tax', f.money(sale.tax)) : '',
    sale.roundOff !== 0 ? tr('roundOff', f.money(sale.roundOff)) : '',
    tr('total', f.money(sale.total), 'grand'),
    tr('paid', f.money(sale.paid)),
    sale.due > 0 ? tr('due', f.money(sale.due)) : ''
  ].join('');
  const khata = sale.customerId && sale.previousDue !== null && sale.currentDue !== null
    ? `<table class="totals"><tbody>${tr('previousDue', f.money(sale.previousDue))}${tr('thisInvoice', f.money(sale.total))}${tr('paid', f.money(sale.paid))}${tr('totalDue', f.money(sale.currentDue), 'grand')}</tbody></table>` : '';
  const note = sale.note ? `<p><strong>${esc(f.t('note'))}:</strong> ${esc(sale.note)}</p>` : '';
  const foot = `<div class="foot"><div>${esc(b.footerNote || f.t('thanks'))}</div><div>${stampFor(sale.status, sale.due, f)}</div></div>`;
  return wrapDoc(`${sale.docNo}`, `${head}${meta}${table}<table class="totals"><tbody>${totals}</tbody></table>${khata}${note}${foot}`, o);
}

/** "5 Box + 6 Pcs" for a purchase line (a line of pieces alone shows only pieces). */
export function purchaseQtyText(it: PurchaseDetail['items'][number], bn: boolean, lang: PrintLang = 'en'): string {
  return formatBoxPcs(it.baseQty, it.factor, { boxName: lang === 'bn' && it.packNameBn ? it.packNameBn : it.packName, pcsName: it.baseUnit }, { bn });
}

/** Goods received note (GRN) for a company purchase, A4. Cost is printed: only managers and the owner can print it. */
export function renderGrn(p: PurchaseDetail, b: PrintBusiness, o: PrintOpts): string {
  const f = makeFmt(o);
  const opts = { ...o, format: 'a4' as const };
  const iname = (it: PurchaseDetail['items'][number]) => (o.lang === 'bn' && it.productNameBn ? it.productNameBn : it.productName) + (it.kind === 'free' ? ` (${f.t('free')})` : '');
  const ddisc = (it: PurchaseDetail['items'][number]) => (it.discount <= 0 ? '' : it.discKind === 'pct' ? f.digits(`${(it.discValue / 100).toFixed(it.discValue % 100 === 0 ? 0 : 2)}%`) : f.money(it.discount));
  const head = businessHeader(b, opts, f.t('grn'), p.docNo, p.status === 'void' ? `<div><span class="stamp void">${esc(f.t('stampVoid'))}</span></div>` : '');
  const meta = `<div class="meta"><div><strong>${esc(f.t('supplier'))}:</strong> ${esc(p.supplierName || '-')}${p.supplierRef ? `<br><strong>${esc(f.t('companyInvoice'))}:</strong> ${esc(p.supplierRef)}` : ''}${p.invoiceDate ? `<br><strong>${esc(f.t('invoiceDate'))}:</strong> ${esc(f.date(p.invoiceDate))}` : ''}</div><div class="r"><strong>${esc(f.t('receivedOn'))}:</strong> ${esc(f.date(p.date))}${p.dueDate ? `<br><strong>${esc(f.t('dueDate'))}:</strong> ${esc(f.date(p.dueDate))}` : ''}</div></div>`;
  const rows = p.items.map((it) => `<tr><td>${esc(iname(it))}<div class="muted">${esc(it.sku)}${it.batchNo ? ` · ${esc(f.t('batch'))} ${esc(it.batchNo)}` : ''}${it.expiry ? ` · ${esc(f.t('expiry'))} ${esc(f.date(it.expiry))}` : ''}</div></td><td class="r">${esc(purchaseQtyText(it, o.bnDigits, o.lang))}</td><td class="r">${it.kind === 'free' ? esc(f.money(0)) : `${esc(f.money(it.unitCost))}<div class="muted">/${esc(o.lang === 'bn' && it.packNameBn ? it.packNameBn : it.packName)}</div>`}</td><td class="r">${esc(ddisc(it))}</td><td class="r">${esc(f.money(it.amount))}</td></tr>`).join('');
  const table = `<table class="items"><thead><tr><th>${esc(f.t('item'))}</th><th class="r">${esc(f.t('qty'))}</th><th class="r">${esc(f.t('cost'))}</th><th class="r">${esc(f.t('disc'))}</th><th class="r">${esc(f.t('amount'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  const tr = (k: LabelKey, v: string, cls = '') => `<tr class="${cls}"><td>${esc(f.t(k))}</td><td class="r">${esc(v)}</td></tr>`;
  const totals = [
    tr('lines', f.int(p.items.length)),
    tr('subtotal', f.money(p.subtotal)),
    p.discount > 0 ? tr('discount', `−${f.money(p.discount)}`) : '',
    p.tax > 0 ? tr('charge', f.money(p.tax)) : '',
    p.freight > 0 ? tr('freight', f.money(p.freight)) : '',
    tr('total', f.money(p.total), 'grand'),
    tr('paid', f.money(p.paid)),
    p.due > 0 ? tr('due', f.money(p.due)) : ''
  ].join('');
  const note = p.note ? `<p><strong>${esc(f.t('note'))}:</strong> ${esc(p.note)}</p>` : '';
  const foot = `<div class="foot"><div>${esc(f.t('receivedBy'))}: ____________</div><div>${esc(f.t('checkedBy'))}: ____________</div><div>${p.status === 'void' ? '' : stampFor('posted', p.due, f)}</div></div>`;
  return wrapDoc(p.docNo, `${head}${meta}${table}<table class="totals"><tbody>${totals}</tbody></table>${note}${foot}`, opts);
}

export interface PaymentReceiptData {
  docNo: string;
  date: string;
  direction: 'received' | 'given';
  partyName: string;
  partyKind: 'customer' | 'supplier' | 'employee';
  amount: number;
  accountName: string;
  reference: string;
  note: string;
  status: 'posted' | 'void';
  balanceAfter: number | null;
}

export function renderPaymentReceipt(p: PaymentReceiptData, b: PrintBusiness, o: PrintOpts): string {
  const f = makeFmt(o);
  const title = p.direction === 'received' ? f.t('receipt') : f.t('paymentVoucher');
  const rows = [
    [p.direction === 'received' ? f.t('receivedFrom') : f.t('paidTo'), esc(p.partyName)],
    [f.t('date'), esc(f.date(p.date))],
    [f.t('account'), esc(p.accountName)],
    p.reference ? [f.t('reference'), esc(p.reference)] : null,
    p.balanceAfter !== null ? [f.t('balanceAfter'), esc(f.money(p.balanceAfter))] : null,
    p.note ? [f.t('note'), esc(p.note)] : null
  ].filter((r): r is string[] => r !== null).map((r) => `<tr><td>${r[0]}</td><td class="r">${r[1]}</td></tr>`).join('');
  const body = `${businessHeader(b, o, title, p.docNo)}<table class="totals" style="margin-top:14px"><tbody>${rows}<tr class="grand"><td>${esc(f.t('amount'))}</td><td class="r">${esc(f.money(p.amount))}</td></tr></tbody></table><div class="foot"><div>${esc(b.footerNote || f.t('thanks'))}</div><div>${p.status === 'void' ? `<span class="stamp void">${esc(f.t('stampVoid'))}</span>` : `<span class="stamp paid">${esc(f.t('stampPaid'))}</span>`}</div></div>`;
  return wrapDoc(p.docNo, body, o);
}

export interface TableDoc {
  title: string;
  subtitle?: string;
  /** Summary lines shown above the table, e.g. [["Customer","Rahim"]]. */
  summary?: [string, string][];
  columns: { header: string; align?: 'l' | 'r' }[];
  rows: string[][];
  /** Rows shown bold under the table (totals). */
  totals?: string[][];
}

/** Generic table document used by statements and every report. All cell text is escaped here. */
export function renderTableDoc(doc: TableDoc, b: PrintBusiness, o: PrintOpts): string {
  const f = makeFmt(o);
  const th = doc.columns.map((c) => `<th class="${c.align === 'r' ? 'r' : ''}">${esc(c.header)}</th>`).join('');
  const cell = (c: { align?: 'l' | 'r' }, v: string) => `<td class="${c.align === 'r' ? 'r' : ''}">${esc(v)}</td>`;
  const body = doc.rows.map((r) => `<tr>${r.map((v, i) => cell(doc.columns[i] ?? {}, v)).join('')}</tr>`).join('');
  const tot = (doc.totals ?? []).map((r) => `<tr style="font-weight:600;border-top:2px solid #0F172A">${r.map((v, i) => cell(doc.columns[i] ?? {}, v)).join('')}</tr>`).join('');
  const summary = (doc.summary ?? []).map(([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(v)}</div>`).join('');
  const head = businessHeader(b, o, doc.title, doc.subtitle ?? '');
  return wrapDoc(doc.title, `${head}${summary ? `<div class="meta"><div>${summary}</div></div>` : ''}<table class="items"><thead><tr>${th}</tr></thead><tbody>${body}${tot}</tbody></table><div class="foot"><div class="muted">${esc(f.t('printed'))}: ${esc(f.date(new Date().toISOString().slice(0, 10)))}</div></div>`, o);
}
