import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRequest } from '../../ui/requestId';
import { formatBoxPcs, fromBnDigits, type ProductDto, type SupplierProductDto } from '@petra/core';
import { call, errorCode, errorParams, errorText } from '../../api';
import { useI18n, type I18n } from '../../i18n';
import { useApp } from '../../store/app';
import { Button, Card, Checkbox, DateInput, EmptyState, Field, Input, MoneyInput, ProductPicker, QtyInput, Select, Textarea, packLabel, productName, stockText, toast, useQuery } from '../../ui';
import { DiscountInput } from '../pos/DiscountInput';
import {
  hasQty, makeRow, packOf, rowAmount, rowProblem, rowTouched, stockAfter, summarize, toSaveLines,
  type BillFields, type GridRow, type PurchaseDraft
} from './grid';
import { AddManyModal } from './AddManyModal';
import { PasteModal, type PastedLine } from './PasteModal';

/** Columns that take keyboard focus, in order: Enter moves right, the arrows move up and down. */
const COLS = ['pack', 'box', 'pcs', 'cost', 'disc', 'freeBox', 'freePcs', 'batch', 'expiry'] as const;
const col = (name: (typeof COLS)[number]): number => COLS.indexOf(name);

/** Linked rows first in the company's order, then everything else the user added or typed into. Untouched rows of another company drop out. */
function mergeLinked(rows: GridRow[], links: SupplierProductDto[], byId: Map<number, ProductDto>): GridRow[] {
  const kept = rows.filter(rowTouched);
  // reuse every existing row of a linked product (same key), so a re-run never remounts the row being typed in
  const have = new Map(rows.map((r) => [r.productId, r]));
  const out: GridRow[] = [];
  const used = new Set<number>();
  for (const l of links) {
    const p = byId.get(l.productId);
    if (!p || p.status !== 'active') continue;
    const r = have.get(l.productId);
    out.push(r ? { ...r, linked: true } : makeRow(p, l, true));
    used.add(l.productId);
  }
  for (const r of kept) if (!used.has(r.productId)) out.push({ ...r, linked: false });
  return out;
}

