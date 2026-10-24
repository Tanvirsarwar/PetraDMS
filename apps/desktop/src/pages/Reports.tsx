import { useMemo, useState } from 'react';
import { STAFF_REPORTS, type ReportCell, type ReportCol, type ReportId, type ReportParams, type ReportResult } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Badge, Button, Card, DateInput, DateRange, EmptyState, Field, Segmented, Select, Table, monthStart, toast, useDisplayDate, useQuery, type Column, type Range } from '../ui';

type Need = 'range' | 'groupBy' | 'area' | 'asOf' | 'party' | 'product' | 'soon' | 'account';
const DEFS: { group: 'sales' | 'dues' | 'stock' | 'money'; id: ReportId; needs: Need[] }[] = [
  { group: 'sales', id: 'summary', needs: ['range'] },
  { group: 'sales', id: 'sales', needs: ['range', 'groupBy'] },
  { group: 'sales', id: 'profitProduct', needs: ['range'] },
  { group: 'sales', id: 'profitCustomer', needs: ['range'] },
  { group: 'sales', id: 'purchases', needs: ['range'] },
  { group: 'dues', id: 'aging', needs: ['asOf', 'area'] },
  { group: 'dues', id: 'collection', needs: ['area'] },
  { group: 'dues', id: 'statement', needs: ['party', 'range'] },
  { group: 'dues', id: 'supplierDue', needs: [] },
  { group: 'stock', id: 'stockValue', needs: [] },
  { group: 'stock', id: 'lowStock', needs: [] },
  { group: 'stock', id: 'expiring', needs: ['soon'] },
  { group: 'stock', id: 'stockLedger', needs: ['product', 'range'] },
  { group: 'money', id: 'cashbook', needs: ['range', 'account'] },
  { group: 'money', id: 'dayclose', needs: ['range'] },
  { group: 'money', id: 'expenses', needs: ['range', 'account'] },
  { group: 'money', id: 'salary', needs: ['range'] }
];
const GROUPS = ['sales', 'dues', 'stock', 'money'] as const;

