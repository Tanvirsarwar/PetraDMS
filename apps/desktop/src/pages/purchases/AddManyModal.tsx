import { useMemo, useState } from 'react';
import type { ProductDto } from '@petra/core';
import { useI18n } from '../../i18n';
import { Button, Checkbox, Input, Modal, Select, productName, stockText, useQuery } from '../../ui';

const SHOW = 300;

/** Checkbox list of every active product (not only the company's), with search and filters; adds all ticked ones at once. */
export function AddManyModal({ open, products, already, onClose, onAdd }: { open: boolean; products: ProductDto[]; already: Set<number>; onClose: () => void; onAdd: (ids: number[]) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const lookups = useQuery('catalog:lookups', undefined, open);
  const [q, setQ] = useState('');
  const [catId, setCatId] = useState<number | null>(null);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => !already.has(p.id) && (!catId || p.categoryId === catId) && (!brandId || p.brandId === brandId)
      && (!s || p.name.toLowerCase().includes(s) || p.nameBn.includes(q.trim()) || p.sku.toLowerCase().includes(s)));
  }, [products, already, q, catId, brandId]);
  const toggle = (id: number, on: boolean) => setPicked((x) => { const n = new Set(x); if (on) n.add(id); else n.delete(id); return n; });
  const close = () => { setPicked(new Set()); onClose(); };
  return (
    <Modal open={open} wide title={t('pur.addMany')} onClose={close}
      footer={<><span className="muted">{t('pur.picked', { n: picked.size })}</span><span className="spacer" /><Button onClick={close}>{t('act.cancel')}</Button><Button variant="primary" disabled={picked.size === 0} onClick={() => { onAdd([...picked]); setPicked(new Set()); }} data-testid="add-many-go">{t('pur.addPicked', { n: picked.size })}</Button></>}>
      <div className="grid" style={{ gap: 10 }}>
        <div className="row wrap">
          <Input placeholder={t('pur.filterHint')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('pur.filter')} style={{ maxWidth: 240 }} data-autofocus data-testid="add-many-search" />
          <Select aria-label={t('prod.category')} value={catId ?? ''} onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 170 }}>
            <option value="">{t('pur.allCategories')}</option>
            {(lookups.data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{i18n.lang === 'bn' && c.nameBn ? c.nameBn : c.name}</option>)}
          </Select>
          <Select aria-label={t('prod.brand')} value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 170 }}>
            <option value="">{t('pur.allBrands')}</option>
            {(lookups.data?.brands ?? []).map((c) => <option key={c.id} value={c.id}>{i18n.lang === 'bn' && c.nameBn ? c.nameBn : c.name}</option>)}
          </Select>
          <span className="spacer" />
          <Button size="sm" disabled={matches.length === 0} onClick={() => setPicked((x) => new Set([...x, ...matches.map((p) => p.id)]))} data-testid="add-many-all">{t('pur.selectAllFiltered', { n: matches.length })}</Button>
          <Button size="sm" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>{t('pur.selectNone')}</Button>
        </div>
        <div className="pick-list" role="group" aria-label={t('pur.addMany')}>
          {matches.slice(0, SHOW).map((p) => (
            <div key={p.id} className="pick-row">
              <Checkbox label={`${productName(i18n.lang, p)} · ${p.sku}`} checked={picked.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} data-testid={`pick-${p.sku}`} />
              <small className="muted">{stockText(i18n, p, p.stockQty)}</small>
            </div>
          ))}
          {matches.length > SHOW && <p className="muted">{t('pur.moreMatches', { shown: SHOW, total: matches.length })}</p>}
          {matches.length === 0 && <p className="muted">{t('state.noResults')}</p>}
        </div>
      </div>
    </Modal>
  );
}
