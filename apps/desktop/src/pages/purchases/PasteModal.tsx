import { useMemo, useState } from 'react';
import { PASTE_FIELDS, guessPasteMapping, makeProductMatcher, pasteCells, readPasteRows, type PasteField, type PasteMapping, type ProductDto } from '@petra/core';
import { useI18n } from '../../i18n';
import { Button, Checkbox, Field, Modal, MoneyInput, ProductPicker, QtyInput, Select, Textarea, productName } from '../../ui';

export interface PastedLine { productId: number; box: number; pcs: number; cost: number | null }

interface Fix { productId?: number | null; box?: number | null; pcs?: number | null; cost?: number | null; skip?: boolean }

/**
 * Paste rows from Excel (or a CSV) with column mapping. Rows that do not match a product, or have a bad number,
 * are listed for fixing or skipping by hand; nothing is ever dropped without the user deciding.
 */
export function PasteModal({ open, products, onClose, onAdd }: { open: boolean; products: ProductDto[]; onClose: () => void; onAdd: (lines: PastedLine[]) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<PasteMapping | null>(null);
  const [hasHeader, setHasHeader] = useState<boolean | null>(null);
  const [fixes, setFixes] = useState<Record<number, Fix>>({});
  const match = useMemo(() => makeProductMatcher(products), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const cells = useMemo(() => pasteCells(text), [text]);
  const guess = useMemo(() => guessPasteMapping(cells), [cells]);
  const m = mapping ?? guess.mapping;
  const header = hasHeader ?? guess.hasHeader;
  const parsed = useMemo(() => readPasteRows(cells, m, header, match), [cells, m, header, match]);
  const width = cells.reduce((a, r) => Math.max(a, r.length), 0);

  const rows = parsed.map((r) => {
    const f = fixes[r.line] ?? {};
    const productId = f.productId !== undefined ? f.productId : r.productId;
    const box = f.box !== undefined ? f.box : r.problems.includes('badBox') ? null : r.box;
    const pcs = f.pcs !== undefined ? f.pcs : r.problems.includes('badPcs') ? null : r.pcs;
    const cost = f.cost !== undefined ? f.cost : r.problems.includes('badCost') ? undefined : r.cost;
    const problems: string[] = [];
    if (productId === null) problems.push('noProduct');
    if (box === null) problems.push('badBox');
    if (pcs === null) problems.push('badPcs');
    if (cost === undefined) problems.push('badCost');
    if (box !== null && pcs !== null && box + pcs === 0) problems.push('noQty');
    return { raw: r, productId, box, pcs, cost, skip: f.skip === true, problems };
  });
  const ready = rows.filter((r) => !r.skip && r.problems.length === 0);
  const blocked = rows.filter((r) => !r.skip && r.problems.length > 0);
  const fix = (line: number, patch: Fix) => setFixes((x) => ({ ...x, [line]: { ...x[line], ...patch } }));
  const reset = () => { setText(''); setMapping(null); setHasHeader(null); setFixes({}); };
  const colName = (i: number) => `${t('pur.column')} ${i18n.n(i + 1)}${header && cells[0]?.[i] ? `: ${cells[0][i]}` : ''}`;

  return (
    <Modal open={open} wide title={t('pur.paste')} onClose={() => { reset(); onClose(); }}
      footer={<><span className="muted" data-testid="paste-status">{t('pur.pasteStatus', { ok: ready.length, bad: blocked.length, skip: rows.filter((r) => r.skip).length })}</span><span className="spacer" /><Button onClick={() => { reset(); onClose(); }}>{t('act.cancel')}</Button>
        <Button variant="primary" disabled={ready.length === 0 || blocked.length > 0} data-testid="paste-add" onClick={() => { onAdd(ready.map((r) => ({ productId: r.productId!, box: r.box!, pcs: r.pcs!, cost: r.cost ?? null }))); reset(); }}>{t('pur.pasteAdd', { n: ready.length })}</Button></>}>
      <div className="grid" style={{ gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>{t('pur.pasteHelp')}</p>
        <Textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setFixes({}); }} aria-label={t('pur.paste')} placeholder={t('pur.pastePlaceholder')} data-autofocus data-testid="paste-text" />
        {cells.length > 0 && (
          <>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
              {PASTE_FIELDS.map((f: PasteField) => (
                <Field key={f} label={t(`pur.pasteField.${f}`)}>
                  {(a) => (
                    <Select id={a.id} value={m[f] ?? ''} onChange={(e) => setMapping({ ...m, [f]: e.target.value === '' ? null : Number(e.target.value) })} data-testid={`paste-map-${f}`}>
                      <option value="">{t('pur.notInPaste')}</option>
                      {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
                    </Select>
                  )}
                </Field>
              ))}
              <div style={{ alignSelf: 'end' }}><Checkbox label={t('pur.firstRowHeader')} checked={header} onChange={(e) => setHasHeader(e.target.checked)} /></div>
            </div>
            <div className="pur-paste-wrap">
              <table className="lines" data-testid="paste-rows">
                <thead><tr><th className="right" style={{ width: 40 }}>#</th><th>{t('pur.pasteField.product')}</th><th style={{ width: 80 }}>{t('pur.boxQty')}</th><th style={{ width: 80 }}>{t('pur.pcsQty')}</th><th style={{ width: 120 }}>{t('pur.costPerBox')}</th><th>{t('pur.pasteProblem')}</th><th style={{ width: 80 }}>{t('pur.skip')}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.raw.line} className={r.skip ? 'muted' : r.problems.length ? 'bad' : ''} data-testid={`paste-row-${r.raw.line}`}>
                      <td className="right num">{i18n.n(r.raw.line)}</td>
                      <td>
                        {r.productId !== null && !fixes[r.raw.line]?.productId
                          ? <span>{productName(i18n.lang, byId.get(r.productId)!)} <small className="muted">{r.raw.productText}</small></span>
                          : <div><small className="muted">{r.raw.productText || '-'}</small><ProductPicker products={products} resetOnPick={false} onPick={(p) => fix(r.raw.line, { productId: p.id })} placeholder={t('pur.pasteFixHint')} testId={`paste-fix-${r.raw.line}`} /></div>}
                      </td>
                      <td><QtyInput aria-label={t('pur.boxQty')} value={r.box} invalid={r.box === null} onChange={(v) => fix(r.raw.line, { box: v })} /></td>
                      <td><QtyInput aria-label={t('pur.pcsQty')} value={r.pcs} invalid={r.pcs === null} onChange={(v) => fix(r.raw.line, { pcs: v })} /></td>
                      <td><MoneyInput aria-label={t('pur.costPerBox')} value={r.cost ?? null} invalid={r.cost === undefined} onChange={(v) => fix(r.raw.line, { cost: v })} /></td>
                      <td className={r.problems.length && !r.skip ? 'p-error' : 'muted'}>{r.problems.map((p) => t(`pur.pasteProblem.${p}`)).join(' · ') || t('pur.pasteOk')}</td>
                      <td><Checkbox label={t('pur.skip')} checked={r.skip} onChange={(e) => fix(r.raw.line, { skip: e.target.checked })} data-testid={`paste-skip-${r.raw.line}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
