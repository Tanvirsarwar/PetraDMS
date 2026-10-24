import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useRequest } from '../ui/requestId';
import { PetraError, fromBnDigits, toBnDigits, type CustomerDto, type ProductDto, type SaleDetail } from '@petra/core';
import { call, errorText, errorCode, errorParams } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import {
  ApprovalModal, Badge, Button, CheckMark, CustomerPicker, EmptyState, Field, Input, Modal, MoneyInput, PrintActions, ProductPicker, QtyInput, Select, Stamp, Textarea, packLabel, productName, stockText, toast, useQuery
} from '../ui';
import { DiscountInput } from './pos/DiscountInput';
import { basePackOf, customerTier, defaultSalePackOf, demandFor, emptyCart, expandLines, isBoxed, lineBaseQty, lineOk, parseBoxPcs, parseCart, serialiseCart, tierPriceOf, totalsOf, type CartLine, type CartState } from './pos/cart';

interface Done {
  id: number;
  docNo: string;
  total: number;
  due: number;
}

/** The screen staff live in (plan 8.3): product search, cart with inline pack / qty / price / discount, bonus goods, payment, drafts. */
export function Pos({ edit, onEditDone }: { edit?: SaleDetail | null; onEditDone?: () => void }) {
  const i18n = useI18n();
  const { t, money, n } = i18n;
  const status = useApp((s) => s.status);
  const role = status?.session?.role ?? 'staff';
  const today = status?.businessDate ?? '';
  const settings = status!.settings;
  const productsQ = useQuery('catalog:products', { includeArchived: false });
  const customersQ = useQuery('customer:list', { includeArchived: false });
  const accountsQ = useQuery('money:accounts', undefined);
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const customers = customersQ.data ?? [];

  const [cart, setCart] = useState<CartState>(emptyCart());
  const [loaded, setLoaded] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerAdd, setCustomerAdd] = useState(false);
  const [approval, setApproval] = useState<{ reason: string; after: (token: string) => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const req = useRequest();
  const [done, setDone] = useState<Done | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);
  const keyN = useRef(1000);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const qtyRefs = useRef(new Map<number, HTMLInputElement | null>());
  const touchedDiscount = useRef(false);

  const customer: CustomerDto | null = customers.find((c) => c.id === cart.customerId) ?? null;
  const tier = customerTier(customer);
  const totals = useMemo(() => totalsOf(cart, settings.taxBp, settings.roundOff, byId), [cart, settings.taxBp, settings.roundOff, byId]);
  const total = totals.total;
  // Walk-in sales are paid in full. For a customer the paid amount starts at 0 (khata) until the cashier types one.
  const paid = customer ? (cart.paid ?? 0) : total;
  const due = total - paid;
  const projected = customer ? customer.balance + (edit ? 0 : 0) + due : 0;
  const overLimit = !!customer && customer.creditLimit > 0 && due > 0 && projected > customer.creditLimit;

  // ----- load: edit mode builds the cart from the invoice, otherwise restore the autosaved draft -----
  // the load runs once: a second draft read finishing late would overwrite what the cashier typed since
  const loadStarted = useRef(false);
  useEffect(() => {
    if (loaded || loadStarted.current || !productsQ.data || !customersQ.data) return;
    loadStarted.current = true;
    if (edit) {
      const lines: CartLine[] = [];
      for (const it of edit.items) {
        const p = byId.get(it.productId);
        if (!p) continue;
        // a box line followed by loose pieces of the same product (same kind and discount) was one "2 Box 5 Pcs" line
        const prev = lines[lines.length - 1];
        if (prev && prev.productId === it.productId && prev.kind === it.kind && it.factor === 1 && isBoxed(p, prev) && !prev.pcs && (it.discKind === null || (it.discKind === prev.discKind && it.discValue === prev.discValue))) {
          prev.pcs = it.qty;
          prev.pcsPrice = it.price;
          continue;
        }
        lines.push({ key: keyN.current++, productId: p.id, packId: it.packId ?? basePackOf(p), qty: it.qty, price: it.price, discKind: it.discKind, discValue: it.discValue, kind: it.kind, pcs: null, pcsPrice: tierPriceOf(p, basePackOf(p), edit.priceTier) });
      }
      setCart({ customerId: edit.customerId, lines, discKind: edit.discKind, discValue: edit.discValue, paid: edit.paid, accountId: null, note: edit.note });
      setLoaded(true);
      return;
    }
    void call('draft:get').then((d) => {
      if (d.payload) {
        const c = parseCart(d.payload, products);
        if (c && (c.lines.length > 0 || c.customerId)) {
          setCart({ ...c, lines: c.lines.map((l) => ({ ...l, key: keyN.current++ })) });
          toast.ok(t('pos.draftRestored'));
        }
      }
      setLoaded(true);
    });
  }, [loaded, productsQ.data, customersQ.data, edit, byId, products, t]);

  // ----- autosave to sale_drafts on every change (power cuts lose nothing) -----
  useEffect(() => {
    if (!loaded || edit || done) return;
    const h = window.setTimeout(() => {
      if (cart.lines.length === 0 && !cart.customerId) void call('draft:clear');
      else void call('draft:save', { payload: serialiseCart(cart) });
    }, 350);
    return () => window.clearTimeout(h);
  }, [cart, loaded, edit, done]);

  const upd = useCallback((patch: Partial<CartState>) => setCart((c) => ({ ...c, ...patch })), []);
  const updLine = useCallback((key: number, patch: Partial<CartLine>) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })), []);

  const addProduct = (p: ProductDto, kind: 'normal' | 'bonus' = 'normal', pack?: number) => {
    setCart((c) => {
      const packId = pack ?? defaultSalePackOf(p);
      // Scanning or picking the same product again adds one more instead of a duplicate row.
      const existing = kind === 'normal' ? c.lines.find((l) => l.productId === p.id && l.packId === packId && l.kind === 'normal' && l.discValue === 0) : undefined;
      if (existing) {
        setFocusKey(existing.key);
        return { ...c, lines: c.lines.map((l) => (l.key === existing.key ? { ...l, qty: (l.qty ?? 0) + 1 } : l)) };
      }
      const key = keyN.current++;
      setFocusKey(key);
      return { ...c, lines: [...c.lines, { key, productId: p.id, packId, qty: 1, price: kind === 'bonus' ? 0 : tierPriceOf(p, packId, tier), discKind: null, discValue: 0, kind, pcs: null, pcsPrice: kind === 'bonus' ? 0 : tierPriceOf(p, basePackOf(p), tier) }] };
    });
  };

  useEffect(() => {
    if (focusKey === null) return;
    const el = qtyRefs.current.get(focusKey);
    if (el) {
      el.focus();
      el.select();
    }
    setFocusKey(null);
  }, [focusKey, cart.lines.length]);

  const chooseCustomer = (c: CustomerDto | null) => {
    setCart((cur) => {
      const tr = customerTier(c);
      return {
        ...cur,
        customerId: c?.id ?? null,
        paid: null,
        // Re-price untouched lines at the new customer's tier; a typed price is kept.
        lines: cur.lines.map((l) => {
          const p = byId.get(l.productId);
          if (!p || l.kind === 'bonus') return l;
          const oldTier = customerTier(customers.find((x) => x.id === cur.customerId) ?? null);
          const oldAuto = tierPriceOf(p, l.packId, oldTier);
          const oldPcs = tierPriceOf(p, basePackOf(p), oldTier);
          return {
            ...l,
            price: l.price === oldAuto ? tierPriceOf(p, l.packId, tr) : l.price,
            pcsPrice: (l.pcsPrice ?? oldPcs) === oldPcs ? tierPriceOf(p, basePackOf(p), tr) : l.pcsPrice
          };
        }),
        discKind: !touchedDiscount.current && c && c.defaultDiscountBp > 0 ? 'pct' : cur.discKind,
        discValue: !touchedDiscount.current && c && c.defaultDiscountBp > 0 ? c.defaultDiscountBp : cur.discValue
      };
    });
    window.setTimeout(() => search.current?.focus(), 50);
  };

  const reset = () => {
    setCart(emptyCart());
    setDone(null);
    setError(null);
    touchedDiscount.current = false;
    void call('draft:clear');
    window.setTimeout(() => search.current?.focus(), 80);
  };

  const stockIssues = useMemo(() => {
    const out = new Map<number, string>();
    if (settings.allowNegativeStock) return out;
    for (const l of cart.lines) {
      const p = byId.get(l.productId);
      if (!p) continue;
      const need = demandFor(cart, byId, l.productId);
      if (need > p.stockQty) out.set(l.key, t('pos.onlyHave', { qty: stockText(i18n, p, p.stockQty) }));
    }
    return out;
  }, [cart, byId, settings.allowNegativeStock, t, i18n]);

  const lineProblems = cart.lines.some((l) => !lineOk(byId.get(l.productId), l));
  const canSave = cart.lines.length > 0 && !lineProblems && stockIssues.size === 0 && paid <= total && (customer !== null || due === 0) && !busy;

  const body = (approvalToken?: string) => ({
    customerId: cart.customerId,
    lines: expandLines(cart.lines, byId).map((l) => ({
      kind: l.kind, productId: l.productId, packId: l.packId, qty: l.qty, ...(l.kind === 'normal' ? { price: l.price } : {}),
      discKind: l.kind === 'normal' ? l.discKind : null, discValue: l.kind === 'normal' ? l.discValue : 0
    })),
    discKind: cart.discKind, discValue: cart.discValue, paid, accountId: paid > 0 ? cart.accountId : null, note: cart.note, priceTier: tier,
    ...(approvalToken ? { approvalToken } : {})
  });

  const submit = (printAfter: boolean, approvalToken?: string, editReason?: string): Promise<void> => {
    if (!canSave) return Promise.resolve();
    // a ref guard: a double click or double Enter in the same frame cannot start two saves
    return req.guard(() => submitOnce(printAfter, approvalToken, editReason)).then(() => undefined);
  };

  const submitOnce = async (printAfter: boolean, approvalToken?: string, editReason?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = edit
        ? await call('sale:edit', { id: edit.id, reason: editReason ?? '', ...body(approvalToken) })
        : await call('sale:save', { date: today, requestId: req.id(), ...body(approvalToken) });
      if (!edit) req.renew();
      if (r.warnings.includes('credit_limit')) toast.error(t('pos.creditWarn'));
      if (edit) {
        toast.ok(t('pos.edited', { no: r.docNo }));
        onEditDone?.();
        return;
      }
      setDone({ id: r.id, docNo: r.docNo, total: r.total, due: r.due });
      productsQ.reload();
      customersQ.reload();
      if (role !== 'staff') toast.withUndo(`${t('pos.saved')} ${r.docNo}`, () => {
        void call('sale:void', { id: r.id, reason: t('pos.undoReason') }).then(() => { toast.ok(t('pos.undone')); productsQ.reload(); customersQ.reload(); }, (e: unknown) => toast.error(errorText(e)));
      });
      else toast.ok(`${t('pos.saved')} ${r.docNo}`);
      if (printAfter) void call('print:run', { doc: { type: 'invoice', id: r.id }, action: 'print' }).catch((e: unknown) => toast.error(errorText(e)));
    } catch (e) {
      if (errorCode(e) === 'APPROVAL_REQUIRED' && role === 'staff') {
        setApproval({ reason: String(errorParams(e).reason ?? 'min_price'), after: (token) => { setApproval(null); void submit(printAfter, token, editReason); } });
      } else {
        setError(errorText(e));
        if (e instanceof PetraError) void 0;
      }
    } finally {
      setBusy(false);
    }
  };

  const startSave = (printAfter: boolean) => {
    if (edit) setReasonOpen(true);
    else void submit(printAfter);
  };

  useEffect(() => {
    const onScan = (e: Event) => {
      const d = (e as CustomEvent<{ code: string; handled: boolean }>).detail;
      if (done) return;
      d.handled = true;
      const code = d.code.trim().toLowerCase();
      // a box's own barcode adds a box; a product barcode or SKU adds the default unit
      const byPack = products.find((x) => x.packs.some((k) => (k.barcode ?? '').toLowerCase() === code));
      const p = byPack ?? products.find((x) => x.barcodes.some((b) => b.toLowerCase() === code) || x.sku.toLowerCase() === code);
      if (p) addProduct(p, 'normal', byPack ? byPack.packs.find((k) => (k.barcode ?? '').toLowerCase() === code)!.id : undefined);
      else toast.error(t('pos.scanUnknown', { code: d.code }));
    };
    window.addEventListener('petra:barcode', onScan);
    return () => window.removeEventListener('petra:barcode', onScan);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) {
        if (e.key === 'F2') { e.preventDefault(); reset(); }
        return;
      }
      if (e.key === 'F3') { e.preventDefault(); setCustomerAdd(false); setCustomerOpen(true); }
      else if (e.key === 'F4') { e.preventDefault(); search.current?.focus(); search.current?.select(); }
      else if (e.key === 'F8') { e.preventDefault(); paidRef.current?.focus(); paidRef.current?.select(); }
      else if (e.key === 'F9') { e.preventDefault(); startSave(true); }
      else if ((e.ctrlKey && e.key.toLowerCase() === 's')) { e.preventDefault(); startSave(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const favourites = useMemo(() => {
    const fav = products.filter((p) => p.favourite);
    return (fav.length > 0 ? fav : products).slice(0, 12);
  }, [products]);

  return (
    <div>
      <div className="pos-top">
        <div className="cust">
          <small className="muted">{t('nav.customers')} (F3)</small>
          <div className="row" style={{ gap: 6 }}>
            <Button onClick={() => { setCustomerAdd(false); setCustomerOpen(true); }} data-testid="pos-customer">{customer ? customer.name : t('cust.walkIn')}</Button>
            <Button onClick={() => { setCustomerAdd(true); setCustomerOpen(true); }} data-testid="pos-add-customer">+ {t('pos.addCustomer')}</Button>
          </div>
        </div>
        {customer && (
          <div className="row wrap" style={{ gap: 12 }}>
            {customer.areaName && <Badge>{customer.areaName}</Badge>}
            <span>{t('pay.theyOwe')}: <strong data-testid="pos-cust-due">{money(customer.balance)}</strong></span>
            {customer.creditLimit > 0 && <span className="muted">{t('cust.creditLimit')}: {money(customer.creditLimit)}</span>}
            <Badge tone="dark">{t(`tier.${tier}`)}</Badge>
          </div>
        )}
        <span className="spacer" />
        {edit && <Badge tone="warn">{t('pos.editing', { no: edit.docNo })}</Badge>}
        <span className="muted">{t('word.date')}: {i18n.n(`${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`)}</span>
      </div>

      <div className="pos">
        <div className="pos-left">
          <ProductPicker inputRef={search} testId="pos-search" products={products} onPick={(p) => addProduct(p)} placeholder={`${t('pos.search')} (F4)`} autoFocus />
          <div className="pos-grid" data-testid="pos-grid">
            {favourites.map((p) => (
              <button type="button" key={p.id} className="pos-tile" onClick={() => addProduct(p)} data-testid={`tile-${p.sku}`}>
                <strong>{productName(i18n.lang, p)}</strong>
                <small>{money(tierPriceOf(p, basePackOf(p), tier))} · {stockText(i18n, p, p.stockQty)}</small>
              </button>
            ))}
          </div>
        </div>

        <div>
          {cart.lines.length === 0 ? (
            <EmptyState title={t('pos.emptyTitle')} body={t('pos.emptyBody')} />
          ) : (
            <table className="lines pos-cart" data-testid="pos-cart">
              <thead>
                <tr><th>{t('word.name')}</th><th style={{ width: 118 }}>{t('pur.pack')}</th><th className="right" style={{ width: 82 }}>{t('word.qty')}</th><th className="right" style={{ width: 110 }}>{t('word.price')}</th><th style={{ width: 140 }}>{t('word.discount')}</th><th className="right" style={{ width: 110 }}>{t('word.amount')}</th><th style={{ width: 70 }} /></tr>
              </thead>
              <tbody>
                {cart.lines.map((l, idx) => {
                  const p = byId.get(l.productId);
                  if (!p) return null;
                  const boxed = isBoxed(p, l);
                  return (
                    <tr key={l.key} className="line-in" data-testid={`cart-line-${idx}`}>
                      <td>
                        <strong>{productName(i18n.lang, p)}</strong> {l.kind === 'bonus' && <Badge tone="ok">{t('pos.bonus')}</Badge>}
                        <br /><small className="muted">{p.sku} · {t('nav.stock')}: {stockText(i18n, p, p.stockQty)}</small>
                        {stockIssues.has(l.key) && <div className="line-warn" role="alert">{stockIssues.get(l.key)}</div>}
                      </td>
                      <td>
                        <Select aria-label={t('pur.pack')} value={l.packId} onChange={(e) => {
                          const packId = Number(e.target.value);
                          const oldAuto = tierPriceOf(p, l.packId, tier);
                          updLine(l.key, { packId, price: l.kind === 'bonus' ? 0 : l.price === oldAuto ? tierPriceOf(p, packId, tier) : l.price, ...(isBoxed(p, { packId }) ? {} : { pcs: null }) });
                        }}>
                          {p.packs.map((k) => <option key={k.id} value={k.id}>{packLabel(i18n, k)}{k.factor > 1 ? ` (${n(k.factor)})` : ''}</option>)}
                        </Select>
                      </td>
                      <td>
                        {boxed ? (
                          <div className="boxpcs">
                            <BoxQtyInput inputRef={(el: HTMLInputElement | null) => { qtyRefs.current.set(l.key, el); }} label={t('pur.boxQty')} value={l.qty} invalid={!lineOk(p, l)}
                              onChange={(box, pcs) => updLine(l.key, pcs === undefined ? { qty: box } : { qty: box, pcs })} testId={`pos-qty-${idx}`}
                              onEnter={() => search.current?.focus()} />
                            <QtyInput aria-label={t('pur.pcsQty')} value={l.pcs ?? null} onChange={(v) => updLine(l.key, { pcs: v })} data-testid={`pos-pcs-${idx}`}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search.current?.focus(); } }} />
                            {lineBaseQty(p, l) > 0 && <small className="muted" data-testid={`pos-total-${idx}`}>= {n(lineBaseQty(p, l))} {p.baseUnit}</small>}
                          </div>
                        ) : (
                          <QtyInput inputRef={(el: HTMLInputElement | null) => { qtyRefs.current.set(l.key, el); }} aria-label={t('word.qty')} value={l.qty} onChange={(v) => updLine(l.key, { qty: v })} data-testid={`pos-qty-${idx}`} invalid={l.qty === null || l.qty <= 0}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search.current?.focus(); } }} />
                        )}
                      </td>
                      <td>
                        {l.kind === 'bonus' ? <span className="right num">{money(0)}</span> : <MoneyInput aria-label={t('word.price')} value={l.price} onChange={(v) => updLine(l.key, { price: v })} data-testid={`pos-price-${idx}`} invalid={(l.qty ?? 0) > 0 && l.price === null} />}
                        {boxed && l.kind === 'normal' && (l.pcs ?? 0) > 0 && (
                          <div className="pcs-price"><MoneyInput aria-label={t('pos.pcsPrice')} value={l.pcsPrice ?? null} onChange={(v) => updLine(l.key, { pcsPrice: v })} data-testid={`pos-pcsprice-${idx}`} invalid={(l.pcsPrice ?? null) === null} /><small className="muted">/{p.baseUnit}</small></div>
                        )}
                      </td>
                      <td>{l.kind === 'bonus' ? '' : <DiscountInput label={t('word.discount')} kind={l.discKind} value={l.discValue} onChange={(k, v) => updLine(l.key, { discKind: k, discValue: v })} testId={`pos-disc-${idx}`} />}</td>
                      <td className="right num" data-testid={`pos-amount-${idx}`}>{money(totals.amountOf.get(l.key) ?? 0, { fixed: true })}</td>
                      <td>
                        <div className="row" style={{ gap: 2 }}>
                          {l.kind === 'normal' && <Button size="icon" variant="ghost" title={t('pos.addBonus')} aria-label={t('pos.addBonus')} onClick={() => addProduct(p, 'bonus')} data-testid={`pos-bonus-${idx}`}>+B</Button>}
                          <Button size="icon" variant="ghost" aria-label={t('act.delete')} onClick={() => setCart((c) => ({ ...c, lines: c.lines.filter((x) => x.key !== l.key) }))} data-testid={`pos-del-${idx}`}>×</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="row" style={{ alignItems: 'flex-start', marginTop: 12, gap: 24 }}>
            <div className="grid" style={{ flex: 1, gap: 8 }}>
              <Field label={t('word.note')}>{(a) => <Input id={a.id} value={cart.note} onChange={(e) => upd({ note: e.target.value })} />}</Field>
              {error && <div className="p-error shake" role="alert" data-testid="pos-error">{error}</div>}
              {overLimit && <div className="line-warn" role="status">{t('pos.overLimit', { limit: money(customer!.creditLimit) })}</div>}
              {customer === null && cart.lines.length > 0 && <div className="muted">{t('pos.walkInHint')}</div>}
            </div>
            <div className="totals pos-pay">
              <div className="row"><span>{t('word.subtotal')}</span><span className="num" data-testid="pos-subtotal">{money(totals.subtotal, { fixed: true })}</span></div>
              <div className="row"><span>{t('pos.invoiceDiscount')}</span><DiscountInput label={t('pos.invoiceDiscount')} kind={cart.discKind} value={cart.discValue} onChange={(k, v) => { touchedDiscount.current = true; upd({ discKind: k, discValue: v }); }} testId="pos-inv-disc" /></div>
              {totals.discount > 0 && <div className="row"><span className="muted">{t('word.discount')}</span><span className="num">−{money(totals.discount, { fixed: true })}</span></div>}
              {totals.tax > 0 && <div className="row"><span>{t('word.tax')}</span><span className="num">{money(totals.tax, { fixed: true })}</span></div>}
              {totals.roundOff !== 0 && <div className="row"><span>{t('word.roundOff')}</span><span className="num">{money(totals.roundOff, { fixed: true })}</span></div>}
              <div className="row grand"><span>{t('word.total')}</span><span className="num" data-testid="pos-total">{money(total, { fixed: true })}</span></div>
              <div className="row">
                <span>{t('word.paid')} (F8)</span>
                <div style={{ width: 150 }}>
                  {customer
                    ? <MoneyInput inputRef={paidRef} aria-label={t('word.paid')} value={cart.paid ?? 0} onChange={(v) => upd({ paid: v ?? 0 })} invalid={paid > total} data-testid="pos-paid" />
                    : <span className="num" data-testid="pos-paid-fixed">{money(total, { fixed: true })}</span>}
                </div>
              </div>
              {customer && (
                <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                  <Button size="sm" onClick={() => upd({ paid: total })} data-testid="pos-pay-full">{t('pay.fullBalance')}</Button>
                  <Button size="sm" onClick={() => upd({ paid: Math.floor(total / 2) })}>½</Button>
                  <Button size="sm" onClick={() => upd({ paid: 0 })}>{t('pos.allDue')}</Button>
                </div>
              )}
              {paid > 0 && (
                <div className="row"><span>{t('pay.account')}</span>
                  <div style={{ width: 150 }}><Select value={cart.accountId ?? ''} onChange={(e) => upd({ accountId: e.target.value ? Number(e.target.value) : null })} aria-label={t('pay.account')}><option value="">{t('pay.defaultAccount')}</option>{(accountsQ.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
                </div>
              )}
              <div className="row"><span>{t('word.due')}</span><span className="num" data-testid="pos-due">{money(due, { fixed: true })}</span></div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button onClick={reset} disabled={cart.lines.length === 0 && !cart.customerId}>{t('pos.clear')}</Button>
                {edit && <Button onClick={() => onEditDone?.()}>{t('act.cancel')}</Button>}
                <Button variant="primary" kbd="Ctrl+S" disabled={!canSave} onClick={() => startSave(false)} data-testid="pos-save">{edit ? t('pos.saveChanges') : t('act.save')}</Button>
                {!edit && <Button variant="dark" kbd="F9" disabled={!canSave} onClick={() => startSave(true)} data-testid="pos-save-print">{t('pos.savePrint')}</Button>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <CustomerPicker open={customerOpen} startAdding={customerAdd} onClose={() => setCustomerOpen(false)} onPick={(c) => { chooseCustomer(c); customersQ.reload(); }} />
      <ApprovalModal open={approval !== null} reason={approval?.reason ?? ''} onClose={() => setApproval(null)} onApproved={(tok) => approval?.after(tok)} />

      <Modal open={reasonOpen} title={t('pos.editReason')} onClose={() => setReasonOpen(false)}
        footer={<><Button onClick={() => setReasonOpen(false)}>{t('act.cancel')}</Button><Button variant="primary" disabled={!reason.trim()} data-testid="edit-confirm" onClick={() => { setReasonOpen(false); void submit(false, undefined, reason); }}>{t('pos.saveChanges')}</Button></>}>
        <Field label={t('word.reason')} required>{(a) => <Textarea id={a.id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus data-testid="edit-reason" />}</Field>
        <p className="muted">{t('pos.editHelp')}</p>
      </Modal>

      <Modal open={done !== null} title={t('pos.saved')} onClose={reset}
        footer={<Button variant="primary" onClick={reset} data-testid="pos-new" data-autofocus>{t('pos.newSale')} (F2)</Button>}>
        {done && (
          <div className="done-box" data-testid="pos-done">
            <CheckMark size={56} />
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-strong)' }} data-testid="done-docno">{done.docNo}</div>
            <Stamp kind={done.due > 0 ? 'due' : 'paid'}>{done.due > 0 ? t('word.due') : t('word.paid')}</Stamp>
            <div>{t('word.total')}: <strong>{money(done.total)}</strong>{done.due > 0 && <> · {t('word.due')}: <strong>{money(done.due)}</strong></>}</div>
            <PrintActions doc={{ type: 'invoice', id: done.id }} />
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Box quantity with a shortcut: typing "2b5" (or "2+5", "২ব৫") fills 2 boxes and 5 pieces at once. */
function BoxQtyInput({ value, onChange, label, testId, invalid, inputRef, onEnter }: { value: number | null; onChange: (box: number | null, pcs?: number) => void; label: string; testId: string; invalid: boolean; inputRef: Ref<HTMLInputElement>; onEnter: () => void }) {
  const { lang } = useI18n();
  const show = (v: number | null) => (v === null ? '' : lang === 'bn' ? toBnDigits(String(v)) : String(v));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const cur = /^\d{1,9}$/.test(fromBnDigits(text.trim())) ? Number(fromBnDigits(text.trim())) : null;
    if (cur !== value && parseBoxPcs(text)?.pcs == null) setText(show(value));
  }, [value, lang]);
  return (
    <Input ref={inputRef} numeric inputMode="text" aria-label={label} value={text} invalid={invalid || (text.trim() !== '' && parseBoxPcs(text) === null)} data-testid={testId}
      title={label}
      onChange={(e) => {
        const v = e.target.value;
        const parsed = parseBoxPcs(v);
        if (parsed && parsed.pcs !== null) {
          setText(show(parsed.box));
          onChange(parsed.box, parsed.pcs);
          return;
        }
        setText(v);
        onChange(parsed ? parsed.box : null);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} />
  );
}
