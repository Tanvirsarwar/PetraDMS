import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerDto } from '@petra/core';
import { Button, Field, Input } from './controls';
import { Modal } from './overlay';
import { useQuery } from './hooks';
import { toast } from './toast';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { Select } from './controls';
import { useApp } from '../store/app';

/** Customer chooser opened with F3: search by name, phone or area; Enter picks; "+ New customer" adds one without leaving the sale. */
export function CustomerPicker({ open, onClose, onPick, allowWalkIn = true, startAdding = false }: { open: boolean; onClose: () => void; onPick: (c: CustomerDto | null) => void; allowWalkIn?: boolean; startAdding?: boolean }) {
  const { t, money, n } = useI18n();
  const customers = useQuery('customer:list', { includeArchived: false }, open);
  const areas = useQuery('area:list', undefined, open);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<'retail' | 'wholesale' | 'dealer'>('retail');
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setHi(0);
      setAdding(startAdding);
      setError(null);
    }
  }, [open, startAdding]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = customers.data ?? [];
    const out = s ? list.filter((c) => c.name.toLowerCase().includes(s) || c.nameBn.includes(q.trim()) || c.phone.includes(s) || c.areaName.toLowerCase().includes(s)) : list;
    return out.slice(0, 50);
  }, [q, customers.data]);
  useEffect(() => setHi(0), [q]);
  const choose = (c: CustomerDto | null) => {
    onPick(c);
    onClose();
  };
  const create = async () => {
    try {
      const r = await call('customer:quickAdd', { name, phone, address, areaId, type });
      customers.reload();
      const fresh = await call('customer:list', { includeArchived: false });
      const c = fresh.find((x) => x.id === r.id) ?? null;
      toast.ok(t('cust.added'));
      setName(''); setPhone(''); setAddress(''); setType('retail');
      if (c) choose(c);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal open={open} title={adding ? t('cust.new') : t('cust.choose')} onClose={onClose} wide>
      {adding ? (
        <div className="grid" style={{ gap: 12 }}>
          <Field label={t('word.name')} required>{(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} data-testid="quick-cust-name" data-autofocus />}</Field>
          <Field label={t('word.phone')}>{(a) => <Input id={a.id} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" data-testid="quick-cust-phone" />}</Field>
          <Field label={t('word.address')}>{(a) => <Input id={a.id} value={address} onChange={(e) => setAddress(e.target.value)} data-testid="quick-cust-address" />}</Field>
          <Field label={t('cust.type')} hint={role === 'staff' ? t('cust.typeStaffHint') : undefined}>
            {(a) => (
              <Select id={a.id} aria-describedby={a.describedBy} value={type} disabled={role === 'staff'} onChange={(e) => setType(e.target.value as typeof type)} data-testid="quick-cust-type">
                {(['retail', 'wholesale', 'dealer'] as const).map((k) => <option key={k} value={k}>{t(`tier.${k}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('word.area')}>
            {(a) => (
              <Select id={a.id} value={areaId ?? ''} onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">-</option>
                {(areas.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}
          </Field>
          {error && <div className="p-error" role="alert">{error}</div>}
          <div className="row"><Button onClick={() => setAdding(false)}>{t('act.back')}</Button><span className="spacer" /><Button variant="primary" disabled={!name.trim()} onClick={() => void create()} data-testid="quick-cust-save">{t('act.save')}</Button></div>
        </div>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          <Input
            ref={input}
            data-autofocus
            data-testid="cust-search"
            value={q}
            placeholder={t('cust.searchHint')}
            aria-label={t('act.search')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
              else if (e.key === 'Enter' && matches[hi]) { e.preventDefault(); choose(matches[hi]!); }
            }}
          />
          <div className="picker-list" style={{ position: 'static', maxHeight: 340, overflow: 'auto' }} role="listbox">
            {allowWalkIn && <div role="option" aria-selected={false} className="pick-row" onClick={() => choose(null)} data-testid="cust-walkin"><strong>{t('cust.walkIn')}</strong></div>}
            {matches.map((c, idx) => (
              <div key={c.id} role="option" aria-selected={idx === hi} className={`pick-row${idx === hi ? ' hi' : ''}`} onClick={() => choose(c)}>
                <span><strong>{c.name}</strong> <small className="muted">{c.areaName} {c.phone && `· ${n(c.phone)}`}</small></span>
                <span className="num">{c.balance > 0 ? money(c.balance) : ''}</span>
              </div>
            ))}
            {matches.length === 0 && <div className="muted" style={{ padding: 8 }}>{t('state.noResults')}</div>}
          </div>
          <div className="row"><Button onClick={() => { setAdding(true); setName(q); }} data-testid="cust-new">+ {t('cust.new')}</Button></div>
        </div>
      )}
    </Modal>
  );
}
