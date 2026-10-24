import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { SupplierDto } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { Badge, Button, Checkbox, DateInput, Drawer, EmptyState, Field, Input, MoneyInput, PartyLedgerView, PaymentModal, Table, Tabs, Textarea, toast, useQuery } from '../ui';
import { SupplierProductsTab } from './purchases/SupplierProducts';
import { useApp } from '../store/app';

export function SuppliersPage() {
  const { t, money, int } = useI18n();
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<SupplierDto | 'new' | null>(null);
  const suppliers = useQuery('catalog:suppliers', { includeArchived: showArchived });
  const loc = useLocation();
  const opened = useRef<unknown>(null);
  useEffect(() => {
    const st = loc.state as { open?: number } | null;
    if (typeof st?.open === 'number' && opened.current !== loc.key && suppliers.data) {
      opened.current = loc.key;
      const s = suppliers.data.find((x) => x.id === st.open);
      if (s) setSel(s);
    }
  }, [loc.state, loc.key, suppliers.data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (suppliers.data ?? []).filter((x) => !s || x.name.toLowerCase().includes(s) || x.nameBn.includes(q.trim()) || x.phone.includes(s));
  }, [suppliers.data, q]);
  const owe = rows.reduce((a, r) => a + Math.max(0, r.balance), 0);
  return (
    <div>
      <div className="page-h">
        <h2>{t('nav.suppliers')}</h2>
        <Button variant="primary" onClick={() => setSel('new')} data-testid="add-supplier">{t('sup.add')}</Button>
      </div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <Input placeholder={t('act.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} aria-label={t('act.search')} />
        <Checkbox label={t('prod.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        <span className="spacer" />
        <span>{t('sup.totalOwed')}: <strong>{money(owe)}</strong> · {int(rows.length)} {t('word.rows')}</span>
      </div>
      {suppliers.error && <div className="p-error" role="alert">{suppliers.error}</div>}
      <Table
        rows={rows}
        rowKey={(s) => s.id}
        onRowClick={setSel}
        pageSize={50}
        columns={[
          { key: 'name', header: t('word.name'), render: (s) => <span>{s.name} {s.status === 'archived' && <Badge tone="warn">{t('state.archived')}</Badge>}</span>, sortValue: (s) => s.name.toLowerCase() },
          { key: 'phone', header: t('word.phone'), render: (s) => s.phone },
          { key: 'bal', header: t('sup.weOwe'), right: true, render: (s) => (s.balance > 0 ? <Badge tone="red">{money(s.balance, { fixed: true })}</Badge> : money(s.balance, { fixed: true })), sortValue: (s) => s.balance }
        ]}
        empty={suppliers.loading ? undefined : <EmptyState title={t('sup.emptyTitle')} body={t('sup.emptyBody')} action={<Button variant="primary" onClick={() => setSel('new')}>{t('sup.add')}</Button>} />}
      />
      <SupplierDrawer supplier={sel === 'new' ? null : sel} open={sel !== null} onClose={() => setSel(null)} onChanged={() => suppliers.reload()} />
    </div>
  );
}

function SupplierDrawer({ supplier, open, onClose, onChanged }: { supplier: SupplierDto | null; open: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, money } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const [f, setF] = useState({ name: '', nameBn: '', phone: '', address: '', notes: '' });
  const [opening, setOpening] = useState<number | null>(0);
  const [openingDate, setOpeningDate] = useState<string | null>(today);
  const [error, setError] = useState<string | null>(null);
  const [pay, setPay] = useState(false);
  const [lastKey, setLastKey] = useState('');
  const [bump, setBump] = useState(0);
  const [tab, setTab] = useState<'details' | 'products'>('details');
  const key = open ? String(supplier?.id ?? 'new') : '';
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setTab('details');
      setF(supplier ? { name: supplier.name, nameBn: supplier.nameBn, phone: supplier.phone, address: supplier.address, notes: supplier.notes } : { name: '', nameBn: '', phone: '', address: '', notes: '' });
      setOpening(0);
      setOpeningDate(today);
      setError(null);
    }
  }
  const live = useQuery('catalog:suppliers', { includeArchived: true }, open && !!supplier);
  const current = (supplier && live.data?.find((s) => s.id === supplier.id)) || supplier;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      await call('catalog:supplierSave', { ...(supplier ? { id: supplier.id } : {}), ...f, ...(!supplier && opening ? { openingBalance: opening, openingDate: openingDate ?? today } : {}) });
      toast.ok(t('toast.saved'));
      onChanged();
      if (!supplier) onClose();
      else setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Drawer
      wide
      open={open}
      title={supplier ? supplier.name : t('sup.add')}
      onClose={onClose}
      footer={
        <>
          {supplier && <Button onClick={() => void call('catalog:supplierSave', { id: supplier.id, ...f, archived: supplier.status === 'active' }).then(() => { onChanged(); onClose(); }, (e: unknown) => setError(errorText(e)))}>{supplier.status === 'active' ? t('act.archive') : t('act.restore')}</Button>}
          <span className="spacer" />
          <Button onClick={onClose}>{t('act.close')}</Button>
          <Button variant="primary" disabled={!f.name.trim()} onClick={() => void save()} data-testid="supplier-save">{t('act.save')}</Button>
        </>
      }
    >
      {supplier && <Tabs value={tab} onChange={setTab} label={t('nav.suppliers')} tabs={[{ value: 'details', label: t('sup.tabDetails') }, { value: 'products', label: t('sup.tabProducts') }]} />}
      {supplier && tab === 'products' ? <SupplierProductsTab supplierId={supplier.id} /> : (
      <div className="grid" style={{ gap: 12 }}>
        <div className="form-grid">
          <Field label={t('word.name')} required>{(a) => <Input id={a.id} value={f.name} onChange={set('name')} data-testid="supplier-name" />}</Field>
          <Field label={t('prod.nameBn')}>{(a) => <Input id={a.id} value={f.nameBn} onChange={set('nameBn')} />}</Field>
          <Field label={t('word.phone')}>{(a) => <Input id={a.id} inputMode="tel" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label={t('word.address')}>{(a) => <Input id={a.id} value={f.address} onChange={set('address')} />}</Field>
        </div>
        <Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} value={f.notes} onChange={set('notes')} />}</Field>
        {!supplier && (
          <div className="form-grid">
            <Field label={t('sup.opening')} hint={t('sup.openingHint')}>{(a) => <MoneyInput id={a.id} aria-describedby={a.describedBy} value={opening} onChange={setOpening} />}</Field>
            <Field label={t('word.date')}>{(a) => <DateInput id={a.id} value={openingDate} onChange={setOpeningDate} />}</Field>
          </div>
        )}
        {error && <div className="p-error shake" role="alert">{error}</div>}
        {supplier && current && (
          <>
            <div className="row"><strong>{t('sup.weOwe')}:</strong> <Badge tone={current.balance > 0 ? 'red' : 'ok'}>{money(current.balance, { fixed: true })}</Badge><span className="spacer" /><Button variant="primary" onClick={() => setPay(true)} data-testid="pay-supplier">{t('pay.pay')}</Button></div>
            <PartyLedgerView kind="supplier" id={supplier.id} reloadKey={bump} />
            <PaymentModal open={pay} kind="supplier" partyId={supplier.id} partyName={supplier.name} balance={current.balance} onClose={() => setPay(false)} onDone={() => { setPay(false); setBump((b) => b + 1); live.reload(); onChanged(); }} />
          </>
        )}
      </div>
      )}
    </Drawer>
  );
}

