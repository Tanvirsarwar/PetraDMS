import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CustomerDto, PriceTier } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, Input, Modal, MoneyInput, DateInput, PartyLedgerView, PaymentModal, PrintActions, Select, Stat, Table, Textarea, toast, useDisplayDate, useQuery } from '../ui';

const TIERS: PriceTier[] = ['retail', 'wholesale', 'dealer'];

export function CustomersPage({ embedded }: { embedded?: boolean }) {
  const { t, money, int } = useI18n();
  const navigate = useNavigate();
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const canEdit = role !== 'staff';
  const date = useDisplayDate();
  const list = useQuery('customer:list', { includeArchived: true });
  const areas = useQuery('area:list', undefined);
  const [q, setQ] = useState('');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [owingOnly, setOwingOnly] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sel, setSel] = useState<number | 'new' | null>(null);
  const loc = useLocation();
  useEffect(() => {
    const st = loc.state as { add?: boolean; open?: number } | null;
    if (st?.add) setSel('new');
    else if (typeof st?.open === 'number') setSel(st.open);
  }, [loc.state]);
  const rows = (list.data ?? []).filter((c) => {
    if (!archived && c.status === 'archived') return false;
    if (areaId !== null && c.areaId !== areaId) return false;
    if (owingOnly && c.balance <= 0) return false;
    const s = q.trim().toLowerCase();
    return !s || c.name.toLowerCase().includes(s) || c.nameBn.includes(q.trim()) || c.phone.includes(s);
  });
  const totalDue = (list.data ?? []).filter((c) => c.status === 'active' && c.balance > 0).reduce((a, c) => a + c.balance, 0);
  return (
    <div>
      {!embedded && <div className="page-h"><h2>{t('nav.customers')}</h2>{canEdit && <div className="row" style={{ gap: 8 }}><Button onClick={() => navigate('/data', { state: { kind: 'customers' } })} data-testid="import-customers">{t('imp.fromCsv')}</Button><Button variant="primary" onClick={() => setSel('new')} data-testid="add-customer">{t('cust.new')}</Button></div>}</div>}
      {embedded && canEdit && <div className="row" style={{ marginBottom: 8 }}><Button variant="primary" onClick={() => setSel('new')} data-testid="add-customer">{t('cust.new')}</Button></div>}
      <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
        <Stat label={t('cust.totalDue')} value={money(totalDue)} accent={totalDue > 0} />
        <Stat label={t('nav.customers')} value={int((list.data ?? []).filter((c) => c.status === 'active').length)} />
      </div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <Input placeholder={t('cust.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} aria-label={t('act.search')} data-testid="cust-list-search" />
        <Select aria-label={t('word.area')} value={areaId ?? ''} onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 200 }}>
          <option value="">{t('word.area')}: {t('state.all')}</option>
          {(areas.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <label className="row"><input type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} /> {t('cust.owingOnly')}</label>
        {canEdit && <label className="row"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {t('prod.showArchived')}</label>}
      </div>
      {list.error && <div className="p-error" role="alert">{list.error}</div>}
      <Table
        rows={rows}
        rowKey={(c) => c.id}
        pageSize={50}
        onRowClick={(c) => setSel(c.id)}
        columns={[
          { key: 'name', header: t('word.name'), render: (c: CustomerDto) => <span><strong>{c.name}</strong> {c.status === 'archived' && <Badge tone="warn">{t('state.archived')}</Badge>}</span>, sortValue: (c) => c.name },
          { key: 'area', header: t('word.area'), render: (c) => c.areaName, sortValue: (c) => c.areaName },
          { key: 'phone', header: t('word.phone'), render: (c) => c.phone },
          { key: 'type', header: t('cust.type'), render: (c) => t(`tier.${c.type}`) },
          { key: 'last', header: t('cust.lastSale'), render: (c) => (c.lastSaleDate ? date(c.lastSaleDate) : '-'), sortValue: (c) => c.lastSaleDate ?? '' },
          { key: 'limit', header: t('cust.creditLimit'), right: true, render: (c) => (c.creditLimit > 0 ? money(c.creditLimit, { fixed: true }) : '-') },
          { key: 'due', header: t('word.due'), right: true, render: (c) => (c.balance > 0 ? <Badge tone="red">{money(c.balance, { fixed: true })}</Badge> : c.balance < 0 ? <Badge tone="ok">{money(c.balance, { fixed: true })}</Badge> : money(0, { fixed: true })), sortValue: (c) => c.balance }
        ]}
        empty={list.loading ? undefined : <EmptyState title={t('cust.emptyTitle')} body={t('cust.emptyBody')} action={canEdit ? <Button variant="primary" onClick={() => setSel('new')}>{t('cust.new')}</Button> : undefined} />}
      />
      <CustomerDrawer sel={sel} customers={list.data ?? []} onClose={() => setSel(null)} onSaved={() => { list.reload(); areas.reload(); }} areas={areas.data ?? []} />
    </div>
  );
}

