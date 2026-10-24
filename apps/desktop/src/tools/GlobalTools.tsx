import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, ReceivePaymentFlow } from '../ui';
import { call } from '../api';
import { useI18n } from '../i18n';
import { CalculatorPad } from './Calculator';
import { CompactPanel } from './CompactPanel';
import { SearchPalette } from './SearchPalette';
import { watchBarcodeScans } from './scan';

export const BARCODE_EVENT = 'petra:barcode';
export interface BarcodeDetail { code: string; handled: boolean }

const isTyping = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
};

export const SHORTCUTS: { keys: string; labelKey: string }[] = [
  { keys: 'Ctrl+K', labelKey: 'keys.search' },
  { keys: 'F2', labelKey: 'keys.newSale' },
  { keys: 'F3', labelKey: 'keys.customer' },
  { keys: 'F4', labelKey: 'keys.product' },
  { keys: 'F5', labelKey: 'keys.payment' },
  { keys: 'F7', labelKey: 'keys.calculator' },
  { keys: 'F8', labelKey: 'keys.paid' },
  { keys: 'F9', labelKey: 'keys.saveAndPrint' },
  { keys: 'Ctrl+S', labelKey: 'keys.save' },
  { keys: 'Ctrl+P', labelKey: 'keys.print' },
  { keys: 'Ctrl+Shift+M', labelKey: 'keys.compact' },
  { keys: 'Alt+C', labelKey: 'keys.dockCalc' },
  { keys: 'Alt+G', labelKey: 'keys.dockGames' },
  { keys: '?', labelKey: 'keys.help' },
  { keys: 'Esc', labelKey: 'keys.close' }
];

/** Keyboard shortcuts, search, calculator, barcode scans and compact mode. Lives inside the router, over every page. */
export function GlobalTools() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [search, setSearch] = useState<{ open: boolean; initial: string }>({ open: false, initial: '' });
  const [calc, setCalc] = useState<{ open: boolean; target: HTMLElement | null }>({ open: false, target: null });
  const [help, setHelp] = useState(false);
  const [pay, setPay] = useState(false);
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  compactRef.current = compact;

  const setCompactMode = useCallback(async (on: boolean) => {
    if (on === compactRef.current) return;
    setCompact(on);
    setCalc({ open: false, target: null });
    setSearch((s) => ({ ...s, open: false }));
    try {
      await call('window:compact', { on });
    } catch {
      setCompact(!on);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'm') {
        e.preventDefault();
        void setCompactMode(!compactRef.current);
      } else if (e.ctrlKey && !e.shiftKey && k.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch({ open: true, initial: '' });
      } else if (k === 'F2') {
        e.preventDefault();
        nav('/sales');
        window.dispatchEvent(new Event('petra:new-sale'));
      } else if (k === 'F5') {
        e.preventDefault();
        setPay(true);
      } else if (k === 'F7') {
        e.preventDefault();
        setCalc((c) => (c.open ? { open: false, target: null } : { open: true, target: isTyping(document.activeElement) ? (document.activeElement as HTMLElement) : null }));
      } else if (e.ctrlKey && !e.shiftKey && k.toLowerCase() === 'p') {
        const b = document.querySelector<HTMLButtonElement>('[data-testid="print-run"]');
        if (b && !b.disabled) {
          e.preventDefault();
          b.click();
        }
      } else if (k === '?' && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, setCompactMode]);

  useEffect(
    () =>
      watchBarcodeScans((code) => {
        const detail: BarcodeDetail = { code, handled: false };
        window.dispatchEvent(new CustomEvent<BarcodeDetail>(BARCODE_EVENT, { detail }));
        if (!detail.handled) setSearch({ open: true, initial: code });
      }),
    []
  );

  // A reload starts in the normal window; make the main process agree.
  useEffect(() => {
    void call('window:compact', { on: false }).catch(() => undefined);
  }, []);

  return (
    <>
      <SearchPalette open={search.open} initial={search.initial} onClose={() => setSearch((s) => ({ ...s, open: false }))} />
      {calc.open && !compact && (
        <div className="calc-float" role="dialog" aria-label={t('calc.title')} data-testid="calc-float">
          <div className="calc-float-h"><strong>{t('calc.title')}</strong><kbd className="kbd">F7</kbd></div>
          <CalculatorPad target={calc.target} onClose={() => { const el = calc.target; setCalc({ open: false, target: null }); el?.focus(); }} />
        </div>
      )}
      <Modal open={help} title={t('keys.title')} onClose={() => setHelp(false)} footer={<Button variant="primary" data-autofocus onClick={() => setHelp(false)}>{t('act.close')}</Button>}>
        <table className="keys-table" data-testid="cheatsheet">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}><td><kbd className="kbd">{s.keys}</kbd></td><td>{t(s.labelKey)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted">{t('keys.scanner')}</p>
      </Modal>
      <ReceivePaymentFlow open={pay} onClose={() => setPay(false)} />
      {compact && (
        <div className="compact-wrap">
          <CompactPanel
            onExpand={() => void setCompactMode(false)}
            onQuickSale={() => { void setCompactMode(false).then(() => nav('/sales')); }}
            onQuickPayment={() => setPay(true)}
          />
        </div>
      )}
    </>
  );
}