export function ReportsPage() {
  const { t, money, int, n, lang } = useI18n();
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const today = useApp((s) => s.status?.businessDate ?? '');
  const date = useDisplayDate();
  const staff = role === 'staff';
  const defs = DEFS.filter((d) => !staff || STAFF_REPORTS.includes(d.id));
  const [id, setId] = useState<ReportId>(defs[0]?.id ?? 'summary');
  const [range, setRange] = useState<Range>({ from: monthStart(today), to: today });
  const [groupBy, setGroupBy] = useState<'product' | 'customer' | 'area' | 'date'>('date');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(today);
  const [partyKind, setPartyKind] = useState<'customer' | 'supplier'>('customer');
  const [partyId, setPartyId] = useState<number | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [soon, setSoon] = useState(60);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const def = defs.find((d) => d.id === id) ?? defs[0]!;
  const need = (k: Need) => def.needs.includes(k);

  const areas = useQuery('area:list', undefined, need('area'));
  const customers = useQuery('customer:list', { includeArchived: true }, need('party') && partyKind === 'customer');
  const suppliers = useQuery('catalog:suppliers', { includeArchived: true }, need('party') && partyKind === 'supplier' && !staff);
  const products = useQuery('catalog:products', { includeArchived: true }, need('product'));
  const accounts = useQuery('money:accounts', undefined, need('account'));

  const params: ReportParams = useMemo(() => {
    const p: ReportParams = { id: def.id };
    if (need('range') && !staff) { p.from = range.from; p.to = range.to; }
    if (need('groupBy')) p.groupBy = groupBy;
    if (need('area') && areaId) p.areaId = areaId;
    if (need('asOf') && asOf) p.asOf = asOf;
    if (need('party') && partyId) { if (partyKind === 'customer') p.customerId = partyId; else p.supplierId = partyId; }
    if (need('product') && productId) p.productId = productId;
    if (need('soon')) p.soonDays = soon;
    if (need('account') && accountId) p.accountId = accountId;
    return p;
  }, [def.id, range, groupBy, areaId, asOf, partyKind, partyId, productId, soon, accountId, staff]);
  const ready = !(need('party') && !partyId) && !(need('product') && !productId);
  const res = useQuery('report:run', params, ready);
  const r = res.data;

  const show = (c: ReportCol, cell: ReportCell): string => {
    if (cell === null) return '';
    if (typeof cell === 'string') {
      if (cell.startsWith('@')) return t(cell.slice(1));
      if (c.kind === 'key') return t(cell);
      return c.kind === 'date' ? date(cell) : c.kind === 'stock' ? n(cell) : cell;
    }
    if (c.kind === 'money') return money(cell, { fixed: true });
    if (c.kind === 'pct') return `${n(Math.round(cell / 10) / 10)}%`;
    return int(cell);
  };
  const cols: Column<ReportCell[]>[] = (r?.columns ?? []).map((c, i) => ({
    key: c.key,
    header: t(c.labelKey),
    right: c.kind === 'money' || c.kind === 'qty' || c.kind === 'int' || c.kind === 'pct' || c.kind === 'days' || c.kind === 'stock',
    render: (row) => show(c, row[i] ?? null),
    sortValue: (row) => { const v = row[i] ?? null; return v === null ? '' : typeof v === 'number' ? v : v.toLowerCase(); },
    ...(r?.totals ? { footer: <strong>{i === 0 ? t('word.total') : show(c, r.totals[i] ?? null)}</strong> } : {})
  }));

  const exportBits = (x: ReportResult) => {
    const dict: Record<string, string> = {};
    const keyCell = (c: ReportCol, v: ReportCell) => {
      if (typeof v === 'string' && (v.startsWith('@') || c.kind === 'key')) { const k = v.startsWith('@') ? v.slice(1) : v; dict[k] = t(k); }
    };
    x.rows.forEach((row) => row.forEach((v, i) => keyCell(x.columns[i] as ReportCol, v)));
    x.summary.forEach((s) => { dict[s.labelKey] = t(s.labelKey); });
    x.columns.forEach((c) => { dict[c.labelKey] = t(c.labelKey); });
    return { params, title: t(x.titleKey), headers: x.columns.map((c) => t(c.labelKey)), dict };
  };
  const doExport = async (format: 'csv' | 'xlsx') => {
    if (!r) return;
    setBusy(true);
    try {
      const out = await call('report:export', { ...exportBits(r), format });
      toast.ok(`${t('rep.saved')}: ${out.path}`);
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const doPrint = async (action: 'print' | 'pdf') => {
    if (!r) return;
    setBusy(true);
    try {
      const b = exportBits(r);
      const out = await call('print:run', { doc: { type: 'report', ...b }, action });
      toast.ok(action === 'pdf' ? `${t('print.saved')}: ${out.path ?? ''}` : t('print.sent'));
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };

  const partyOptions = partyKind === 'customer' ? (customers.data ?? []).map((c) => ({ id: c.id, name: c.name })) : (suppliers.data ?? []).map((c) => ({ id: c.id, name: c.name }));
  return (
    <div>
      <div className="page-h"><h2>{t('nav.reports')}</h2></div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <Select aria-label={t('rep.pick')} value={id} onChange={(e) => setId(e.target.value as ReportId)} style={{ maxWidth: 300 }} data-testid="report-pick">
          {GROUPS.map((g) => {
            const list = defs.filter((d) => d.group === g);
            return list.length === 0 ? null : <optgroup key={g} label={t(`rep.group.${g}`)}>{list.map((d) => <option key={d.id} value={d.id}>{t(`rep.title.${d.id}`)}</option>)}</optgroup>;
          })}
        </Select>
        {need('range') && !staff && <DateRange value={range} onChange={setRange} today={today} />}
        {need('groupBy') && (
          <Segmented label={t('rep.groupBy')} value={groupBy} onChange={setGroupBy} options={[{ value: 'date', label: t('rep.by.date') }, { value: 'product', label: t('rep.by.product') }, { value: 'customer', label: t('rep.by.customer') }, { value: 'area', label: t('rep.by.area') }]} />
        )}
        {need('asOf') && <Field label={t('rep.asOfDate')}>{(a) => <DateInput id={a.id} value={asOf} onChange={setAsOf} />}</Field>}
        {need('area') && (
          <Select aria-label={t('word.area')} value={areaId ?? ''} onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 220 }} data-testid="report-area">
            <option value="">{t('word.area')}: {t('state.all')}</option>
            {(areas.data ?? []).map((a) => <option key={a.id} value={a.id}>{lang === 'bn' && a.nameBn ? a.nameBn : a.name}</option>)}
          </Select>
        )}
        {need('party') && (
          <>
            {!staff && <Segmented label={t('rep.party')} value={partyKind} onChange={(v) => { setPartyKind(v); setPartyId(null); }} options={[{ value: 'customer', label: t('nav.customers') }, { value: 'supplier', label: t('nav.suppliers') }]} />}
            <Select aria-label={t('rep.chooseParty')} value={partyId ?? ''} onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 260 }} data-testid="report-party">
              <option value="">{t('rep.chooseParty')}</option>
              {partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </>
        )}
        {need('product') && (
          <Select aria-label={t('rep.chooseProduct')} value={productId ?? ''} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 280 }} data-testid="report-product">
            <option value="">{t('rep.chooseProduct')}</option>
            {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        {need('soon') && (
          <Select aria-label={t('rep.within')} value={soon} onChange={(e) => setSoon(Number(e.target.value))} style={{ maxWidth: 200 }}>
            {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{t('rep.withinDays', { n: int(d) })}</option>)}
          </Select>
        )}
        {need('account') && (
          <Select aria-label={t('pay.account')} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 220 }}>
            <option value="">{t('pay.account')}: {t('state.all')}</option>
            {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        )}
        <span className="spacer" />
        <Button disabled={!r || busy} onClick={() => void doPrint('print')} data-testid="report-print">{t('act.print')}</Button>
        <Button disabled={!r || busy} onClick={() => void doPrint('pdf')} data-testid="report-pdf">{t('act.saveAsPdf')}</Button>
        {!staff && <Button disabled={!r || busy} onClick={() => void doExport('csv')} data-testid="report-csv">CSV</Button>}
        {!staff && <Button disabled={!r || busy} onClick={() => void doExport('xlsx')} data-testid="report-xlsx">Excel</Button>}
      </div>
      {staff && <p className="muted" style={{ marginTop: 0 }}>{t('rep.staffToday')}</p>}
      {res.error && <div className="p-error" role="alert">{res.error}</div>}
      {r && r.summary.length > 0 && (
        <div className="row wrap" style={{ gap: 16, marginBottom: 8 }} data-testid="report-summary">
          {r.summary.map((s) => <span key={s.labelKey}>{t(s.labelKey)}: <strong>{show({ key: 's', labelKey: '', kind: s.kind }, s.value)}</strong></span>)}
        </div>
      )}
      <Card flat>
        {!ready ? <EmptyState title={t('rep.needTitle')} body={need('party') ? t('rep.needParty') : t('rep.needProduct')} /> : (
          <Table rows={r?.rows ?? []} rowKey={(row) => row.map(String).join('|')} columns={cols} pageSize={100} empty={res.loading ? undefined : <EmptyState title={t('rep.emptyTitle')} body={t('rep.emptyBody')} />} />
        )}
      </Card>
      {r && <p className="muted" data-testid="report-count">{int(r.rows.length)} {t('word.rows')} {r.totals && <Badge tone="dark">{t(r.titleKey)}</Badge>}</p>}
    </div>
  );
}
