import { useState } from 'react';
import { useI18n } from '../i18n';
import { Button } from '../ui';
import { IconCopy } from '../ui/icons';
import { calcKeyOf, evaluate, pushHistory } from './calcEngine';

const KEYS: { k: string; label: string; tone?: 'op' | 'eq' | 'fn' }[] = [
  { k: 'C', label: 'C', tone: 'fn' }, { k: '(', label: '(', tone: 'fn' }, { k: ')', label: ')', tone: 'fn' }, { k: '/', label: '÷', tone: 'op' },
  { k: '7', label: '7' }, { k: '8', label: '8' }, { k: '9', label: '9' }, { k: '*', label: '×', tone: 'op' },
  { k: '4', label: '4' }, { k: '5', label: '5' }, { k: '6', label: '6' }, { k: '-', label: '−', tone: 'op' },
  { k: '1', label: '1' }, { k: '2', label: '2' }, { k: '3', label: '3' }, { k: '+', label: '+', tone: 'op' },
  { k: '%', label: '%', tone: 'fn' }, { k: '0', label: '0' }, { k: '.', label: '.' }, { k: '=', label: '=', tone: 'eq' }
];
const SHOW: Record<string, string> = { '*': '×', '/': '÷', '-': '−' };

/**
 * The dock calculator: type a whole sum (with brackets and %), Enter for the answer, the last five results kept.
 * Exact decimal arithmetic (calcEngine). It never writes into a page field; "Copy result" puts the answer on the
 * clipboard for the user to paste where they choose.
 */
export function DockCalculator() {
  const { t, n } = useI18n();
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ expr: string; value: string }[]>([]);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const press = (k: string) => {
    setCopied(null);
    if (k === 'C') { setExpr(''); setResult(null); setError(null); return; }
    if (k === 'BACK') { setExpr((e) => e.slice(0, -1)); setError(null); return; }
    if (k === '=') {
      const r = evaluate(expr);
      if (r.ok) {
        setResult(r.text);
        setError(null);
        setHistory((h) => pushHistory(h, { expr, value: r.text }));
        setExpr(r.text);
      } else if (r.error !== 'empty') setError(t(`calc2.err.${r.error}`));
      return;
    }
    setError(null);
    // after an answer, a digit starts a new sum; an operator carries the answer on
    setExpr((e) => (result !== null && e === result && /[\d.(]/.test(k) ? k : e + k));
    setResult(null);
  };
  const copy = () => {
    const r = evaluate(expr);
    const v = result ?? (r.ok ? r.text : '');
    if (!v) return;
    navigator.clipboard.writeText(v).then(() => setCopied('ok'), () => setCopied('fail'));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return; // let the focused key click itself
    const k = calcKeyOf(e.key);
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    press(k);
  };
  const shown = expr === '' ? '0' : expr.replace(/[*/-]/g, (c) => SHOW[c] ?? c);
  return (
    <div className="dcalc" tabIndex={0} onKeyDown={onKey} data-testid="dock-calculator">
      <div className="dcalc-screen" aria-live="polite">
        <div className="dcalc-expr" data-testid="dcalc-expr">{n(shown)}</div>
        <div className={`dcalc-result${error ? ' err' : ''}`} data-testid="dcalc-result">{error ?? (result !== null ? `= ${n(result)}` : ' ')}</div>
      </div>
      <div className="dcalc-keys">
        {KEYS.map((b) => (
          <button key={b.k} type="button" className={`dcalc-key${b.tone ? ` ${b.tone}` : ''}`} onClick={() => press(b.k)} data-testid={`dcalc-${b.k === '/' ? 'div' : b.k === '*' ? 'mul' : b.k === '.' ? 'dot' : b.k === '%' ? 'pct' : b.k === '=' ? 'eq' : b.k === '(' ? 'open' : b.k === ')' ? 'close' : b.k === '+' ? 'plus' : b.k === '-' ? 'minus' : b.k}`}>{n(b.label)}</button>
        ))}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <Button size="sm" variant="ghost" onClick={() => press('BACK')} aria-label={t('calc2.back')} data-testid="dcalc-back">⌫</Button>
        <span className="spacer" />
        <Button size="sm" onClick={copy} disabled={!result && !evaluate(expr).ok} data-testid="dcalc-copy"><IconCopy size={15} />{t('calc2.copy')}</Button>
      </div>
      {copied && <div className={copied === 'ok' ? 'p-hint' : 'p-error'} role="status" data-testid="dcalc-copied">{copied === 'ok' ? t('calc2.copied') : t('calc2.copyFailed')}</div>}
      <div className="dcalc-hist">
        <div className="p-hint">{t('calc2.history')}</div>
        {history.length === 0 ? <div className="p-hint">{t('calc2.hint')}</div> : (
          <ol data-testid="dcalc-history">
            {history.map((h, i) => (
              <li key={i}><span className="muted">{n(h.expr.replace(/[*/-]/g, (c) => SHOW[c] ?? c))}</span><button type="button" className="dcalc-hval" title={t('calc2.copy')} onClick={() => { setExpr(h.value); setResult(h.value); }}>{n(h.value)}</button></li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
