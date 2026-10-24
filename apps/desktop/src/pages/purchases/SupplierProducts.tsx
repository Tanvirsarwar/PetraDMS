import { useMemo, useState } from 'react';
import type { ProductDto, SupplierProductDto } from '@petra/core';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { Button, Checkbox, EmptyState, Input, MoneyInput, Select, productName, toast, useQuery } from '../../ui';
import { AddManyModal } from './AddManyModal';
import { packOf } from './grid';

/** Suppliers > Products: which products this company supplies, in which box, at what cost per box. */
export function SupplierProductsTab({ supplierId }: { supplierId: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const links = useQuery('supplier:products', { supplierId });
  const productsQ = useQuery('catalog:products', { includeArchived: false });
  const lookups = useQuery('catalog:lookups', undefined);
  const byId = useMemo(() => new Map((productsQ.data ?? []).map((p) => [p.id, p])), [productsQ.data]);
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState('');
  const [brandId, setBrandId] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const linked = (links.data ?? []).filter((l) => byId.has(l.productId));
  const shown = linked.filter((l) => {
    const p = byId.get(l.productId)!;
    const s = q.trim().toLowerCase();
    return !s || p.name.toLowerCase().includes(s) || p.nameBn.includes(q.trim()) || p.sku.toLowerCase().includes(s);
  });
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setError(null);
    try {
      await fn();
      if (okText) toast.ok(okText);
      links.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const link = (ids: number[], brand?: number) => run(async () => {
    const r = await call('supplier:link', { supplierId, productIds: ids, ...(brand ? { brandId: brand } : {}) });
    toast.ok(t('sup.linked', { n: r.added }));
  });
  return (
    <div className="grid" style={{ gap: 10 }} data-testid="supplier-products">
      <div className="row wrap">
        <Button variant="primary" onClick={() => setPicker(true)} data-testid="link-products">{t('sup.linkProducts')}</Button>
        <Select aria-label={t('sup.linkBrand')} value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 170 }} data-testid="link-brand">
          <option value="">{t('sup.pickBrand')}</option>
          {(lookups.data?.brands ?? []).filter((b) => b.status === 'active').map((b) => <option key={b.id} value={b.id}>{i18n.lang === 'bn' && b.nameBn ? b.nameBn : b.name}</option>)}
        </Select>
        <Button disabled={!brandId} onClick={() => void link([], brandId ?? undefined)} data-testid="link-brand-go">{t('sup.linkBrand')}</Button>
        <span className="spacer" />
        <Button variant="danger" disabled={sel.size === 0} onClick={() => void run(async () => { await call('supplier:unlink', { supplierId, productIds: [...sel] }); setSel(new Set()); }, t('sup.unlinked'))} data-testid="unlink-selected">{t('sup.unlink', { n: sel.size })}</Button>
      </div>
      <Input placeholder={t('pur.filterHint')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('pur.filter')} />
      <div className="muted" data-testid="linked-count">{t('sup.linkedCount', { n: linked.length })}</div>
      {error && <div className="p-error" role="alert">{error}</div>}
      {linked.length === 0 ? (
        <EmptyState title={t('sup.noLinks')} body={t('sup.noLinksBody')} />
      ) : (
        <table className="lines">
          <thead><tr><th style={{ width: 32 }} /><th>{t('word.name')}</th><th style={{ width: 130 }}>{t('pur.box')}</th><th className="right" style={{ width: 130 }}>{t('pur.costPerBox')}</th></tr></thead>
          <tbody>
            {shown.map((l) => <LinkRow key={l.productId} link={l} product={byId.get(l.productId)!} checked={sel.has(l.productId)} onCheck={(on) => setSel((x) => { const n = new Set(x); if (on) n.add(l.productId); else n.delete(l.productId); return n; })} onSave={(patch) => void run(() => call('supplier:linkEdit', { supplierId, productId: l.productId, ...patch }))} />)}
          </tbody>
        </table>
      )}
      <AddManyModal open={picker} products={productsQ.data ?? []} already={new Set(linked.map((l) => l.productId))} onClose={() => setPicker(false)} onAdd={(ids) => { setPicker(false); void link(ids); }} />
    </div>
  );
}

function LinkRow({ link, product: p, checked, onCheck, onSave }: { link: SupplierProductDto; product: ProductDto; checked: boolean; onCheck: (on: boolean) => void; onSave: (patch: { defaultPackId?: number | null; lastCost?: number | null }) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [cost, setCost] = useState<number | null>(link.lastCost);
  const pack = link.defaultPackId ? packOf(p, link.defaultPackId) : packOf(p, -1);
  return (
    <tr data-testid={`link-row-${p.sku}`}>
      <td><Checkbox label="" aria-label={t('sup.select')} checked={checked} onChange={(e) => onCheck(e.target.checked)} /></td>
      <td><strong>{productName(i18n.lang, p)}</strong><br /><small className="muted">{p.sku}</small></td>
      <td>
        <Select aria-label={t('pur.box')} value={link.defaultPackId ?? pack.id} onChange={(e) => { const np = packOf(p, Number(e.target.value)); onSave({ defaultPackId: np.factor > 1 ? np.id : null }); }} data-testid={`link-pack-${p.sku}`}>
          {p.packs.map((k) => <option key={k.id} value={k.id}>{k.name}{k.factor > 1 ? ` (${i18n.n(k.factor)})` : ''}</option>)}
        </Select>
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          <MoneyInput aria-label={t('pur.costPerBox')} value={cost} onChange={setCost} data-testid={`link-cost-${p.sku}`} onKeyDown={(e) => { if (e.key === 'Enter' && cost !== link.lastCost) onSave({ lastCost: cost }); }} />
          {cost !== link.lastCost && <Button size="sm" onClick={() => onSave({ lastCost: cost })} data-testid={`link-cost-save-${p.sku}`}>{t('act.save')}</Button>}
        </div>
      </td>
    </tr>
  );
}
