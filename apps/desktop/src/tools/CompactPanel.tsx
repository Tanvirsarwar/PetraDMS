import { useEffect } from 'react';
import { Button } from '../ui';
import { useQuery } from '../ui';
import { useI18n } from '../i18n';
import { CalculatorPad } from './Calculator';

/** Ctrl+Shift+M: the window shrinks to a small always-on-top panel with a calculator, today's figures and two quick actions. */
export function CompactPanel({ onExpand, onQuickSale, onQuickPayment }: { onExpand: () => void; onQuickSale: () => void; onQuickPayment: () => void }) {
  const { t, money, int } = useI18n();
  const q = useQuery('compact:figures', undefined);
  useEffect(() => {
    const h = window.setInterval(q.reload, 15_000);
    return () => window.clearInterval(h);
  }, [q.reload]);
  const f = q.data;
  return (
    <div className="compact" data-testid="compact-panel" role="region" aria-label={t('compact.title')}>
      <div className="compact-h">
        <strong>{t('compact.title')}</strong>
        <Button size="sm" variant="ghost" onClick={onExpand} kbd="Ctrl+⇧+M" data-testid="compact-expand">{t('compact.expand')}</Button>
      </div>
      <div className="compact-stats" data-testid="compact-stats">
        <div><span>{t('compact.sales')}</span><strong>{f ? money(f.sales) : '…'}</strong></div>
        <div><span>{t('compact.collected')}</span><strong>{f ? money(f.collected) : '…'}</strong></div>
        <div><span>{t('compact.invoices')}</span><strong>{f ? int(f.invoices) : '…'}</strong></div>
        {f?.cash !== null && f?.cash !== undefined && <div><span>{t('compact.cash')}</span><strong>{money(f.cash)}</strong></div>}
      </div>
      <div className="row" style={{ gap: 6, margin: '8px 0' }}>
        <Button variant="primary" size="sm" onClick={onQuickSale} data-testid="compact-sale">{t('compact.quickSale')}</Button>
        <Button size="sm" onClick={onQuickPayment} data-testid="compact-pay">{t('compact.quickPayment')}</Button>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={q.reload} data-testid="compact-refresh">{t('act.refresh')}</Button>
      </div>
      <CalculatorPad docked />
    </div>
  );
}
