import { useState } from 'react';
import type { PrintDoc, PrintFormat } from '@petra/core';
import { Button, Select } from './controls';
import { toast } from './toast';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';

/** Print and Save-as-PDF for one document. Invoices and receipts also choose A4 / 80 mm / 58 mm. */
export function PrintActions({ doc, formats = true, compact }: { doc: PrintDoc; formats?: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const def = useApp((s) => s.status?.settings.receiptFormat ?? 'a4');
  const [format, setFormat] = useState<PrintFormat | null>(null);
  const [busy, setBusy] = useState(false);
  const f = format ?? def;
  const run = async (action: 'print' | 'pdf') => {
    setBusy(true);
    try {
      const r = await call('print:run', { doc, format: f, action });
      toast.ok(action === 'pdf' ? `${t('print.saved')}: ${r.path ?? ''}` : t('print.sent'));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row wrap">
      {formats && (
        <Select aria-label={t('print.format')} value={f} onChange={(e) => setFormat(e.target.value as PrintFormat)} style={{ width: 150 }} data-testid="print-format">
          <option value="a4">A4</option>
          <option value="thermal80">80 mm</option>
          <option value="thermal58">58 mm</option>
        </Select>
      )}
      <Button size={compact ? 'sm' : 'md'} disabled={busy} onClick={() => void run('print')} kbd="Ctrl+P" data-testid="print-run">{t('act.print')}</Button>
      <Button size={compact ? 'sm' : 'md'} disabled={busy} onClick={() => void run('pdf')} data-testid="print-pdf">{t('act.saveAsPdf')}</Button>
    </div>
  );
}
