import { useState } from 'react';
import { Button, Card, toast, useQuery } from '../../ui';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';

/** The support export: versions, health and logs only. No customer or business data leaves the app. */
export function SupportTab() {
  const { t } = useI18n();
  const status = useApp((s) => s.status);
  const health = useQuery('app:health', undefined);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await call('diag:export');
      toast.ok(`${t('bk.diagSaved')}: ${r.path}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const h = health.data;
  return (
    <div className="grid" style={{ gap: 12 }}>
      <Card title={t('bk.diagTitle')} actions={<Button variant="primary" disabled={busy} onClick={() => void run()} data-testid="diag-export">{t('bk.diagGo')}</Button>}>
        <p style={{ marginTop: 0 }}>{t('bk.diagBody')}</p>
        <p className="muted" style={{ marginBottom: 0 }}>{t('bk.diagPrivacy')}</p>
      </Card>
      <Card title={t('bk.health')}>
        <dl className="kv" data-testid="health">
          <dt>{t('bk.appVersion')}</dt><dd>{status?.appVersion}</dd>
          <dt>{t('bk.dataFolder')}</dt><dd className="num" style={{ textAlign: 'left' }}>{status?.dataDir}</dd>
          <dt>{t('bk.integrity')}</dt><dd data-testid="health-integrity">{h ? (h.integrity === 'ok' ? t('bk.integrityOk') : h.integrity) : '…'}</dd>
          <dt>{t('bk.journal')}</dt><dd>{h ? `${h.journalMode.toUpperCase()} · synchronous ${h.synchronous}` : '…'}</dd>
        </dl>
      </Card>
    </div>
  );
}