export function NewPurchase({ onDone, onCancel }: { onDone: (saved: { id: number; docNo: string } | null) => void; onCancel: () => void }) {
  const i18n = useI18n();
  const { t, money } = i18n;
  const today = useApp((s) => s.status?.businessDate ?? '');
  const showCharges = useApp((s) => s.status?.settings.purchaseCharges ?? false);
  const productsQ = useQuery('catalog:products', { includeArchived: false });
  const suppliers = useQuery('catalog:suppliers', { includeArchived: false });
  const lookups = useQuery('catalog:lookups', undefined);
  const accounts = useQuery('money:accounts', undefined);
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(today);
  const [ref, setRef] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [bill, setBill] = useState<BillFields>({ discKind: 'fixed', disc: null, tax: null, freight: null });
  const [paid, setPaid] = useState<number | null>(0);
  const [paidTouched, setPaidTouched] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [dupDoc, setDupDoc] = useState<string | null>(null);
  const [dupReason, setDupReason] = useState('');
  const [search, setSearch] = useState('');
  const [catId, setCatId] = useState<number | null>(null);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [onlyQty, setOnlyQty] = useState(false);
  const [addMany, setAddMany] = useState(false);
  const [paste, setPaste] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const req = useRequest();
  const [loaded, setLoaded] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const links = useQuery('supplier:products', { supplierId: supplierId ?? 1 }, supplierId !== null);

  // ----- restore the autosaved draft once the catalog is in -----
  const loadStarted = useRef(false);
  useEffect(() => {
    if (loaded || loadStarted.current || !productsQ.data) return;
    loadStarted.current = true;
    void call('purchase:draftGet').then((d) => {
      if (d.payload) {
        try {
          const dr = JSON.parse(d.payload) as PurchaseDraft;
          if (dr.v === 1) {
            setSupplierId(dr.supplierId);
            setDate(dr.date ?? today);
            setRef(dr.ref);
            setInvoiceDate(dr.invoiceDate);
            setDueDate(dr.dueDate);
            setBill(dr.bill);
            setPaid(dr.paid);
            setPaidTouched(dr.paidTouched);
            setAccountId(dr.accountId);
            setNote(dr.note);
            setDupReason(dr.dupReason);
            setRows(dr.rows.filter((r) => byId.has(r.productId)).map((r) => ({ ...makeRow(byId.get(r.productId)!), ...r })));
            toast.ok(t('pur.draftRestored'));
          }
        } catch {
          /* an unreadable draft is ignored */
        }
      }
      setLoaded(true);
    }, () => setLoaded(true));
  }, [loaded, productsQ.data, byId, today, t]);

  // ----- the company's linked products fill the grid -----
  const linkKey = links.data ? `${supplierId}:${links.data.length}` : '';
  useEffect(() => {
    if (!loaded) return;
    if (supplierId === null) {
      setRows((rs) => rs.filter(rowTouched).map((r) => ({ ...r, linked: false })));
      return;
    }
    if (links.data) setRows((rs) => mergeLinked(rs, links.data!, byId));
  }, [linkKey, supplierId, loaded, byId]);

  // ----- autosave (power cuts lose nothing) -----
  useEffect(() => {
    if (!loaded) return;
    const h = window.setTimeout(() => {
      const kept = rows.filter(rowTouched);
      if (kept.length === 0 && supplierId === null && !ref) { void call('purchase:draftClear'); return; }
      const draft: PurchaseDraft = { v: 1, supplierId, date, ref, invoiceDate, dueDate, bill, paid, paidTouched, accountId, note, dupReason, rows: kept.map(({ key: _key, ...r }) => r) };
      void call('purchase:draftSave', { payload: JSON.stringify(draft) });
    }, 500);
    return () => window.clearTimeout(h);
  }, [loaded, rows, supplierId, date, ref, invoiceDate, dueDate, bill, paid, paidTouched, accountId, note, dupReason]);

  // ----- repeated company invoice number -----
  useEffect(() => {
    setDupDoc(null);
    if (!supplierId || !ref.trim()) return;
    const h = window.setTimeout(() => {
      void call('purchase:checkRef', { supplierId, ref: ref.trim() }).then((r) => setDupDoc(r.docNo), () => setDupDoc(null));
    }, 300);
    return () => window.clearTimeout(h);
  }, [supplierId, ref]);

  const summary = useMemo(() => summarize(rows, byId, bill), [rows, byId, bill]);
  const total = summary.calc?.total ?? 0;
  useEffect(() => {
    if (!paidTouched || supplierId === null) setPaid(total);
  }, [total, supplierId, paidTouched]);
  const paidVal = paid ?? 0;
  const due = total - paidVal;
  const active = rows.filter(hasQty);
  const problems = active.filter((r) => { const p = byId.get(r.productId); return !p || rowProblem(r, p) !== null; });
  const valid = active.length > 0 && problems.length === 0 && summary.calc !== null && date !== null && paidVal <= total && (supplierId !== null || due === 0) && (!dupDoc || dupReason.trim() !== '');

  const update = useCallback((key: string, patch: Partial<GridRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))), []);
  const remove = useCallback((key: string) => setRows((rs) => rs.filter((r) => r.key !== key)), []);

  const focusCell = (rowIdx: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${rowIdx}:${c}"]`);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
      return true;
    }
    return false;
  };

  const addProducts = (ids: number[], focus = true) => {
    let first: string | null = null;
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.productId));
      const add: GridRow[] = [];
      for (const id of ids) {
        const p = byId.get(id);
        if (!p || have.has(id)) continue;
        const r = makeRow(p, links.data?.find((l) => l.productId === id) ?? null, false);
        add.push(r);
        first ??= r.key;
      }
      return [...rs, ...add];
    });
    if (focus) {
      setOnlyQty(false);
      window.setTimeout(() => {
        const all = tableRef.current?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-product]');
        const target = [...(all ?? [])].find((tr) => Number(tr.dataset.product) === ids[0]);
        target?.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
      }, 30);
    }
  };

  const mergePasted = (lines: PastedLine[]) => {
    setRows((rs) => {
      const out = [...rs];
      for (const l of lines) {
        const p = byId.get(l.productId);
        if (!p) continue;
        const i = out.findIndex((r) => r.productId === l.productId);
        const base = i >= 0 ? out[i]! : makeRow(p, links.data?.find((x) => x.productId === l.productId) ?? null, false);
        const next = { ...base, box: l.box || null, pcs: l.pcs || null, cost: l.cost ?? base.cost };
        if (i >= 0) out[i] = next;
        else out.push(next);
      }
      return out;
    });
    toast.ok(t('pur.pasteAdded', { n: lines.length }));
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.map((r, idx) => ({ r, idx })).filter(({ r }) => {
      const p = byId.get(r.productId);
      if (!p) return false;
      if (onlyQty && !hasQty(r)) return false;
      if (catId && p.categoryId !== catId) return false;
      if (brandId && p.brandId !== brandId) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.nameBn.includes(search.trim()) || p.sku.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, byId, onlyQty, catId, brandId, search]);

  const onGridKey = (e: ReactKeyboardEvent<HTMLTableElement>) => {
    const el = e.target as HTMLElement;
    const cell = el.dataset.cell;
    if (!cell || e.ctrlKey || e.altKey || e.metaKey) return;
    const [r, c] = cell.split(':').map(Number) as [number, number];
    const order = visible.map((v) => v.idx);
    const pos = order.indexOf(r);
    if (e.key === 'Enter') {
      e.preventDefault();
      for (let k = c + 1; k < COLS.length; k++) if (focusCell(r, k)) return;
      const nr = order[pos + 1];
      if (nr !== undefined) for (let k = 0; k < COLS.length; k++) if (focusCell(nr, k === 0 ? col('box') : k)) return;
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el.tagName !== 'SELECT') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      for (let p = pos + step; p >= 0 && p < order.length; p += step) if (focusCell(order[p]!, c)) return;
    }
  };

  const save = (): Promise<void> => {
    if (!valid || busy) return Promise.resolve();
    // a ref guard: a double click, a double F9 or Ctrl+S cannot start two saves
    return req.guard(saveOnce).then(() => undefined);
  };
  const saveOnce = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('purchase:save', {
        supplierId, supplierRef: ref, date: date!, invoiceDate, dueDate,
        discKind: bill.disc ? bill.discKind : null, discValue: bill.disc ?? 0, tax: bill.tax ?? 0, freight: bill.freight ?? 0,
        paid: paidVal, accountId: paidVal > 0 ? accountId : null, note, duplicateReason: dupDoc ? dupReason : '',
        lines: toSaveLines(rows, byId), requestId: req.id()
      });
      req.renew();
      toast.ok(`${t('pur.saved')} ${r.docNo}`);
      onDone({ id: r.id, docNo: r.docNo });
    } catch (e) {
      if (errorCode(e) === 'DUPLICATE_INVOICE') setDupDoc(String(errorParams(e).docNo ?? dupDoc ?? ''));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    void call('purchase:draftClear');
    onCancel();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key.toLowerCase() === 's') || e.key === 'F9') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cats = (lookups.data?.categories ?? []).filter((c) => c.status === 'active');
  const brands = (lookups.data?.brands ?? []).filter((c) => c.status === 'active');
  const calc = summary.calc;

  return (
    <div>
      <div className="page-h">
        <h2>{t('pur.new')}</h2>
        <div className="row">
          <Button onClick={onCancel} data-testid="purchase-back">{t('act.back')}</Button>
          <Button variant="ghost" onClick={discard} data-testid="purchase-discard">{t('pur.discard')}</Button>
          <Button variant="primary" kbd="F9" disabled={!valid || busy} onClick={() => void save()} data-testid="purchase-save">{t('act.save')}</Button>
        </div>
      </div>
      <Card>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Field label={t('pur.company')}>
            {(a) => (
              <Select id={a.id} value={supplierId ?? ''} onChange={(e) => { setSupplierId(e.target.value ? Number(e.target.value) : null); setPaidTouched(false); }} data-testid="purchase-supplier">
                <option value="">{t('pur.cash')}</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('pur.receivedOn')} required>{(a) => <DateInput id={a.id} value={date} onChange={setDate} />}</Field>
          <Field label={t('pur.supplierRef')}>{(a) => <Input id={a.id} value={ref} onChange={(e) => setRef(e.target.value)} invalid={!!dupDoc} data-testid="purchase-ref" />}</Field>
          <Field label={t('pur.invoiceDate')}>{(a) => <DateInput id={a.id} value={invoiceDate} onChange={setInvoiceDate} />}</Field>
          <Field label={t('pur.dueDate')}>{(a) => <DateInput id={a.id} value={dueDate} onChange={setDueDate} />}</Field>
        </div>
        {dupDoc && (
          <div className="pur-dup" role="alert" data-testid="purchase-dup">
            <div>{t('pur.dupWarn', { doc: dupDoc })}</div>
            <Field label={t('pur.dupReason')} required>{(a) => <Input id={a.id} value={dupReason} onChange={(e) => setDupReason(e.target.value)} data-testid="purchase-dup-reason" />}</Field>
          </div>
        )}
      </Card>

      <div className="p-toolbar pur-tools" style={{ marginTop: 12 }}>
        <Input placeholder={t('pur.filterHint')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('pur.filter')} style={{ maxWidth: 220 }} data-testid="grid-search" />
        <Select aria-label={t('prod.category')} value={catId ?? ''} onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 170 }}>
          <option value="">{t('pur.allCategories')}</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{i18n.lang === 'bn' && c.nameBn ? c.nameBn : c.name}</option>)}
        </Select>
        <Select aria-label={t('prod.brand')} value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 170 }}>
          <option value="">{t('pur.allBrands')}</option>
          {brands.map((c) => <option key={c.id} value={c.id}>{i18n.lang === 'bn' && c.nameBn ? c.nameBn : c.name}</option>)}
        </Select>
        <Checkbox label={t('pur.onlyQty')} checked={onlyQty} onChange={(e) => setOnlyQty(e.target.checked)} data-testid="grid-only-qty" />
        <span className="spacer" />
        <Button onClick={() => setAddMany(true)} data-testid="add-many">{t('pur.addMany')}</Button>
        <Button onClick={() => setPaste(true)} data-testid="paste-open">{t('pur.paste')}</Button>
        <div style={{ width: 240 }}><ProductPicker products={products} onPick={(p) => addProducts([p.id])} placeholder={t('pur.pickHint')} autoFocus={supplierId === null} /></div>
      </div>

      <div className="pur-grid-wrap">
        {rows.length === 0 ? (
          <EmptyState title={supplierId ? t('pur.noLinked') : t('pur.noLines')} body={supplierId ? t('pur.noLinkedBody') : t('pur.noLinesBody')} />
        ) : (
          <table className="lines pur-grid" ref={tableRef} onKeyDown={onGridKey} data-testid="purchase-lines">
            <thead>
              <tr>
                <th>{t('word.name')}</th>
                <th style={{ width: 118 }}>{t('pur.box')}</th>
                <th className="right" style={{ width: 70 }}>{t('pur.boxQty')}</th>
                <th className="right" style={{ width: 70 }}>{t('pur.pcsQty')}</th>
                <th className="right" style={{ width: 112 }}>{t('pur.costPerBox')}</th>
                <th style={{ width: 128 }}>{t('word.discount')}</th>
                <th className="right" style={{ width: 64 }}>{t('pur.freeBox')}</th>
                <th className="right" style={{ width: 64 }}>{t('pur.freePcs')}</th>
                <th style={{ width: 132 }}>{t('pur.batchExpiry')}</th>
                <th className="right" style={{ width: 110 }}>{t('word.amount')}</th>
                <th className="right" style={{ width: 110 }}>{t('pur.stockAfter')}</th>
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ r, idx }) => <GridLine key={r.key} row={r} idx={idx} product={byId.get(r.productId)!} i18n={i18n} onChange={update} onRemove={remove} />)}
            </tbody>
          </table>
        )}
        {rows.length > 0 && visible.length === 0 && <p className="muted">{t('state.noResults')}</p>}
      </div>

      <div className="row pur-foot" style={{ alignItems: 'flex-start', marginTop: 16, gap: 24 }}>
        <div className="grid" style={{ flex: 1, gap: 12 }}>
          <div className="pur-counts" data-testid="purchase-counts">
            <span>{t('pur.lineCount')}: <strong className="num">{i18n.int(summary.lineCount)}</strong></span>
            <span>{t('pur.totalBoxes')}: <strong className="num">{i18n.int(summary.boxes)}</strong></span>
            <span>{t('pur.totalPcs')}: <strong className="num">{i18n.int(summary.pcs)}</strong></span>
          </div>
          {problems.length > 0 && <div className="p-error" data-testid="purchase-problems">{t('pur.rowProblems', { n: problems.length })}</div>}
          <Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          {error && <div className="p-error shake" role="alert" data-testid="purchase-error">{error}</div>}
        </div>
        <div className="totals">
          <div className="row"><span>{t('word.subtotal')}</span><span className="num" data-testid="purchase-subtotal">{money(calc?.subtotal ?? 0, { fixed: true })}</span></div>
          <div className="row"><span>{t('pur.billDiscount')}</span><div style={{ width: 170 }}><DiscountInput kind={bill.discKind} value={bill.disc ?? 0} onChange={(k, v) => setBill((b) => ({ ...b, discKind: k ?? b.discKind, disc: v || null }))} label={t('pur.billDiscount')} testId="purchase-discount" /></div></div>
          {(showCharges || (bill.tax ?? 0) > 0) && <div className="row"><span>{t('pur.charge')}</span><div style={{ width: 150 }}><MoneyInput aria-describedby={undefined} value={bill.tax} onChange={(v) => setBill((b) => ({ ...b, tax: v }))} data-testid="purchase-tax" /></div></div>}
          <div className="row"><span>{t('pur.freight')}</span><div style={{ width: 150 }}><MoneyInput aria-describedby={undefined} value={bill.freight} onChange={(v) => setBill((b) => ({ ...b, freight: v }))} data-testid="purchase-freight" /></div></div>
          {calc && calc.discount > 0 && <div className="row muted"><span>{t('word.discount')}</span><span className="num">−{money(calc.discount, { fixed: true })}</span></div>}
          <div className="row grand"><span>{t('word.total')}</span><span className="num" data-testid="purchase-total">{money(total, { fixed: true })}</span></div>
          <div className="row"><span>{t('word.paid')}</span><div style={{ width: 150 }}><MoneyInput aria-describedby={undefined} value={paid} onChange={(v) => { setPaid(v); setPaidTouched(true); }} invalid={paidVal > total} data-testid="purchase-paid" /></div></div>
          {paidVal > 0 && (
            <div className="row"><span>{t('pay.account')}</span>
              <div style={{ width: 150 }}><Select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)} aria-label={t('pay.account')}><option value="">{t('pay.defaultAccount')}</option>{(accounts.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
            </div>
          )}
          <div className="row"><span>{t('word.due')}</span><span className="num" data-testid="purchase-due">{money(due, { fixed: true })}</span></div>
          {supplierId === null && due !== 0 && <div className="p-error">{t('pur.cashMustPay')}</div>}
          {summary.error && <div className="p-error">{t('pur.discountTooBig')}</div>}
        </div>
      </div>
      <AddManyModal open={addMany} products={products} already={new Set(rows.map((r) => r.productId))} onClose={() => setAddMany(false)} onAdd={(ids) => { setAddMany(false); addProducts(ids, false); toast.ok(t('pur.addedMany', { n: ids.length })); }} />
      <PasteModal open={paste} products={products} onClose={() => setPaste(false)} onAdd={(lines) => { setPaste(false); mergePasted(lines); }} />
    </div>
  );
}

