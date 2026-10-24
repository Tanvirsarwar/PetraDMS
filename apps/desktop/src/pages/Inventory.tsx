import { useState } from 'react';
import { useRequest } from '../ui/requestId';
import type { AdjustmentListItem, BatchDto, ProductDto, StockMovementRow } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Badge, Button, DateInput, DateRange, EmptyState, Field, Input, Modal, MoneyInput, ProductPicker, QtyInput, Select, Stat, Table, Tabs, Textarea, boxPcsText, monthStart, packLabel, productName, stockText, toast, useDisplayDate, useQuery, type Range } from '../ui';

type Tab = 'stock' | 'batches' | 'movements' | 'adjustments';

export function InventoryPage() {
  const { t } = useI18n();
  const role = useApp((s) => s.status?.session?.role);
  const manager = role === 'owner' || role === 'manager';
  const [tab, setTab] = useState<Tab>('stock');
  const tabs: { value: Tab; label: string }[] = [
    { value: 'stock', label: t('inv.tabStock') },
    { value: 'batches', label: t('inv.tabBatches') },
    ...(manager ? [{ value: 'movements' as Tab, label: t('inv.tabMovements') }, { value: 'adjustments' as Tab, label: t('inv.tabAdjustments') }] : [])
  ];
  return (
    <div>
      <div className="page-h"><h2>{t('nav.inventory')}</h2></div>
      <Tabs value={tab} tabs={tabs} onChange={setTab} label={t('nav.inventory')} />
      <div style={{ marginTop: 12 }}>
        {tab === 'stock' && <StockTab manager={manager} />}
        {tab === 'batches' && <BatchesTab />}
        {tab === 'movements' && manager && <MovementsTab />}
        {tab === 'adjustments' && manager && <AdjustmentsTab />}
      </div>
    </div>
  );
}