interface Form {
  name: string; nameBn: string; phone: string; address: string; areaId: number | null; type: PriceTier; creditLimit: number | null; discountPct: string; notes: string; openingBalance: number | null; openingDate: string | null;
}

function CustomerDrawer({ sel, customers, areas, onClose, onSaved }: { sel: number | 'new' | null; customers: CustomerDto[]; areas: { id: number; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { t, money } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const canEdit = role !== 'staff';
  const current = typeof sel === 'number' ? customers.find((c) => c.id === sel) ?? null : null;
  const blank: Form = { name: '', nameBn: '', phone: '', address: '', areaId: null, type: 'retail', creditLimit: 0, discountPct: '', notes: '', openingBalance: 0, openingDate: today };
  const [f, setF] = useState<Form>(blank);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [areaOpen, setAreaOpen] = useState(false);
  const [areaName, setAreaName] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [ledgerKey, setLedgerKey] = useState(0);
  useEffect(() => {
    setError(null);
    if (sel === 'new') setF({ ...blank, openingDate: today });
    else if (current) setF({ name: current.name, nameBn: current.nameBn, phone: current.phone, address: current.address, areaId: current.areaId, type: current.type, creditLimit: current.creditLimit, discountPct: current.defaultDiscountBp ? String(current.defaultDiscountBp / 100) : '', notes: current.notes, openingBalance: 0, openingDate: today });
  }, [sel, current?.id]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = f.name.trim() !== '' && f.creditLimit !== null && f.openingBalance !== null && (f.discountPct === '' || (Number(f.discountPct) >= 0 && Number(f.discountPct) <= 100));
  const save = async () => {
    if (!valid) return;
    try {
      await call('customer:save', {
        ...(current ? { id: current.id } : {}), name: f.name, nameBn: f.nameBn, phone: f.phone, address: f.address, areaId: f.areaId, type: f.type, creditLimit: f.creditLimit!,
        defaultDiscountBp: Math.round(Number(f.discountPct || 0) * 100), notes: f.notes,
        ...(current ? {} : { openingBalance: f.openingBalance!, openingDate: f.openingDate ?? today })
      });
      toast.ok(t('cust.saved'));
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const addArea = async () => {
    try {
      const r = await call('area:save', { name: areaName, nameBn: '' });
      onSaved();
      set('areaId', r.id);
      setAreaOpen(false);
      setAreaName('');
    } catch (e) {
      setError(errorText(e));
      setAreaOpen(false);
    }
  };
  return (
    <Drawer wide open={sel !== null} title={sel === 'new' ? t('cust.new') : current?.name ?? ''} onClose={onClose}
      footer={canEdit ? (
        <>
          {current && <Button onClick={() => setArchiveOpen(true)} data-testid="cust-archive">{current.status === 'active' ? t('act.archive') : t('act.restore')}</Button>}
          <span className="spacer" />
          <Button onClick={onClose}>{t('act.cancel')}</Button>
          <Button variant="primary" kbd="Ctrl+S" disabled={!valid} onClick={() => void save()} data-testid="customer-save">{t('act.save')}</Button>
        </>
      ) : undefined}>
      {current && (
        <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
          <span>{t('pay.theyOwe')}: <Badge tone={current.balance > 0 ? 'red' : 'ok'}><span data-testid="cust-balance">{money(current.balance, { fixed: true })}</span></Badge></span>
          <Button size="sm" variant="primary" onClick={() => setPayOpen(true)} data-testid="cust-receive">{t('pay.receive')}</Button>
          <PrintActions doc={{ type: 'statement', kind: 'customer', id: current.id }} formats={false} compact />
        </div>
      )}
      <div className="grid" style={{ gap: 12 }}>
        <div className="form-grid">
          <Field label={t('word.name')} required>{(a) => <Input id={a.id} value={f.name} onChange={(e) => set('name', e.target.value)} disabled={!canEdit} data-testid="customer-name" />}</Field>
          <Field label={t('prod.nameBn')}>{(a) => <Input id={a.id} value={f.nameBn} onChange={(e) => set('nameBn', e.target.value)} disabled={!canEdit} />}</Field>
          <Field label={t('word.phone')}>{(a) => <Input id={a.id} value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="01XXXXXXXXX" disabled={!canEdit} data-testid="customer-phone" />}</Field>
          <Field label={t('word.area')}>
            {(a) => (
              <div className="row">
                <Select id={a.id} value={f.areaId ?? ''} onChange={(e) => set('areaId', e.target.value ? Number(e.target.value) : null)} disabled={!canEdit} data-testid="customer-area"><option value="">-</option>{areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
                {canEdit && <Button size="sm" onClick={() => setAreaOpen(true)} aria-label={t('cust.newArea')} data-testid="add-area">+</Button>}
              </div>
            )}
          </Field>
          <div className="wide"><Field label={t('word.address')}>{(a) => <Input id={a.id} value={f.address} onChange={(e) => set('address', e.target.value)} disabled={!canEdit} />}</Field></div>
          <Field label={t('cust.type')} hint={t('cust.typeHint')}>
            {(a) => <Select id={a.id} value={f.type} onChange={(e) => set('type', e.target.value as PriceTier)} disabled={!canEdit}>{TIERS.map((x) => <option key={x} value={x}>{t(`tier.${x}`)}</option>)}</Select>}
          </Field>
          <Field label={t('cust.creditLimit')} hint={t('cust.creditLimitHint')}>{(a) => <MoneyInput id={a.id} value={f.creditLimit} onChange={(v) => set('creditLimit', v)} disabled={!canEdit} data-testid="customer-limit" />}</Field>
          <Field label={t('cust.defaultDiscount')} hint={t('cust.defaultDiscountHint')}>{(a) => <Input id={a.id} numeric inputMode="decimal" value={f.discountPct} onChange={(e) => set('discountPct', e.target.value)} disabled={!canEdit} />}</Field>
          {!current && (
            <>
              <Field label={t('sup.opening')} hint={t('cust.openingHint')}>{(a) => <MoneyInput id={a.id} value={f.openingBalance} onChange={(v) => set('openingBalance', v)} data-testid="customer-opening" />}</Field>
              <Field label={t('word.date')}>{(a) => <DateInput id={a.id} value={f.openingDate} onChange={(v) => set('openingDate', v)} />}</Field>
            </>
          )}
          <div className="wide"><Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} disabled={!canEdit} />}</Field></div>
        </div>
        {error && <div className="p-error shake" role="alert" data-testid="customer-error">{error}</div>}
        {current && <PartyLedgerView kind="customer" id={current.id} reloadKey={ledgerKey} />}
      </div>
      {current && <PaymentModal open={payOpen} kind="customer" partyId={current.id} partyName={current.name} balance={current.balance} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); setLedgerKey((k) => k + 1); onSaved(); }} />}
      <Modal open={areaOpen} title={t('cust.newArea')} onClose={() => setAreaOpen(false)} footer={<><Button onClick={() => setAreaOpen(false)}>{t('act.cancel')}</Button><Button variant="primary" disabled={!areaName.trim()} onClick={() => void addArea()} data-testid="area-save">{t('act.save')}</Button></>}>
        <Field label={t('word.name')} required>{(a) => <Input id={a.id} value={areaName} onChange={(e) => setAreaName(e.target.value)} data-autofocus data-testid="area-name" />}</Field>
      </Modal>
      <ConfirmDialog open={archiveOpen} title={current?.status === 'active' ? t('act.archive') : t('act.restore')} body={t('cust.archiveBody')} confirmLabel={current?.status === 'active' ? t('act.archive') : t('act.restore')}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => { setArchiveOpen(false); if (current) void call('customer:save', { id: current.id, name: current.name, nameBn: current.nameBn, phone: current.phone, address: current.address, areaId: current.areaId, type: current.type, creditLimit: current.creditLimit, defaultDiscountBp: current.defaultDiscountBp, notes: current.notes, archived: current.status === 'active' }).then(() => { onSaved(); onClose(); }, (e: unknown) => setError(errorText(e))); }} />
    </Drawer>
  );
}
