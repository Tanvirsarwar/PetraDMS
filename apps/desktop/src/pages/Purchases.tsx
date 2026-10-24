import { useEffect, useMemo, useState } from 'react';
import { useRequest } from '../ui/requestId';
import { useLocation } from 'react-router-dom';
import { formatBoxPcs, joinBoxPcs, mulDiv, type PurchaseDetail, type PurchaseListItem } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Badge, Button, Card, DateRange, Drawer, EmptyState, Field, Input, Modal, MoneyInput, PrintActions, QtyInput, Select, Table, Textarea, monthStart, toast, useDisplayDate, useQuery, type Range } from '../ui';
import { NewPurchase } from './purchases/NewPurchase';
import { PriceUpdateModal } from './purchases/PriceUpdateModal';

export function PurchasesPage() {
  const { t, money, int } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const date = useDisplayDate();
  const [mode, setMode] = useState<'list' | 'new'>('list');
  const [range, setRange] = useState<Range>({ from: monthStart(today), to: today });
  const [q, setQ] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ id: number; docNo: string } | null>(null);
  const [pricesFor, setPricesFor] = useState<{ id: number; docNo: string } | null>(null);
  const loc = useLocation();
  useEffect(() => {
    const st = loc.state as { open?: number } | null;
    if (typeof st?.open === 'number') { setMode('list'); setDetailId(st.open); }
  }, [loc.state, loc.key]);
  const list = useQuery('purchase:list', { from: range.from, to: range.to, ...(q.trim() ? { search: q.trim() } : {}) });
  const total = (list.data ?? []).filter((p) => p.status === 'posted').reduce((a, p) => a + p.total, 0);

  if (mode === 'new') return <NewPurchase onDone={(r) => { setMode('list'); setSaved(r); list.reload(); }} onCancel={() => setMode('list')} />;
  return (
    <div>
      <div className="page-h">
        <h2>{t('nav.purchases')}</h2>
        <Button variant="primary" onClick={() => setMode('new')} data-testid="new-purchase">{t('pur.new')}</Button>
      </div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <DateRange value={range} onChange={setRange} today={today} />
        <Input placeholder={t('pur.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} aria-label={t('act.search')} />
        <span className="spacer" />
        <span>{t('word.total')}: <strong>{money(total)}</strong> · {int(list.data?.length ?? 0)} {t('word.rows')}</span>
      </div>
      {saved && (
        <div className="pur-saved" role="status" data-testid="purchase-saved">
          <span>{t('pur.savedBanner', { doc: saved.docNo })}</span>
          <span className="spacer" />
          <Button size="sm" variant="primary" onClick={() => { setPricesFor(saved); setSaved(null); }} data-testid="prices-open">{t('pur.updatePrices')}</Button>
          <Button size="sm" onClick={() => setDetailId(saved.id)}>{t('pur.openGrn')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSaved(null)} aria-label={t('act.close')}>×</Button>
        </div>
      )}
      {list.error && <div className="p-error" role="alert">{list.error}</div>}
      <Table
        rows={list.data ?? []}
        rowKey={(p) => p.id}
        pageSize={50}
        onRowClick={(p) => setDetailId(p.id)}
        columns={[
          { key: 'doc', header: t('pur.docNo'), render: (p: PurchaseListItem) => <span>{p.docNo} {p.status === 'void' && <Badge tone="warn">{t('state.void')}</Badge>}</span>, sortValue: (p) => p.docNo },
          { key: 'date', header: t('word.date'), render: (p) => date(p.date), sortValue: (p) => p.date },
          { key: 'sup', header: t('nav.suppliers'), render: (p) => p.supplierName || t('pur.cash'), sortValue: (p) => p.supplierName },
          { key: 'ref', header: t('pur.supplierRef'), render: (p) => p.supplierRef },
          { key: 'total', header: t('word.total'), right: true, render: (p) => money(p.total, { fixed: true }), sortValue: (p) => p.total },
          { key: 'paid', header: t('word.paid'), right: true, render: (p) => money(p.paid, { fixed: true }) },
          { key: 'due', header: t('word.due'), right: true, render: (p) => (p.due > 0 ? <Badge tone="red">{money(p.due, { fixed: true })}</Badge> : money(0, { fixed: true })), sortValue: (p) => p.due }
        ]}
        empty={list.loading ? undefined : <EmptyState title={t('pur.emptyTitle')} body={t('pur.emptyBody')} action={<Button variant="primary" onClick={() => setMode('new')}>{t('pur.new')}</Button>} />}
      />
      <PurchaseDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={list.reload} />
      <PriceUpdateModal purchaseId={pricesFor?.id ?? null} docNo={pricesFor?.docNo ?? ''} onClose={() => setPricesFor(null)} />
    </div>
  );
}

function PurchaseDrawer({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const i18n = useI18n();
  const { t, money } = i18n;
  const role = useApp((s) => s.status?.session?.role);
  const date = useDisplayDate();
  const detail = useQuery('purchase:get', { id: id ?? 1 }, id !== null);
  const d: PurchaseDetail | null = id !== null ? detail.data : null;
  const [voidOpen, setVoidOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canVoid = role === 'owner' || role === 'manager';
  return (
    <Drawer wide open={id !== null} title={d ? `${d.docNo}${d.status === 'void' ? ` (${t('state.void')})` : ''}` : ''} onClose={onClose}
      footer={d && d.status === 'posted' && canVoid ? (<><Button onClick={() => setReturnOpen(true)} data-testid="purchase-return">{t('pur.return')}</Button><span className="spacer" /><Button variant="danger" onClick={() => setVoidOpen(true)} data-testid="purchase-void">{t('pur.void')}</Button></>) : undefined}>
      {d && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="grid" style={{ gap: 2 }}>
            <div>{t('pur.receivedOn')}: {date(d.date)} · {d.supplierName || t('pur.cash')} {d.supplierRef && <small className="muted">#{d.supplierRef}</small>}</div>
            {(d.invoiceDate || d.dueDate) && <div className="muted">{d.invoiceDate ? `${t('pur.invoiceDate')}: ${date(d.invoiceDate)}` : ''}{d.invoiceDate && d.dueDate ? ' · ' : ''}{d.dueDate ? `${t('pur.dueDate')}: ${date(d.dueDate)}` : ''}</div>}
            {d.dupReason && <div className="muted">{t('pur.dupReason')}: {d.dupReason}</div>}
            {d.status === 'void' && <div className="p-error">{t('pur.voidReason')}: {d.voidReason}</div>}
          </div>
          <table className="lines" data-testid="purchase-detail-lines">
            <thead><tr><th>{t('word.name')}</th><th className="right">{t('word.qty')}</th><th className="right">{t('pur.costPerBox')}</th><th className="right">{t('word.amount')}</th></tr></thead>
            <tbody>
              {d.items.map((it) => (
                <tr key={it.lineNo}>
                  <td>{it.productName}{it.kind === 'free' && <> <Badge tone="ok">{t('pur.free')}</Badge></>}<br /><small className="muted">{it.sku}{it.batchNo ? ` · ${it.batchNo}` : ''}{it.expiry ? ` · ${date(it.expiry)}` : ''}{it.discount > 0 ? ` · ${t('word.discount')} ${money(it.discount)}` : ''}</small></td>
                  <td className="right num" data-testid={`detail-qty-${it.lineNo}`}>{i18n.n(formatBoxPcs(it.baseQty, it.factor, { boxName: i18n.lang === 'bn' && it.packNameBn ? it.packNameBn : it.packName, pcsName: it.baseUnit }))}</td>
                  <td className="right num">{it.kind === 'free' ? '-' : money(it.unitCost, { fixed: true })}</td>
                  <td className="right num">{money(it.amount, { fixed: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals" style={{ justifySelf: 'end' }}>
            <div className="row"><span>{t('word.subtotal')}</span><span className="num">{money(d.subtotal, { fixed: true })}</span></div>
            {d.discount > 0 && <div className="row"><span>{t('word.discount')}</span><span className="num">−{money(d.discount, { fixed: true })}</span></div>}
            {d.tax > 0 && <div className="row"><span>{t('pur.charge')}</span><span className="num">{money(d.tax, { fixed: true })}</span></div>}
            {d.freight > 0 && <div className="row"><span>{t('pur.freight')}</span><span className="num">{money(d.freight, { fixed: true })}</span></div>}
            <div className="row grand"><span>{t('word.total')}</span><span className="num">{money(d.total, { fixed: true })}</span></div>
            <div className="row"><span>{t('word.paid')}</span><span className="num">{money(d.paid, { fixed: true })}</span></div>
            <div className="row"><span>{t('word.due')}</span><span className="num">{money(d.due, { fixed: true })}</span></div>
          </div>
          <PrintActions doc={{ type: 'purchase', id: d.id }} formats={false} />
          {d.note && <div className="muted">{d.note}</div>}
          {d.returns.length > 0 && (
            <Card title={t('pur.returns')}>
              {d.returns.map((r) => (
                <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{r.docNo} · {date(r.date)} {r.status === 'void' && <Badge tone="warn">{t('state.void')}</Badge>}</span>
                  <span className="row"><span className="num">{money(r.credit, { fixed: true })}</span>{r.status === 'posted' && canVoid && <Button size="sm" onClick={() => void call('purchase:returnVoid', { id: r.id, reason: t('pur.returnVoidReason') }).then(() => { detail.reload(); onChanged(); }, (e: unknown) => setError(errorText(e)))}>{t('act.undo')}</Button>}</span>
                </div>
              ))}
            </Card>
          )}
          {error && <div className="p-error" role="alert">{error}</div>}
        </div>
      )}
      <Modal open={voidOpen} title={t('pur.void')} onClose={() => setVoidOpen(false)} footer={<><Button onClick={() => setVoidOpen(false)}>{t('act.cancel')}</Button><Button variant="danger" disabled={!reason.trim()} data-testid="void-confirm" onClick={() => void call('purchase:void', { id: id!, reason }).then(() => { setVoidOpen(false); setReason(''); toast.ok(t('pur.voided')); detail.reload(); onChanged(); }, (e: unknown) => { setVoidOpen(false); setError(errorText(e)); })}>{t('pur.void')}</Button></>}>
        <Field label={t('word.reason')} required>{(a) => <Textarea id={a.id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="void-reason" data-autofocus />}</Field>
        <p className="muted">{t('pur.voidHelp')}</p>
      </Modal>
      {d && <ReturnModal open={returnOpen} detail={d} onClose={() => setReturnOpen(false)} onDone={() => { setReturnOpen(false); detail.reload(); onChanged(); }} />}
    </Drawer>
  );
}

interface ReturnLine { productId: number; name: string; sku: string; packName: string; baseUnit: string; factor: number; bought: number; returned: number; paidAmount: number; paidQty: number; batchId: number | null }

/** Return to the company in box + pcs, capped at what this purchase brought in minus what was already returned. */
function ReturnModal({ open, detail, onClose, onDone }: { open: boolean; detail: PurchaseDetail; onClose: () => void; onDone: () => void }) {
  const i18n = useI18n();
  const { t, money } = i18n;
  const today = useApp((s) => s.status?.businessDate ?? '');
  const lines = useMemo(() => {
    const m = new Map<number, ReturnLine>();
    for (const it of detail.items) {
      const cur = m.get(it.productId) ?? { productId: it.productId, name: it.productName, sku: it.sku, packName: i18n.lang === 'bn' && it.packNameBn ? it.packNameBn : it.packName, baseUnit: it.baseUnit, factor: it.factor, bought: 0, returned: detail.returnedByProduct.find((r) => r.productId === it.productId)?.baseQty ?? 0, paidAmount: 0, paidQty: 0, batchId: it.batchId };
      cur.bought += it.baseQty;
      if (it.factor > cur.factor) { cur.factor = it.factor; cur.packName = i18n.lang === 'bn' && it.packNameBn ? it.packNameBn : it.packName; }
      if (it.kind === 'normal') { cur.paidAmount += it.amount; cur.paidQty += it.baseQty; }
      m.set(it.productId, cur);
    }
    return [...m.values()];
  }, [detail, i18n.lang]);
  const [box, setBox] = useState<Record<number, number | null>>({});
  const [pcs, setPcs] = useState<Record<number, number | null>>({});
  const [credits, setCredits] = useState<Record<number, number | null | undefined>>({});
  const [mode, setMode] = useState<'due' | 'cash'>(detail.supplierId ? 'due' : 'cash');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const req = useRequest();
  const rows = lines.map((l) => {
    const q = joinBoxPcs(box[l.productId] ?? 0, pcs[l.productId] ?? 0, l.factor);
    const left = l.bought - l.returned;
    const auto = q > 0 && l.paidQty > 0 ? mulDiv(l.paidAmount, Math.min(q, l.paidQty), l.paidQty) : 0;
    const credit = credits[l.productId] !== undefined ? credits[l.productId]! : auto;
    return { l, q, left, credit };
  });
  const active = rows.filter((r) => r.q > 0);
  const totalCredit = active.reduce((a, r) => a + (r.credit ?? 0), 0);
  const valid = active.length > 0 && active.every((r) => r.q <= r.left && r.credit !== null);
  const fmt = (q: number, l: ReturnLine) => i18n.n(formatBoxPcs(q, l.factor, { boxName: l.packName, pcsName: l.baseUnit }));
  return (
    <Modal
      open={open}
      wide
      title={t('pur.return')}
      onClose={onClose}
      footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button variant="primary" disabled={!valid} data-testid="return-save" onClick={() => void req.guard(() => call('purchase:return', { supplierId: detail.supplierId, purchaseId: detail.id, date: today, refundMode: mode, accountId: null, reason, requestId: req.id(), lines: active.map((r) => ({ productId: r.l.productId, baseQty: r.q, credit: r.credit ?? 0, batchId: r.l.batchId })) }).then(() => { req.renew(); toast.ok(t('pur.returned')); onDone(); }, (e: unknown) => setError(errorText(e))))}>{t('pur.return')}</Button></>}
    >
      <div className="grid" style={{ gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>{t('pur.returnHelp')}</p>
        <table className="lines">
          <thead><tr><th>{t('word.name')}</th><th className="right">{t('pur.boughtQty')}</th><th className="right">{t('pur.canReturn')}</th><th className="right" style={{ width: 80 }}>{t('pur.boxQty')}</th><th className="right" style={{ width: 80 }}>{t('pur.pcsQty')}</th><th className="right" style={{ width: 140 }}>{t('pur.credit')}</th></tr></thead>
          <tbody>
            {rows.map(({ l, q, left, credit }) => (
              <tr key={l.productId}>
                <td>{l.name}<br /><small className="muted">{l.sku}</small></td>
                <td className="right num">{fmt(l.bought, l)}</td>
                <td className="right num" data-testid={`return-left-${l.sku}`}>{fmt(left, l)}</td>
                <td><QtyInput aria-label={t('pur.boxQty')} value={box[l.productId] ?? null} disabled={l.factor === 1} invalid={q > left} onChange={(v) => { setBox((x) => ({ ...x, [l.productId]: v })); setCredits((c) => ({ ...c, [l.productId]: undefined })); }} data-testid={`return-box-${l.sku}`} /></td>
                <td><QtyInput aria-label={t('pur.pcsQty')} value={pcs[l.productId] ?? null} invalid={q > left} onChange={(v) => { setPcs((x) => ({ ...x, [l.productId]: v })); setCredits((c) => ({ ...c, [l.productId]: undefined })); }} data-testid={`return-pcs-${l.sku}`} /></td>
                <td><MoneyInput aria-label={t('pur.credit')} value={credit} onChange={(v) => setCredits((c) => ({ ...c, [l.productId]: v }))} data-testid={`return-credit-${l.sku}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.some((r) => r.q > r.left) && <div className="p-error" role="alert">{t('pur.returnTooMuch')}</div>}
        <div className="form-grid">
          <Field label={t('pur.refund')}>
            {(a) => (
              <Select id={a.id} value={mode} onChange={(e) => setMode(e.target.value as 'due' | 'cash')}>
                {detail.supplierId && <option value="due">{t('pur.refundDue')}</option>}
                <option value="cash">{t('pur.refundCash')}</option>
              </Select>
            )}
          </Field>
          <div className="row" style={{ alignSelf: 'end', justifyContent: 'flex-end' }}><strong data-testid="return-credit-total">{t('pur.credit')}: {money(totalCredit, { fixed: true })}</strong></div>
        </div>
        <Field label={t('word.reason')}>{(a) => <Input id={a.id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {error && <div className="p-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
