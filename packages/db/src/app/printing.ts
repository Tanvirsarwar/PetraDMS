import path from 'node:path';
import { PetraError, renderGrn, renderInvoice, renderPaymentReceipt, renderTableDoc, makeFmt, label, type LabelKey, type PaymentReceiptData, type PrintBusiness, type PrintDoc, type PrintFormat, type PrintOpts, type Role } from '@petra/core';
import { get } from '../sql';
import type { Ctx } from '../ctx';
import { loadSettings } from '../settings';
import { currentBusinessDate, loadLogo, loadProfile } from './coreServices';
import { runReport } from './reportsApp';
import { renderLabels } from './labels';
import { translate } from './exportFiles';
import { getSale } from './salesApp';
import { partyLedger } from './catalog';
import { assertManager, getPurchase } from './inbound';
import type { Host } from './dispatcher';

export function printContext(ctx: Ctx, host: Host, format?: PrintFormat): { biz: PrintBusiness; opts: PrintOpts; format: PrintFormat } {
  const s = loadSettings(ctx.db);
  const p = loadProfile(ctx);
  const f = format ?? s.receiptFormat;
  const prof = get<{ language: string }>(ctx.db, 'SELECT language FROM business_profile WHERE id = 1');
  return {
    format: f,
    biz: { name: p.name, nameBn: p.nameBn, address: p.address, phone: p.phone, taxNo: p.taxNo, footerNote: p.footerNote, logo: loadLogo(ctx) ?? '' },
    opts: { format: f, lang: prof?.language === 'en' ? 'en' : 'bn', bilingual: s.bilingualHeadings, bnDigits: s.bnDigits, grouping: s.grouping, fontCss: host.fontCss() }
  };
}

function paymentData(ctx: Ctx, id: number): PaymentReceiptData {
  const p = get<{ doc_no: string; business_date: string; direction: 'received' | 'given'; party_kind: 'customer' | 'supplier' | 'employee'; party_id: number; amount: number; reference: string; note: string; status: 'posted' | 'void'; account_name: string }>(
    ctx.db, 'SELECT p.*, m.name AS account_name FROM payments p JOIN money_accounts m ON m.id = p.account_id WHERE p.id = ?', id
  );
  if (!p) throw new PetraError('NOT_FOUND', 'payment not found', { what: 'payment' });
  const table = p.party_kind === 'customer' ? 'customers' : p.party_kind === 'supplier' ? 'suppliers' : 'employees';
  const party = get<{ name: string; balance: number }>(ctx.db, `SELECT name, balance FROM ${table} WHERE id = ?`, p.party_id);
  return {
    docNo: p.doc_no, date: p.business_date, direction: p.direction, partyName: party?.name ?? '', partyKind: p.party_kind, amount: p.amount, accountName: p.account_name,
    reference: p.reference, note: p.note, status: p.status, balanceAfter: p.party_kind === 'employee' ? null : (party?.balance ?? null)
  };
}