const GridLine = memo(function GridLine({ row: r, idx, product: p, i18n, onChange, onRemove }: { row: GridRow; idx: number; product: ProductDto; i18n: I18n; onChange: (key: string, patch: Partial<GridRow>) => void; onRemove: (key: string) => void }) {
  const { t, money } = i18n;
  const pack = packOf(p, r.packId);
  const boxed = pack.factor > 1;
  const amount = rowAmount(r, p);
  const problem = rowProblem(r, p);
  const set = (patch: Partial<GridRow>) => onChange(r.key, patch);
  const cell = (c: (typeof COLS)[number]) => `${idx}:${col(c)}`;
  const after = stockAfter(r, p);
  return (
    <tr data-product={p.id} className={hasQty(r) ? 'has-qty' : undefined}>
      <td>
        <strong>{productName(i18n.lang, p)}</strong>
        <br /><small className="muted">{p.sku} · {t('nav.stock')}: {stockText(i18n, p, p.stockQty)}</small>
      </td>
      <td>
        <Select aria-label={t('pur.box')} value={r.packId} data-cell={cell('pack')} onChange={(e) => {
          const np = packOf(p, Number(e.target.value));
          // keep the price per piece when switching between box and pieces
          set({ packId: np.id, cost: r.cost === null ? null : Math.round((r.cost * np.factor) / pack.factor) });
        }}>
          {p.packs.map((k) => <option key={k.id} value={k.id}>{packLabel(i18n, k)}{k.factor > 1 ? ` (${i18n.n(k.factor)})` : ''}</option>)}
        </Select>
      </td>
      <td><QtyInput aria-label={t('pur.boxQty')} value={boxed ? r.box : null} disabled={!boxed} onChange={(v) => set({ box: v })} data-cell={cell('box')} data-testid={`line-box-${idx}`} /></td>
      <td><QtyInput aria-label={t('pur.pcsQty')} value={r.pcs} onChange={(v) => set({ pcs: v })} data-cell={cell('pcs')} data-testid={`line-pcs-${idx}`} /></td>
      <td><MoneyInput aria-label={t('pur.costPerBox')} value={r.cost} onChange={(v) => set({ cost: v })} invalid={problem === 'cost'} data-cell={cell('cost')} data-testid={`line-cost-${idx}`} /></td>
      <td>
        <div className="disc">
          <Select aria-label={t('word.discount')} value={r.discKind} onChange={(e) => set({ discKind: e.target.value as 'pct' | 'fixed', disc: null })}>
            <option value="pct">%</option>
            <option value="fixed">৳</option>
          </Select>
          {r.discKind === 'pct'
            ? <PctInput value={r.disc} onChange={(v) => set({ disc: v })} cellId={cell('disc')} testId={`line-disc-${idx}`} label={t('word.discount')} />
            : <MoneyInput aria-label={t('word.discount')} value={r.disc} onChange={(v) => set({ disc: v })} data-cell={cell('disc')} data-testid={`line-disc-${idx}`} />}
        </div>
      </td>
      <td><QtyInput aria-label={t('pur.freeBox')} value={boxed ? r.freeBox : null} disabled={!boxed} onChange={(v) => set({ freeBox: v })} data-cell={cell('freeBox')} data-testid={`line-freebox-${idx}`} /></td>
      <td><QtyInput aria-label={t('pur.freePcs')} value={r.freePcs} onChange={(v) => set({ freePcs: v })} data-cell={cell('freePcs')} data-testid={`line-freepcs-${idx}`} /></td>
      <td>
        {p.trackExpiry ? (
          <div className="grid" style={{ gap: 4 }}>
            <Input aria-label={t('pur.batchNo')} placeholder={t('pur.batchNo')} value={r.batchNo} onChange={(e) => set({ batchNo: e.target.value })} data-cell={cell('batch')} data-testid={`line-batch-${idx}`} />
            <DateInput aria-describedby={undefined} value={r.expiry} onChange={(v) => set({ expiry: v })} invalid={problem === 'expiry'} data-cell={cell('expiry')} data-testid={`line-expiry-${idx}`} />
          </div>
        ) : <span className="muted">-</span>}
      </td>
      <td className="right num" data-testid={`line-amount-${idx}`}>{amount === null ? '' : money(amount, { fixed: true })}</td>
      <td className="right num" data-testid={`line-after-${idx}`}>{hasQty(r) ? i18n.n(formatBoxPcs(after, pack.factor, { boxName: packLabel(i18n, pack), pcsName: p.baseUnit }, { sep: ' ' })) : ''}</td>
      <td>{!r.linked && <button type="button" className="p-btn ghost icon" aria-label={t('act.delete')} onClick={() => onRemove(r.key)}>×</button>}</td>
    </tr>
  );
});

/** Percent with up to two decimals, reported as basis points. */
function PctInput({ value, onChange, cellId, testId, label }: { value: number | null; onChange: (bp: number | null) => void; cellId: string; testId: string; label: string }) {
  const show = (v: number | null) => (v === null ? '' : String(v / 100));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const cur = parse(text);
    if (cur !== value) setText(show(value));
  }, [value]);
  function parse(s: string): number | null {
    const v = fromBnDigits(s.trim()).replace(',', '.');
    if (!v) return null;
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return null;
    const bp = Math.round(Number(v) * 100);
    return bp <= 10000 ? bp : null;
  }
  return <Input numeric inputMode="decimal" aria-label={label} value={text} placeholder="0" invalid={text.trim() !== '' && parse(text) === null} data-cell={cellId} data-testid={testId} onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }} />;
}
