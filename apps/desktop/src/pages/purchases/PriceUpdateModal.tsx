import { useEffect, useState } from 'react';
import { marginBp, type PriceSuggestion } from '@petra/core';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { Button, Checkbox, Modal, MoneyInput, toast, useQuery } from '../../ui';

type Tier = 'retail' | 'wholesale' | 'dealer';
const TIERS: Tier[] = ['retail', 'wholesale', 'dealer'];
interface Edit { on: boolean; retail: number | null; wholesale: number | null; dealer: number | null }

/** After a purchase: new selling prices per box, with the margin over this invoice's landed cost. Nothing changes until Apply. */
export function PriceUpdateModal({ purchaseId, docNo, onClose }: { purchaseId: number | null; docNo: string; onClose: () => void }) {
  const i18n = useI18n();
  const { t, money } = i18n;
  const q = useQuery('purchase:priceSuggest', { id: purchaseId ?? 1 }, purchaseId !== null);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [alsoBase, setAlsoBase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setEdits(Object.fromEntries(q.data.map((s) => [s.productId, { on: false, retail: s.current.retail, wholesale: s.current.wholesale, dealer: s.current.dealer }])));
  }, [q.data]);
  const set = (id: number, patch: Partial<Edit>) => setEdits((x) => ({ ...x, [id]: { ...x[id]!, ...patch, on: patch.on ?? true } }));
  const chosen = (q.data ?? []).filter((s) => edits[s.productId]?.on);
  const ok = chosen.every((s) => TIERS.every((tier) => edits[s.productId]?.[tier] !== null));
  const pct = (bp: number | null) => (bp === null ? '–' : i18n.n(`${(bp / 100).toFixed(1)}%`));
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('purchase:applyPrices', { changes: chosen.map((s: PriceSuggestion) => ({ productId: s.productId, packId: s.packId, priceRetail: edits[s.productId]!.retail!, priceWholesale: edits[s.productId]!.wholesale!, priceDealer: edits[s.productId]!.dealer!, alsoBase: s.packId !== null && alsoBase })) });
      toast.ok(t('pur.pricesApplied', { n: r.updated }));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={purchaseId !== null} wide title={t('pur.pricesTitle', { doc: docNo })} onClose={onClose}
      footer={<><Checkbox label={t('pur.alsoPiecePrice')} checked={alsoBase} onChange={(e) => setAlsoBase(e.target.checked)} /><span className="spacer" /><Button onClick={onClose} data-testid="prices-skip">{t('pur.pricesSkip')}</Button><Button variant="primary" disabled={chosen.length === 0 || !ok || busy} onClick={() => void apply()} data-testid="prices-apply">{t('pur.pricesApply', { n: chosen.length })}</Button></>}>
      <div className="grid" style={{ gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>{t('pur.pricesHelp')}</p>
        <div className="pur-paste-wrap">
          <table className="lines" data-testid="prices-table">
            <thead><tr><th style={{ width: 36 }} /><th>{t('word.name')}</th><th className="right">{t('pur.costPerBox')}</th>{TIERS.map((tier) => <th key={tier} className="right" style={{ width: 170 }}>{t(`pur.tier.${tier}`)}</th>)}</tr></thead>
            <tbody>
              {(q.data ?? []).map((s) => {
                const e = edits[s.productId];
                if (!e) return null;
                return (
                  <tr key={s.productId}>
                    <td><input type="checkbox" aria-label={t('pur.applyRow')} checked={e.on} onChange={(ev) => set(s.productId, { on: ev.target.checked })} data-testid={`prices-on-${s.sku}`} /></td>
                    <td><strong>{i18n.lang === 'bn' && s.nameBn ? s.nameBn : s.name}</strong><br /><small className="muted">{s.sku} · {t('pur.perPack', { pack: s.packName })}</small></td>
                    <td className="right num">{money(s.costPerPack, { fixed: true })}</td>
                    {TIERS.map((tier) => (
                      <td key={tier}>
                        <MoneyInput aria-label={t(`pur.tier.${tier}`)} value={e[tier]} onChange={(v) => set(s.productId, { [tier]: v })} data-testid={`prices-${tier}-${s.sku}`} />
                        <div className={`p-hint right ${(marginBp(e[tier] ?? 0, s.costPerPack) ?? 0) < 0 ? 'neg' : ''}`}>{t('pur.margin')} {pct(marginBp(e[tier] ?? 0, s.costPerPack))}</div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <div className="p-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
