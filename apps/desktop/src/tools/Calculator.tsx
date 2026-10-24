import { useEffect, useRef, useState } from 'react';
import { calcInitial, calcKeyFromEvent, calcPress, type CalcKey } from '@petra/core';
import { Button } from '../ui';
import { useI18n } from '../i18n';

const ROWS: { key: CalcKey; label: string; tone?: 'op' | 'eq' | 'mem' }[][] = [
  [{ key: 'MC', label: 'MC', tone: 'mem' }, { key: 'MR', label: 'MR', tone: 'mem' }, { key: 'M-', label: 'M−', tone: 'mem' }, { key: 'M+', label: 'M+', tone: 'mem' }],
  [{ key: 'C', label: 'C' }, { key: 'BACK', label: '⌫' }, { key: '%', label: '%', tone: 'op' }, { key: '/', label: '÷', tone: 'op' }],
  [{ key: '7', label: '7' }, { key: '8', label: '8' }, { key: '9', label: '9' }, { key: '*', label: '×', tone: 'op' }],
  [{ key: '4', label: '4' }, { key: '5', label: '5' }, { key: '6', label: '6' }, { key: '-', label: '−', tone: 'op' }],
  [{ key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: '+', label: '+', tone: 'op' }],
  [{ key: 'NEG', label: '±' }, { key: '0', label: '0' }, { key: '.', label: '.' }, { key: '=', label: '=', tone: 'eq' }]
];

/** Writes a value into a field the way typing would, so React inputs notice the change. */
export function insertIntoField(el: HTMLElement | null, text: string): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.disabled || el.readOnly) return false;
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/** Pocket calculator (F7). The keyboard works as soon as it opens; Ctrl+Enter sends the result to the field you were in. */
export function CalculatorPad({ target, onClose, docked }: { target?: HTMLElement | null; onClose?: () => void; docked?: boolean }) {
  const { t, n } = useI18n();
  const [s, setS] = useState(calcInitial);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus();
  }, []);
  const canInsert = !!target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && !target.disabled && !target.readOnly;
  const insert = () => {
    if (!canInsert || s.error) return;
    const v = calcPress(s, '=');
    if (insertIntoField(target ?? null, v.display)) onClose?.();
  };
  const press = (k: CalcKey) => setS((x) => calcPress(x, k));
  return (
    <div
      ref={root}
      tabIndex={-1}
      className={`calc${docked ? ' docked' : ''}`}
      data-testid="calculator"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose) {
          e.stopPropagation();
          e.preventDefault();
          onClose();
          return;
        }
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          insert();
          return;
        }
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const k = e.key === 'Enter' && (e.target as HTMLElement).tagName === 'BUTTON' ? null : calcKeyFromEvent(e.key);
        if (k) {
          e.preventDefault();
          e.stopPropagation();
          press(k);
        }
      }}
    >
      <div className="calc-expr" aria-hidden="true">{n(s.expr)}{s.memory !== 0 && <span className="calc-m" title={t('calc.memory')}> M</span>}</div>
      <output className="calc-display" data-testid="calc-display" aria-live="polite">{s.error ? t('calc.error') : n(s.display)}</output>
      <div className="calc-grid">
        {ROWS.flat().map((b) => (
          <button key={b.key} type="button" className={`calc-key ${b.tone ?? ''}`} onClick={() => press(b.key)} data-testid={`calc-${b.key}`} aria-label={b.key === 'BACK' ? t('calc.backspace') : b.label}>
            {b.label}
          </button>
        ))}
      </div>
      {onClose && (
        <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
          <Button size="sm" disabled={!canInsert || s.error} onClick={insert} kbd="Ctrl+↵" data-testid="calc-insert">{t('calc.insert')}</Button>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="calc-close">{t('act.close')}</Button>
        </div>
      )}
      {s.history.length > 0 && (
        <ul className="calc-history" aria-label={t('calc.history')}>
          {[...s.history].reverse().map((h, i) => (
            <li key={i}><span>{n(h.expr)}</span><strong>{n(h.result)}</strong></li>
          ))}
        </ul>
      )}
    </div>
  );
}