function StockTab({ manager }: { manager: boolean }) {
  const i18n = useI18n();
  const { t, money, int } = i18n;
  const products = useQuery('catalog:products', { includeArchived: false });
  const alerts = useQuery('stock:alerts', { soonDays: 30 });
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const rows = (products.data ?? []).filter((p) => {
    if (lowOnly && !(p.reorderLevel > 0 && p.stockQty <= p.reorderLevel)) return false;
    const s = q.trim().toLowerCase();
    return !s || p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || p.nameBn.includes(s);
  });
  const value = (products.data ?? []).reduce((a, p) => a + (p.stockValue ?? 0), 0);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Stat label={t('inv.items')} value={int(products.data?.length ?? 0)} />
        <Stat label={t('inv.lowCount')} value={int(alerts.data?.low.length ?? 0)} accent={(alerts.data?.low.length ?? 0) > 0} />
        <Stat label={t('inv.expiringCount')} value={int(alerts.data?.expiring.length ?? 0)} />
        <Stat label={t('inv.expiredCount')} value={int(alerts.data?.expired.length ?? 0)} accent={(alerts.data?.expired.length ?? 0) > 0} />
        {manager && <Stat label={t('prod.stockValue')} value={money(value)} />}
      </div>
      <div className="p-toolbar">
        <Input placeholder={t('prod.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} aria-label={t('act.search')} data-testid="stock-search" />
        <label className="row"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> {t('prod.low')}</label>
      </div>
      <Table
        rows={rows}
        rowKey={(p) => p.id}
        pageSize={100}
        columns={[
          { key: 'sku', header: t('prod.sku'), render: (p: ProductDto) => p.sku, sortValue: (p) => p.sku },
          { key: 'name', header: t('word.name'), render: (p) => productName(i18n.lang, p), sortValue: (p) => p.name },
          { key: 'stock', header: t('nav.stock'), right: true, render: (p) => <span data-testid={`stock-${p.sku}`}>{stockText(i18n, p, p.stockQty)}</span>, sortValue: (p) => p.stockQty },
          { key: 'low', header: '', render: (p) => (p.reorderLevel > 0 && p.stockQty <= p.reorderLevel ? <Badge tone="red">{t('prod.low')}</Badge> : null) },
          ...(manager ? [{ key: 'val', header: t('prod.stockValue'), right: true, render: (p: ProductDto) => money(p.stockValue ?? 0, { fixed: true }), sortValue: (p: ProductDto) => p.stockValue ?? 0 }] : [])
        ]}
        empty={products.loading ? undefined : <EmptyState title={t('prod.emptyTitle')} body={t('prod.emptyBody')} />}
      />
    </div>
  );
}

function BatchesTab() {
  const { t, int } = useI18n();
  const date = useDisplayDate();
  const batches = useQuery('stock:batches', { includeEmpty: false });
  const rows = (batches.data ?? []).filter((b) => b.expiry !== null);
  const tone = (b: BatchDto) => (b.state === 'expired' ? 'red' : b.state === 'soon' ? 'warn' : 'ok');
  return (
    <Table
      rows={rows}
      rowKey={(b) => b.id}
      pageSize={100}
      columns={[
        { key: 'sku', header: t('prod.sku'), render: (b: BatchDto) => b.sku, sortValue: (b) => b.sku },
        { key: 'name', header: t('word.name'), render: (b) => b.productName },
        { key: 'batch', header: t('pur.batchNo'), render: (b) => b.batchNo || '-' },
        { key: 'exp', header: t('inv.expiry'), render: (b) => (b.expiry ? date(b.expiry) : '-'), sortValue: (b) => b.expiry ?? '' },
        { key: 'qty', header: t('word.qty'), right: true, render: (b) => int(b.qty), sortValue: (b) => b.qty },
        { key: 'state', header: t('word.status'), render: (b) => <Badge tone={tone(b)}>{b.state === 'expired' ? t('inv.expired') : b.state === 'soon' ? t('inv.soon', { days: b.daysToExpiry ?? 0 }) : t('inv.ok')}</Badge> }
      ]}
      empty={batches.loading ? undefined : <EmptyState title={t('inv.noBatches')} body={t('inv.noBatchesBody')} />}
    />
  );
}

function MovementsTab() {
  const i18n = useI18n();
  const { t, int, money } = i18n;
  const today = useApp((s) => s.status?.businessDate ?? '');
  const date = useDisplayDate();
  const products = useQuery('catalog:products', { includeArchived: true });
  const [productId, setProductId] = useState<number | null>(null);
  const [range, setRange] = useState<Range>({ from: monthStart(today), to: today });
  const mv = useQuery('stock:movements', { productId: productId ?? 1, from: range.from, to: range.to, limit: 500 }, productId !== null);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="p-toolbar">
        <div style={{ width: 320 }}><ProductPicker products={products.data ?? []} onPick={(p) => setProductId(p.id)} placeholder={t('inv.pickProduct')} resetOnPick={false} /></div>
        <DateRange value={range} onChange={setRange} today={today} />
      </div>
      {productId === null ? <EmptyState title={t('inv.pickProduct')} /> : (
        <Table
          rows={mv.data ?? []}
          rowKey={(m) => m.id}
          pageSize={100}
          columns={[
            { key: 'date', header: t('word.date'), render: (m: StockMovementRow) => date(m.date) },
            { key: 'kind', header: t('word.type'), render: (m) => <span>{t(`mv.${m.kind}`)}{m.reversal && <Badge tone="warn">{t('state.void')}</Badge>}</span> },
            { key: 'ref', header: t('inv.ref'), render: (m) => m.refNo },
            { key: 'qty', header: t('word.qty'), right: true, render: (m) => (m.baseQty > 0 ? '+' : '') + int(m.baseQty) },
            { key: 'bal', header: t('inv.balance'), right: true, render: (m) => int(m.balanceQty) },
            { key: 'val', header: t('word.amount'), right: true, render: (m) => (m.value === null ? '' : money(m.value, { fixed: true })) }
          ]}
          empty={mv.loading ? undefined : <EmptyState title={t('inv.noMovements')} />}
        />
      )}
    </div>
  );
}

