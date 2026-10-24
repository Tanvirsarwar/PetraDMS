import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LookupDto, ProductDto } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Badge, Button, Card, Checkbox, Drawer, EmptyState, Field, Input, Modal, MoneyInput, QtyInput, Select, Switch, Table, Tabs, Textarea, packLabel, productName, stockText, toast, useQuery, type Column } from '../ui';
import { pruneSelection, type Selection } from '../ui/selection';
import { ProductBulk } from './products/ProductBulk';

export function ProductsPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const canEdit = role !== 'staff';
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | 'all'>('all');
  const [editing, setEditing] = useState<ProductDto | 'new' | null>(null);
  const [tab, setTab] = useState<'products' | 'lookups'>('products');
  const [selected, setSelected] = useState<Selection>(() => new Set());
  const loc = useLocation();
  const products = useQuery('catalog:products', { includeArchived: showArchived || tab === 'lookups' });
  const opened = useRef<unknown>(null);
  useEffect(() => {
    const st = loc.state as { add?: boolean; open?: number } | null;
    if (canEdit && st?.add) setEditing('new');
    else if (typeof st?.open === 'number' && opened.current !== loc.key && products.data) {
      const p = products.data.find((x) => x.id === st.open);
      opened.current = loc.key;
      if (p) { if (canEdit) setEditing(p); else setQ(p.name); }
    }
  }, [loc.state, loc.key, canEdit, products.data]);
  const lookups = useQuery('catalog:lookups', undefined);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products.data ?? []).filter((p) => (cat === 'all' || p.categoryId === cat) && (!s || p.name.toLowerCase().includes(s) || p.nameBn.includes(q.trim()) || p.sku.toLowerCase().includes(s) || p.barcodes.some((b) => b.includes(s))));
  }, [products.data, q, cat]);

  // rows that leave the filtered list (search, category, archived switch, a reload) leave the selection too
  useEffect(() => { setSelected((cur) => pruneSelection(cur, rows.map((p) => p.id))); }, [rows]);

  const cols: Column<ProductDto>[] = [
    { key: 'sku', header: t('prod.sku'), render: (p) => <span className="num" style={{ textAlign: 'left' }}>{p.sku}</span>, sortValue: (p) => p.sku },
    { key: 'name', header: t('word.name'), render: (p) => <span>{productName(i18n.lang, p)} {p.status === 'archived' && <Badge tone="warn">{t('state.archived')}</Badge>}</span>, sortValue: (p) => p.name.toLowerCase() },
    { key: 'cat', header: t('prod.category'), render: (p) => p.categoryName || '-', sortValue: (p) => p.categoryName },
    {
      key: 'stock', header: t('nav.stock'), right: true,
      render: (p) => <span>{stockText(i18n, p, p.stockQty)} {p.reorderLevel > 0 && p.stockQty <= p.reorderLevel && <Badge tone="red">{t('prod.low')}</Badge>}</span>,
      sortValue: (p) => p.stockQty
    },
    { key: 'retail', header: `${t('prod.retail')} / ${t('prod.perUnit')}`, right: true, render: (p) => i18n.money(p.priceRetail, { fixed: true }), sortValue: (p) => p.priceRetail },
    { key: 'wholesale', header: t('prod.wholesale'), right: true, render: (p) => i18n.money(p.priceWholesale, { fixed: true }), sortValue: (p) => p.priceWholesale },
    ...(canEdit ? [
      { key: 'cost', header: t('prod.avgCost'), right: true, render: (p: ProductDto) => (p.avgCost === null ? '' : i18n.money(p.avgCost, { fixed: true })), sortValue: (p: ProductDto) => p.avgCost ?? 0 },
      { key: 'value', header: t('prod.stockValue'), right: true, render: (p: ProductDto) => (p.stockValue === null ? '' : i18n.money(p.stockValue)), sortValue: (p: ProductDto) => p.stockValue ?? 0 }
    ] : [])
  ];

  return (
    <div>
      <div className="page-h">
        <h2>{t('nav.products')}</h2>
        {canEdit && <div className="row" style={{ gap: 8 }}><Button onClick={() => navigate('/data', { state: { kind: 'products' } })} data-testid="import-products">{t('imp.fromCsv')}</Button><Button variant="primary" onClick={() => setEditing('new')} data-testid="add-product">{t('prod.add')}</Button></div>}
      </div>
      {canEdit && <div style={{ marginBottom: 12 }}><Tabs value={tab} tabs={[{ value: 'products', label: t('nav.products') }, { value: 'lookups', label: t('prod.lookupsTab') }]} onChange={setTab} label={t('nav.products')} /></div>}
      {tab === 'lookups' && canEdit ? <LookupsTab products={products.data ?? []} lookups={lookups.data ?? { categories: [], brands: [] }} onChanged={() => { lookups.reload(); products.reload(); }} /> : (<>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <Input placeholder={t('prod.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} aria-label={t('act.search')} data-testid="product-search" />
        <Select value={String(cat)} onChange={(e) => setCat(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ maxWidth: 220 }} aria-label={t('prod.category')}>
          <option value="all">{t('state.all')}</option>
          {(lookups.data?.categories ?? []).filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Checkbox label={t('prod.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        <span className="spacer" />
        <span className="muted">{i18n.int(rows.length)} {t('word.rows')}</span>
      </div>
      {products.error && <div className="p-error" role="alert">{products.error}</div>}
      {canEdit && <ProductBulk ids={[...selected] as number[]} showArchived={showArchived} onClear={() => setSelected(new Set())} onDone={() => { setSelected(new Set()); products.reload(); }} />}
      <Table
        columns={cols}
        rows={rows}
        rowKey={(p) => p.id}
        pageSize={50}
        onRowClick={canEdit ? (p) => setEditing(p) : undefined}
        selectable={canEdit}
        selected={selected}
        onSelectionChange={setSelected}
        rowLabel={(p) => productName(i18n.lang, p)}
        empty={products.loading ? undefined : <EmptyState title={t('prod.emptyTitle')} body={t('prod.emptyBody')} action={canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>{t('prod.add')}</Button> : undefined} />}
      />
      </>)}
      <ProductEditor
        open={editing !== null}
        product={editing === 'new' ? null : editing}
        lookups={lookups.data ?? { categories: [], brands: [] }}
        onLookupsChanged={lookups.reload}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); products.reload(); }}
      />
    </div>
  );
}

interface PackRow {
  key: number;
  id?: number;
  name: string;
  nameBn: string;
  factor: number | null;
  priceRetail: number | null;
  priceWholesale: number | null;
  priceDealer: number | null;
  barcode: string;
}

function ProductEditor({ open, product, lookups, onLookupsChanged, onClose, onSaved }: { open: boolean; product: ProductDto | null; lookups: { categories: LookupDto[]; brands: LookupDto[] }; onLookupsChanged: () => void; onClose: () => void; onSaved: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [f, setF] = useState(() => blank());
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState(false);
  const [addLookup, setAddLookup] = useState<'category' | 'brand' | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [lastKey, setLastKey] = useState<string>('');
  const [saleFactor, setSaleFactor] = useState(1);
  const [purchaseFactor, setPurchaseFactor] = useState(1);
  /** The reorder level is typed in this unit (1 = base unit) and stored in base units. */
  const [reorderFactor, setReorderFactor] = useState(1);
  const [showMore, setShowMore] = useState(false);
  /** A box added in this editing session: the default sale and purchase units follow its size. */
  const boxIsNew = useRef(false);

  const key = open ? String(product?.id ?? 'new') : '';
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setF(product ? fromProduct(product) : blank());
      setPacks(product ? product.packs.filter((p) => p.factor > 1).map((p, i) => ({ key: i, id: p.id, name: p.name, nameBn: p.nameBn, factor: p.factor, priceRetail: p.priceRetail, priceWholesale: p.priceWholesale, priceDealer: p.priceDealer, barcode: p.barcode ?? '' })) : []);
      const fac = (id: number | null) => (id ? product?.packs.find((k) => k.id === id)?.factor ?? 1 : 1);
      setSaleFactor(product ? fac(product.defaultSalePackId) : 1);
      setPurchaseFactor(product ? fac(product.defaultPurchasePackId) : 1);
      const big = product ? Math.max(1, ...product.packs.map((k) => k.factor)) : 1;
      setReorderFactor(product && product.reorderLevel > 0 && big > 1 && product.reorderLevel % big === 0 ? big : 1);
      setError(null);
      setFieldErr(false);
      setShowMore(product ? product.packs.filter((p) => p.factor > 1).length > 1 : false);
      boxIsNew.current = false;
    }
  }

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // the simple box fields edit the first pack; "more packs" shows every pack in the full table
  const box = packs[0] ?? null;
  const unitName = f.baseUnit.trim() || 'pcs';
  const updBox = (patch: Partial<PackRow>) => {
    if (patch.factor !== undefined && boxIsNew.current) { setSaleFactor(patch.factor ?? 1); setPurchaseFactor(patch.factor ?? 1); }
    setPacks((all) => all.map((x, j) => (j === 0 ? { ...x, ...patch } : x)));
  };
  const toggleBox = (on: boolean) => {
    if (on && packs.length === 0) {
      boxIsNew.current = true;
      setPacks([{ key: Date.now(), name: 'Box', nameBn: 'বক্স', factor: null, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: '' }]);
    } else if (!on) {
      setPacks([]);
      setSaleFactor(1);
      setPurchaseFactor(1);
    }
  };
  const boxAuto = (per: number | null) => (box?.factor && box.factor >= 2 && per !== null ? t('prod.boxPriceHint', { price: i18n.money(box.factor * per), qty: i18n.n(box.factor), unit: unitName }) : undefined);
  const names = packs.map((p) => p.name.trim().toLowerCase());
  const packsOk = packs.every((p, i) => p.name.trim() !== '' && p.factor !== null && p.factor >= 2 && names.indexOf(p.name.trim().toLowerCase()) === i && p.name.trim().toLowerCase() !== f.baseUnit.trim().toLowerCase()) && new Set(packs.map((p) => p.factor)).size === packs.length;
  const valid = f.sku.trim() !== '' && f.name.trim() !== '' && f.baseUnit.trim() !== '' && f.priceRetail !== null && f.priceWholesale !== null && f.minPrice !== null && packsOk;
  const unitChoices = [{ factor: 1, label: f.baseUnit || 'pcs' }, ...packs.filter((p) => p.factor !== null && p.factor >= 2 && p.name.trim()).map((p) => ({ factor: p.factor!, label: `${p.name.trim()} (${i18n.n(p.factor!)})` }))];
  const has = (factor: number) => unitChoices.some((u) => u.factor === factor);
  const reorderShown = f.reorderLevel === null ? null : reorderFactor > 1 ? Math.floor(f.reorderLevel / reorderFactor) : f.reorderLevel;

  const save = async () => {
    setFieldErr(true);
    if (!valid) return;
    try {
      await call('catalog:productSave', {
        ...(product ? { id: product.id } : {}),
        sku: f.sku, name: f.name, nameBn: f.nameBn, categoryId: f.categoryId, brandId: f.brandId, baseUnit: f.baseUnit.trim(), trackExpiry: f.trackExpiry,
        priceRetail: f.priceRetail!, priceWholesale: f.priceWholesale!, priceDealer: f.priceDealer ?? f.priceWholesale!, minPrice: f.minPrice!, reorderLevel: f.reorderLevel ?? 0,
        defaultSaleFactor: has(saleFactor) ? saleFactor : null, defaultPurchaseFactor: has(purchaseFactor) ? purchaseFactor : null,
        favourite: f.favourite, notes: f.notes,
        packs: packs.map((p) => ({ ...(p.id ? { id: p.id } : {}), name: p.name.trim(), nameBn: p.nameBn.trim(), factor: p.factor!, priceRetail: p.priceRetail, priceWholesale: p.priceWholesale, priceDealer: p.priceDealer, barcode: p.barcode.trim() || null })),
        barcodes: f.barcodes.split(/[\s,;]+/).map((b) => b.trim()).filter(Boolean)
      });
      toast.ok(t('toast.saved'));
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const lockExpiry = !!product?.hasHistory;
  return (
    <Drawer
      open={open}
      title={product ? productName(i18n.lang, product) : t('prod.add')}
      wide
      onClose={onClose}
      footer={
        <>
          {product && <Button variant={product.status === 'active' ? 'danger' : 'default'} onClick={() => setConfirmArchive(true)} data-testid="product-archive">{product.status === 'active' ? t('act.archive') : t('act.restore')}</Button>}
          {product && <Button onClick={() => setLabelsOpen(true)} data-testid="product-labels">{t('prod.printLabels')}</Button>}
          <span className="spacer" />
          <Button onClick={onClose}>{t('act.cancel')}</Button>
          <Button variant="primary" kbd="Ctrl+S" onClick={() => void save()} disabled={fieldErr && !valid} data-testid="product-save">{t('act.save')}</Button>
        </>
      }
    >
      <div className="grid" style={{ gap: 12 }} onKeyDown={(e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); } }}>
        <div className="form-grid">
          <Field label={t('prod.sku')} required error={fieldErr && !f.sku.trim() ? t('field.required') : null}>{(a) => <Input id={a.id} aria-describedby={a.describedBy} invalid={a.invalid} value={f.sku} onChange={(e) => set('sku', e.target.value)} data-testid="product-sku" />}</Field>
          <Field label={t('prod.baseUnit')} hint={t('prod.baseUnitHint')} required>{(a) => <Input id={a.id} aria-describedby={a.describedBy} list="units" value={f.baseUnit} onChange={(e) => set('baseUnit', e.target.value)} data-testid="product-unit" />}</Field>
          <datalist id="units">{['pcs', 'kg', 'g', 'litre', 'ml', 'packet', 'bottle', 'sachet'].map((u) => <option key={u} value={u} />)}</datalist>
          <div className="wide"><Field label={t('prod.nameEn')} required error={fieldErr && !f.name.trim() ? t('field.required') : null}>{(a) => <Input id={a.id} aria-describedby={a.describedBy} invalid={a.invalid} value={f.name} onChange={(e) => set('name', e.target.value)} data-testid="product-name" />}</Field></div>
          <div className="wide"><Field label={t('prod.nameBn')}>{(a) => <Input id={a.id} value={f.nameBn} onChange={(e) => set('nameBn', e.target.value)} />}</Field></div>
          <Field label={t('prod.category')}>
            {(a) => (
              <div className="row">
                <Select id={a.id} value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">-</option>
                  {lookups.categories.filter((c) => c.status === 'active' || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button size="icon" aria-label={t('act.add')} onClick={() => setAddLookup('category')}>+</Button>
              </div>
            )}
          </Field>
          <Field label={t('prod.brand')}>
            {(a) => (
              <div className="row">
                <Select id={a.id} value={f.brandId ?? ''} onChange={(e) => set('brandId', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">-</option>
                  {lookups.brands.filter((c) => c.status === 'active' || c.id === f.brandId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button size="icon" aria-label={t('act.add')} onClick={() => setAddLookup('brand')}>+</Button>
              </div>
            )}
          </Field>
        </div>

        <strong>{t('prod.prices')} <small className="muted">({t('prod.perUnitOf', { unit: f.baseUnit || '' })})</small></strong>
        <div className="form-grid">
          <Field label={t('prod.retail')} required>{(a) => <MoneyInput id={a.id} value={f.priceRetail} onChange={(v) => set('priceRetail', v)} invalid={fieldErr && f.priceRetail === null} data-testid="product-retail" />}</Field>
          <Field label={t('prod.wholesale')} required>{(a) => <MoneyInput id={a.id} value={f.priceWholesale} onChange={(v) => set('priceWholesale', v)} invalid={fieldErr && f.priceWholesale === null} data-testid="product-wholesale" />}</Field>
          <Field label={t('prod.dealer')} hint={t('prod.dealerHint')}>{(a) => <MoneyInput id={a.id} value={f.priceDealer} onChange={(v) => set('priceDealer', v)} />}</Field>
          <Field label={t('prod.minPrice')} hint={t('prod.minPriceHint')}>{(a) => <MoneyInput id={a.id} aria-describedby={a.describedBy} value={f.minPrice} onChange={(v) => set('minPrice', v)} />}</Field>
        </div>

        <div className="grid" style={{ gap: 10, border: '1px solid var(--line)', borderRadius: 'var(--r-3)', padding: 'var(--sp-3) var(--sp-4)' }} data-testid="box-setup">
          <Switch checked={box !== null} onChange={toggleBox} label={t('prod.soldByBox')} data-testid="product-has-box" />
          <div className="p-hint" style={{ marginTop: -6 }}>{t('prod.soldByBoxHint', { unit: unitName })}</div>
          {box && (
            <div className="form-grid">
              <Field label={t('prod.pcsPerBox', { unit: unitName })} required error={fieldErr && !(box.factor !== null && box.factor >= 2) ? t('prod.pcsPerBoxErr', { unit: unitName }) : null}>
                {(a) => <QtyInput id={a.id} aria-describedby={a.describedBy} invalid={a.invalid} value={box.factor} onChange={(v) => updBox({ factor: v })} data-testid="product-box-pcs" />}
              </Field>
              <div className="p-field" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                <strong data-testid="product-box-equals">{box.factor !== null && box.factor >= 2 ? t('prod.packEquals', { pack: packLabel(i18n, { name: box.name.trim() || 'Box', nameBn: box.nameBn.trim() }), qty: i18n.n(box.factor), unit: unitName }) : ''}</strong>
              </div>
              <Field label={t('prod.boxRetail')} hint={boxAuto(f.priceRetail)}>{(a) => <MoneyInput id={a.id} aria-describedby={a.describedBy} value={box.priceRetail} onChange={(v) => updBox({ priceRetail: v })} data-testid="product-box-retail" />}</Field>
              <Field label={t('prod.boxWholesale')} hint={boxAuto(f.priceWholesale)}>{(a) => <MoneyInput id={a.id} aria-describedby={a.describedBy} value={box.priceWholesale} onChange={(v) => updBox({ priceWholesale: v })} data-testid="product-box-wholesale" />}</Field>
            </div>
          )}
          <div><Button size="sm" variant="ghost" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore} data-testid="product-more-packs">{showMore ? t('prod.lessPacks') : t('prod.morePacks')}</Button></div>
          {showMore && (
            <div className="grid" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{t('prod.packs')}</strong>
              <div className="row" style={{ gap: 6 }}>
                {!packs.some((p) => p.name.trim().toLowerCase() === 'box') && <Button size="sm" variant="primary" onClick={() => { setPacks((p) => [...p, { key: Date.now(), name: 'Box', nameBn: 'বক্স', factor: null, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: '' }]); }} data-testid="add-box">{t('prod.addBox')}</Button>}
                {!packs.some((p) => p.factor === 12) && <Button size="sm" onClick={() => setPacks((p) => [...p, { key: Date.now() + 1, name: 'Dozen', nameBn: 'ডজন', factor: 12, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: '' }])} data-testid="add-dozen">{t('prod.addDozen')}</Button>}
                <Button size="sm" onClick={() => setPacks((p) => [...p, { key: Date.now() + 2, name: '', nameBn: '', factor: null, priceRetail: null, priceWholesale: null, priceDealer: null, barcode: '' }])} data-testid="add-pack">{t('prod.addPack')}</Button>
              </div>
            </div>
            <div className="muted">{t('prod.packHelp', { unit: f.baseUnit || 'pcs' })}</div>
            {packs.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
              <table className="lines" data-testid="pack-table">
                <thead><tr><th>{t('prod.packName')}</th><th className="right">{t('prod.packFactor', { unit: f.baseUnit || 'pcs' })}</th><th className="right">{t('prod.retail')}</th><th className="right">{t('prod.wholesale')}</th><th className="right">{t('prod.dealer')}</th><th>{t('prod.packBarcode')}</th><th /></tr></thead>
                <tbody>
                  {packs.map((p, idx) => {
                    const upd = (patch: Partial<PackRow>) => setPacks((all) => all.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
                    const auto = (per: number | null) => (p.factor && per !== null ? p.factor * per : null);
                    return (
                      <tr key={p.key}>
                        <td><Input aria-label={t('prod.packName')} value={p.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Carton" data-testid={`pack-name-${idx}`} /></td>
                        <td><QtyInput aria-label={t('prod.packFactor', { unit: f.baseUnit })} value={p.factor} onChange={(v) => upd({ factor: v })} data-testid={`pack-factor-${idx}`} /><div className="p-hint" data-testid={`pack-equals-${idx}`}>{p.factor !== null && p.factor >= 2 && p.name.trim() ? t('prod.packEquals', { pack: packLabel(i18n, { name: p.name.trim(), nameBn: p.nameBn.trim() }), qty: i18n.n(p.factor), unit: f.baseUnit || 'pcs' }) : ''}</div></td>
                        <td><MoneyInput aria-label={`${t('prod.retail')} ${p.name}`} value={p.priceRetail} onChange={(v) => upd({ priceRetail: v })} data-testid={`pack-retail-${idx}`} /><div className="p-hint">{auto(f.priceRetail) !== null ? `${t('prod.auto')}: ${i18n.money(auto(f.priceRetail)!)}` : ''}</div></td>
                        <td><MoneyInput aria-label={`${t('prod.wholesale')} ${p.name}`} value={p.priceWholesale} onChange={(v) => upd({ priceWholesale: v })} data-testid={`pack-wholesale-${idx}`} /><div className="p-hint">{auto(f.priceWholesale) !== null ? `${t('prod.auto')}: ${i18n.money(auto(f.priceWholesale)!)}` : ''}</div></td>
                        <td><MoneyInput aria-label={`${t('prod.dealer')} ${p.name}`} value={p.priceDealer} onChange={(v) => upd({ priceDealer: v })} data-testid={`pack-dealer-${idx}`} /><div className="p-hint">{auto(f.priceDealer ?? f.priceWholesale) !== null ? `${t('prod.auto')}: ${i18n.money(auto(f.priceDealer ?? f.priceWholesale)!)}` : ''}</div></td>
                        <td><Input aria-label={`${t('prod.packBarcode')} ${p.name}`} value={p.barcode} onChange={(e) => upd({ barcode: e.target.value })} data-testid={`pack-barcode-${idx}`} /></td>
                        <td><Button size="icon" variant="ghost" aria-label={t('act.delete')} onClick={() => setPacks((all) => all.filter((_, j) => j !== idx))}>×</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
            </div>
          )}
        </div>
        {fieldErr && !packsOk && <div className="p-error" role="alert">{t('prod.packInvalid')}</div>}

        <div className="form-grid">
          <Field label={t('prod.defaultSale')} hint={t('prod.defaultSaleHint')}>
            {(a) => (
              <Select id={a.id} aria-describedby={a.describedBy} value={has(saleFactor) ? saleFactor : 1} onChange={(e) => setSaleFactor(Number(e.target.value))} data-testid="product-default-sale">
                {unitChoices.map((u) => <option key={u.factor} value={u.factor}>{u.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('prod.defaultPurchase')} hint={t('prod.defaultPurchaseHint')}>
            {(a) => (
              <Select id={a.id} aria-describedby={a.describedBy} value={has(purchaseFactor) ? purchaseFactor : 1} onChange={(e) => setPurchaseFactor(Number(e.target.value))} data-testid="product-default-purchase">
                {unitChoices.map((u) => <option key={u.factor} value={u.factor}>{u.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('prod.reorder')} hint={t('prod.reorderHint', { unit: unitChoices.find((u) => u.factor === reorderFactor)?.label ?? f.baseUnit })}>
            {(a) => (
              <div className="row" style={{ gap: 6 }}>
                <QtyInput id={a.id} aria-describedby={a.describedBy} value={reorderShown} onChange={(v) => set('reorderLevel', v === null ? null : v * (has(reorderFactor) ? reorderFactor : 1))} data-testid="product-reorder" />
                <Select aria-label={t('prod.reorderUnit')} value={has(reorderFactor) ? reorderFactor : 1} onChange={(e) => { const nf = Number(e.target.value); set('reorderLevel', reorderShown === null ? null : reorderShown * nf); setReorderFactor(nf); }} style={{ maxWidth: 150 }} data-testid="product-reorder-unit">
                  {unitChoices.map((u) => <option key={u.factor} value={u.factor}>{u.label}</option>)}
                </Select>
              </div>
            )}
          </Field>
          <Field label={t('prod.barcodes')} hint={t('prod.barcodesHint')}>{(a) => <Input id={a.id} aria-describedby={a.describedBy} value={f.barcodes} onChange={(e) => set('barcodes', e.target.value)} />}</Field>
        </div>
        <div>
          <Switch checked={f.trackExpiry} onChange={(v) => !lockExpiry && set('trackExpiry', v)} label={t('prod.trackExpiry')} />
          <div className="p-hint">{lockExpiry ? t('prod.trackExpiryLocked') : t('prod.trackExpiryHint')}</div>
        </div>
        <Switch checked={f.favourite} onChange={(v) => set('favourite', v)} label={t('prod.favourite')} />
        <Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
        {product && (
          <div className="muted">{t('nav.stock')}: {stockText(i18n, product, product.stockQty)}{product.avgCost !== null ? ` · ${t('prod.avgCost')}: ${i18n.money(product.avgCost, { fixed: true })}/${product.baseUnit}` : ''}</div>
        )}
        {error && <div className="p-error shake" role="alert" data-testid="product-error">{error}</div>}
      </div>

      {product && <LabelsModal open={labelsOpen} productId={product.id} onClose={() => setLabelsOpen(false)} />}
      <LookupModal kind={addLookup} onClose={() => setAddLookup(null)} onSaved={(id) => { if (addLookup === 'category') set('categoryId', id); else set('brandId', id); setAddLookup(null); onLookupsChanged(); }} />
      <Modal
        open={confirmArchive}
        title={product?.status === 'active' ? t('act.archive') : t('act.restore')}
        onClose={() => setConfirmArchive(false)}
        footer={
          <>
            <Button onClick={() => setConfirmArchive(false)}>{t('act.cancel')}</Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={() => void call('catalog:productArchive', { id: product!.id, archived: product!.status === 'active' }).then(() => { setConfirmArchive(false); onSaved(); }, (e: unknown) => { setConfirmArchive(false); setError(errorText(e)); })}
            >
              {product?.status === 'active' ? t('act.archive') : t('act.restore')}
            </Button>
          </>
        }
      >
        {t('prod.archiveBody')}
      </Modal>
    </Drawer>
  );
}

function LabelsModal({ open, productId, onClose }: { open: boolean; productId: number; onClose: () => void }) {
  const { t } = useI18n();
  const [copies, setCopies] = useState('12');
  const [busy, setBusy] = useState(false);
  const n = Math.max(1, Math.min(200, Math.floor(Number(copies) || 0)));
  const run = async (action: 'print' | 'pdf') => {
    setBusy(true);
    try {
      const r = await call('print:run', { doc: { type: 'labels', items: [{ productId, copies: n }] }, action });
      toast.ok(action === 'pdf' ? `${t('print.saved')}: ${r.path ?? ''}` : t('print.sent'));
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title={t('prod.printLabels')} onClose={onClose} footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button disabled={busy} onClick={() => void run('pdf')} data-testid="labels-pdf">{t('act.saveAsPdf')}</Button><Button variant="primary" disabled={busy} onClick={() => void run('print')} data-testid="labels-print">{t('act.print')}</Button></>}>
      <Field label={t('prod.labelCopies')} hint={t('prod.labelHint')}>{(a) => <Input id={a.id} data-autofocus inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} data-testid="labels-copies" />}</Field>
    </Modal>
  );
}

function LookupModal({ kind, item, onClose, onSaved }: { kind: 'category' | 'brand' | null; item?: LookupDto | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (kind === null) return;
    setName(item?.name ?? ''); setNameBn(item?.nameBn ?? ''); setError(null);
  }, [kind, item]);
  return (
    <Modal
      open={kind !== null}
      title={item ? t('prod.renameLookup') : kind === 'brand' ? t('prod.addBrand') : t('prod.addCategory')}
      onClose={() => { setName(''); setNameBn(''); setError(null); onClose(); }}
      footer={
        <>
          <Button onClick={onClose}>{t('act.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            data-testid="lookup-save"
            onClick={() => void call('catalog:lookupSave', { kind: kind!, ...(item ? { id: item.id } : {}), name, nameBn }).then((r) => { setName(''); setNameBn(''); setError(null); onSaved(r.id); }, (e: unknown) => setError(errorText(e)))}
          >
            {t('act.save')}
          </Button>
        </>
      }
    >
      <div className="grid" style={{ gap: 12 }}>
        <Field label={t('prod.nameEn')} required>{(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} data-autofocus data-testid="lookup-name" />}</Field>
        <Field label={t('prod.nameBn')}>{(a) => <Input id={a.id} value={nameBn} onChange={(e) => setNameBn(e.target.value)} />}</Field>
        {error && <div className="p-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

function blank() {
  return { sku: '', name: '', nameBn: '', categoryId: null as number | null, brandId: null as number | null, baseUnit: 'pcs', trackExpiry: false, priceRetail: null as number | null, priceWholesale: null as number | null, priceDealer: null as number | null, minPrice: 0 as number | null, reorderLevel: 0 as number | null, favourite: false, notes: '', barcodes: '' };
}

function fromProduct(p: ProductDto) {
  return { sku: p.sku, name: p.name, nameBn: p.nameBn, categoryId: p.categoryId, brandId: p.brandId, baseUnit: p.baseUnit, trackExpiry: p.trackExpiry, priceRetail: p.priceRetail as number | null, priceWholesale: p.priceWholesale as number | null, priceDealer: p.priceDealer as number | null, minPrice: p.minPrice as number | null, reorderLevel: p.reorderLevel as number | null, favourite: p.favourite, notes: p.notes, barcodes: p.barcodes.join(', ') };
}


/** Categories and brands in one place: add, rename, archive or restore, with how many products use each. */
function LookupsTab({ products, lookups, onChanged }: { products: ProductDto[]; lookups: { categories: LookupDto[]; brands: LookupDto[] }; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [modal, setModal] = useState<{ kind: 'category' | 'brand'; item: LookupDto | null } | null>(null);
  const archive = (kind: 'category' | 'brand', x: LookupDto) =>
    void call('catalog:lookupSave', { kind, id: x.id, name: x.name, nameBn: x.nameBn, archived: x.status === 'active' }).then(() => { toast.ok(t('toast.saved')); onChanged(); }, (e: unknown) => toast.error(errorText(e)));
  const section = (kind: 'category' | 'brand', list: LookupDto[]) => {
    const count = (id: number) => products.filter((p) => (kind === 'category' ? p.categoryId : p.brandId) === id).length;
    const cols: Column<LookupDto>[] = [
      { key: 'name', header: t('prod.nameEn'), render: (x) => <span>{x.name} {x.status === 'archived' && <Badge tone="warn">{t('state.archived')}</Badge>}</span>, sortValue: (x) => x.name.toLowerCase() },
      { key: 'bn', header: t('prod.nameBn'), render: (x) => x.nameBn || '-' },
      { key: 'n', header: t('nav.products'), right: true, render: (x) => i18n.int(count(x.id)), sortValue: (x) => count(x.id) },
      {
        key: 'act', header: '', right: true,
        render: (x) => (
          <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => setModal({ kind, item: x })} data-testid={`${kind}-rename-${x.id}`}>{t('prod.rename')}</Button>
            <Button size="sm" variant="ghost" onClick={() => archive(kind, x)} data-testid={`${kind}-archive-${x.id}`}>{x.status === 'active' ? t('act.archive') : t('act.restore')}</Button>
          </span>
        )
      }
    ];
    return (
      <Card title={kind === 'category' ? t('prod.categories') : t('prod.brands')} actions={<Button size="sm" variant="primary" onClick={() => setModal({ kind, item: null })} data-testid={`add-${kind}`}>{kind === 'category' ? t('prod.addCategory') : t('prod.addBrand')}</Button>}>
        <Table columns={cols} rows={list} rowKey={(x) => x.id} pageSize={50} empty={<EmptyState title={kind === 'category' ? t('prod.noCategories') : t('prod.noBrands')} />} />
      </Card>
    );
  };
  return (
    <div className="grid" style={{ gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', alignItems: 'start' }} data-testid="lookups-tab">
      {section('category', lookups.categories)}
      {section('brand', lookups.brands)}
      <LookupModal kind={modal?.kind ?? null} item={modal?.item ?? null} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChanged(); }} />
    </div>
  );
}
