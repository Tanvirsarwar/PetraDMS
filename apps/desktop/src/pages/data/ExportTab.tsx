import { useState } from 'react';
import type { ExportAllResult } from '@petra/core';
import { Button, Card, toast } from '../../ui';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';

/** "Export everything": spreadsheets, every table and a full backup in one ZIP, so the shop is never locked in. */
export function ExportTab() {
  const { t, int } = useI18n();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ExportAllResult | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      const r = await call('export:all');
      setDone(r);
      toast.ok(t('exp.saved'));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('exp.title')} actions={<Button variant="primary" disabled={busy} onClick={() => void go()} data-testid="export-all">{t('exp.go')}</Button>}>
      <p style={{ marginTop: 0 }}>{t('exp.body')}</p>
      <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
        <li>{t('exp.inSheets')}</li>
        <li>{t('exp.inRaw')}</li>
        <li>{t('exp.inDb')}</li>
      </ul>
      <p className="muted" style={{ marginBottom: 0 }}>{t('exp.private')}</p>
      {done && <p data-testid="export-done" style={{ marginBottom: 0 }}>{t('exp.done', { path: done.path, files: int(done.files), kb: int(Math.ceil(done.bytes / 1024)) })}</p>}
    </Card>
  );
}