/** Builds the printable HTML and a file name stem for a document. Staff never get cost or profit here: no template prints them. */
export function buildDoc(ctx: Ctx, host: Host, role: Role, doc: PrintDoc, format?: PrintFormat): { html: string; name: string; format: PrintFormat } {
  const c = printContext(ctx, host, doc.type === 'invoice' || doc.type === 'payment' ? format : 'a4');
  if (doc.type === 'report') {
    const f = makeFmt(c.opts);
    const res = runReport(ctx, role, currentBusinessDate(ctx, loadSettings(ctx.db)), doc.params);
    const show = (kind: string, cell: string | number | null): string => {
      if (cell === null) return '';
      if (typeof cell === 'string') return kind === 'date' ? f.date(cell) : kind === 'stock' ? f.digits(cell) : translate(cell, doc.dict);
      if (kind === 'money') return f.money(cell);
      if (kind === 'pct') return f.digits(`${(cell / 100).toFixed(1)}%`);
      return f.int(cell);
    };
    const right = (kind: string) => kind === 'money' || kind === 'qty' || kind === 'int' || kind === 'pct' || kind === 'days' || kind === 'stock';
    const period = doc.params.from || doc.params.to ? `${doc.params.from ? f.date(doc.params.from) : ''} – ${doc.params.to ? f.date(doc.params.to) : ''}` : '';
    const html = renderTableDoc(
      {
        title: doc.title,
        subtitle: period,
        summary: res.summary.map((x) => [doc.dict[x.labelKey] ?? x.labelKey, show(x.kind, x.value)] as [string, string]),
        columns: res.columns.map((col, i) => ({ header: doc.headers[i] ?? col.key, align: right(col.kind) ? 'r' as const : 'l' as const })),
        rows: res.rows.map((r) => r.map((cell, i) => show(res.columns[i]?.kind ?? 'text', cell))),
        totals: res.totals ? [res.totals.map((cell, i) => show(res.columns[i]?.kind ?? 'text', cell))] : undefined
      },
      c.biz, { ...c.opts, format: 'a4' }
    );
    return { html, name: `${doc.params.id}-${doc.params.to ?? currentBusinessDate(ctx, loadSettings(ctx.db))}`.replace(/[^\w.-]+/g, '_'), format: 'a4' };
  }
  if (doc.type === 'labels') {
    const f = makeFmt(c.opts);
    return { html: renderLabels(ctx, doc.items, { fontCss: c.opts.fontCss, bnDigits: c.opts.bnDigits, money: f.money }), name: 'labels', format: 'a4' };
  }
  if (doc.type === 'invoice') {
    const sale = getSale(ctx, role, doc.id);
    return { html: renderInvoice(sale, c.biz, c.opts), name: sale.docNo, format: c.format };
  }
  if (doc.type === 'purchase') {
    assertManager(role);
    const p = getPurchase(ctx, doc.id);
    return { html: renderGrn(p, c.biz, { ...c.opts, format: 'a4' }), name: `GRN-${p.docNo}`, format: 'a4' };
  }
  if (doc.type === 'payment') {
    const p = paymentData(ctx, doc.id);
    return { html: renderPaymentReceipt(p, c.biz, c.opts), name: p.docNo, format: c.format };
  }
  const f = makeFmt(c.opts);
  const view = partyLedger(ctx, doc.kind, doc.id, doc.from, doc.to);
  const kindLabel = (k: string) => label(`kind_${k}` as LabelKey, c.opts.lang, c.opts.bilingual);
  const known = new Set(['sale', 'purchase', 'payment', 'return', 'adjustment', 'void_reversal', 'opening']);
  const rows = view.rows.map((r) => [
    f.date(r.date),
    `${known.has(r.kind) ? kindLabel(r.kind) : r.kind}${r.refNo ? ` ${r.refNo}` : ''}`,
    r.amount > 0 ? f.money(r.amount) : '',
    r.amount < 0 ? f.money(-r.amount) : '',
    f.money(r.balanceAfter)
  ]);
  const period = doc.from || doc.to ? `${doc.from ? f.date(doc.from) : ''} – ${doc.to ? f.date(doc.to) : ''}` : '';
  const html = renderTableDoc(
    {
      title: `${f.t('statement')}`,
      subtitle: view.party.name,
      summary: [[doc.kind === 'customer' ? f.t('customer') : f.t('supplier'), view.party.name], ...(period ? [[f.t('period'), period] as [string, string]] : []), [f.t('balance'), f.money(view.party.balance)]],
      columns: [{ header: f.t('date') }, { header: f.t('details') }, { header: f.t('billed'), align: 'r' }, { header: f.t('credited'), align: 'r' }, { header: f.t('balance'), align: 'r' }],
      rows,
      totals: [['', f.t('total'), f.money(view.rows.reduce((a, r) => a + Math.max(0, r.amount), 0)), f.money(view.rows.reduce((a, r) => a + Math.max(0, -r.amount), 0)), f.money(view.party.balance)]]
    },
    c.biz, { ...c.opts, format: 'a4' }
  );
  return { html, name: `statement-${view.party.name}`.replace(/[^\w.-]+/g, '_'), format: 'a4' };
}

export async function runPrint(ctx: Ctx, host: Host, role: Role, input: { doc: PrintDoc; format?: PrintFormat; action: 'print' | 'pdf' }): Promise<{ path: string | null }> {
  const { html, name, format } = buildDoc(ctx, host, role, input.doc, input.format);
  const s = loadSettings(ctx.db);
  if (input.action === 'print') {
    await host.printHtml(html, { format, silent: s.printSilently, printerName: s.printerName });
    return { path: null };
  }
  const file = path.join(host.dataDir, input.doc.type === 'report' ? 'exports' : 'invoices', `${name}.pdf`);
  await host.pdfHtml(html, { format, file });
  host.reveal(file);
  return { path: file };
}