function AdjustmentsTab() {
  const { t, int, money } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const date = useDisplayDate();
  const [range, setRange] = useState<Range>({ from: monthStart(today), to: today });
  const list = useQuery('stock:adjustments', { from: range.from, to: range.to });
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState<AdjustmentListItem | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="p-toolbar">
        <DateRange value={range} onChange={setRange} today={today} />
        <span className="spacer" />
        <Button variant="primary" onClick={() => setOpen(true)} data-testid="new-adjustment">{t('inv.newAdjustment')}</Button>
      </div>
      {error && <div className="p-error" role="alert">{error}</div>}
      <Table
        rows={list.data ?? []}
        rowKey={(a) => a.id}
        pageSize={100}
        columns={[
          { key: 'doc', header: t('pur.docNo'), render: (a: AdjustmentListItem) => <span>{a.docNo} {a.status === 'void' && <Badge tone="warn">{t('state.void')}</Badge>}</span> },
          { key: 'date', header: t('word.date'), render: (a) => date(a.date) },
          { key: 'prod', header: t('word.name'), render: (a) => `${a.sku} ${a.productName}` },
          { key: 'kind', header: t('word.type'), render: (a) => t(`mv.${a.kind}`) },
          { key: 'qty', header: t('word.qty'), right: true, render: (a) => (a.baseQty > 0 ? '+' : '') + int(a.baseQty) },
          { key: 'val', header: t('word.amount'), right: true, render: (a) => (a.value === null ? '' : money(a.value, { fixed: true })) },
          { key: 'reason', header: t('word.reason'), render: (a) => a.reason },
          { key: 'act', header: '', render: (a) => (a.status === 'posted' ? <Button size="sm" onClick={() => { setVoiding(a); setReason(''); }}>{t('act.undo')}</Button> : null) }
        ]}
        empty={list.loading ? undefined : <EmptyState title={t('inv.noAdjustments')} />}
      />
      <AdjustModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); list.reload(); }} />
      <Modal open={voiding !== null} title={t('inv.voidAdjustment')} onClose={() => setVoiding(null)} footer={<><Button onClick={() => setVoiding(null)}>{t('act.cancel')}</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => void call('stock:adjustVoid', { id: voiding!.id, reason }).then(() => { setVoiding(null); toast.ok(t('pur.voided')); list.reload(); }, (e: unknown) => { setVoiding(null); setError(errorText(e)); })}>{t('act.undo')}</Button></>}>
        <Field label={t('word.reason')} required>{(a) => <Textarea id={a.id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Modal>
    </div>
  );
}

const KINDS = ['opening', 'adjust_in', 'adjust_out', 'damage', 'expired', 'internal_use'] as const;

function AdjustModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const today = useApp((s) => s.status?.businessDate ?? '');
  const products = useQuery('catalog:products', { includeArchived: false });
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('adjust_in');
  /** Loose pieces (base units). With a box pack, the boxes are added on top: base = boxes * size + pieces. */
  const [qty, setQty] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<number | null>(null);
  const [packId, setPackId] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(today);
  const [value, setValue] = useState<number | null>(null);
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const req = useRequest();
  const incoming = kind === 'opening' || kind === 'adjust_in';
  const needsExpiry = incoming && product?.trackExpiry === true;
  const boxPacks = (product?.packs ?? []).filter((k) => k.factor > 1).sort((a, b) => b.factor - a.factor);
  const pack = boxPacks.find((k) => k.id === packId) ?? boxPacks[0] ?? null;
  const baseQty = (pack ? (boxes ?? 0) * pack.factor : 0) + (qty ?? 0);
  const pick = (p: ProductDto | null) => { setProduct(p); setBoxes(null); setQty(null); setPackId(p?.packs.filter((k) => k.factor > 1).sort((a, b) => b.factor - a.factor)[0]?.id ?? null); };
  const valid = product !== null && baseQty > 0 && date !== null && (!needsExpiry || expiry !== null) && reason.trim() !== '';
  const save = (): Promise<void> => {
    if (!valid || !product) return Promise.resolve();
    return req.guard(saveOnce).then(() => undefined);
  };
  const saveOnce = async () => {
    if (!product) return;
    try {
      await call('stock:adjust', {
        productId: product.id, kind, baseQty, date: date!, reason, requestId: req.id(),
        ...(incoming && value !== null ? { value } : {}),
        ...(needsExpiry ? { batch: { batchNo, expiry } } : {})
      });
      req.renew();
      toast.ok(t('inv.adjusted'));
      pick(null); setValue(null); setReason(''); setError(null);
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal open={open} title={t('inv.newAdjustment')} onClose={onClose} footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button variant="primary" disabled={!valid} onClick={() => void save()} data-testid="adjust-save">{t('act.save')}</Button></>}>
      <div className="grid" style={{ gap: 12 }}>
        <Field label={t('word.name')} required>
          {(a) => product ? (
            <div className="row"><strong>{productName(i18n.lang, product)}</strong> <small className="muted">{t('nav.stock')}: {stockText(i18n, product, product.stockQty)}</small> <Button size="sm" variant="ghost" onClick={() => pick(null)}>×</Button></div>
          ) : <ProductPicker id={a.id} products={products.data ?? []} onPick={pick} autoFocus />}
        </Field>
        <div className="form-grid">
          <Field label={t('word.type')}>{(a) => <Select id={a.id} value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} data-testid="adjust-kind">{KINDS.map((k) => <option key={k} value={k}>{t(`mv.${k}`)}</option>)}</Select>}</Field>
          {pack && (
            <Field label={t('pur.boxQty')} hint={t('prod.packEquals', { pack: packLabel(i18n, pack), qty: i18n.n(pack.factor), unit: product?.baseUnit ?? '' })}>
              {(a) => (
                <div className="row" style={{ gap: 6 }}>
                  <QtyInput id={a.id} aria-describedby={a.describedBy} value={boxes} onChange={setBoxes} data-testid="adjust-box" />
                  {boxPacks.length > 1 && <Select aria-label={t('pur.pack')} value={pack.id} onChange={(e) => setPackId(Number(e.target.value))} style={{ maxWidth: 140 }} data-testid="adjust-pack">{boxPacks.map((k) => <option key={k.id} value={k.id}>{packLabel(i18n, k)} ({i18n.n(k.factor)})</option>)}</Select>}
                </div>
              )}
            </Field>
          )}
          <Field label={`${pack ? t('pur.pcsQty') : t('word.qty')} (${product?.baseUnit ?? ''})`} required={!pack} hint={pack && baseQty > 0 ? `= ${boxPcsText(i18n, baseQty, pack.factor, packLabel(i18n, pack), product?.baseUnit ?? '')}` : undefined}>{(a) => <QtyInput id={a.id} aria-describedby={a.describedBy} value={qty} onChange={setQty} data-testid="adjust-qty" />}</Field>
          <Field label={t('word.date')} required>{(a) => <DateInput id={a.id} value={date} onChange={setDate} />}</Field>
          {incoming && <Field label={t('inv.totalValue')} hint={t('inv.totalValueHint')}>{(a) => <MoneyInput id={a.id} value={value} onChange={setValue} />}</Field>}
        </div>
        {needsExpiry && (
          <div className="form-grid">
            <Field label={t('pur.batchNo')}>{(a) => <Input id={a.id} value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />}</Field>
            <Field label={t('inv.expiry')} required>{(a) => <DateInput id={a.id} value={expiry} onChange={setExpiry} />}</Field>
          </div>
        )}
        <Field label={t('word.reason')} required>{(a) => <Input id={a.id} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="adjust-reason" />}</Field>
        {error && <div className="p-error" role="alert" data-testid="adjust-error">{error}</div>}
      </div>
    </Modal>
  );
}
