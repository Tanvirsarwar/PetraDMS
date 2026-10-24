import { useState } from 'react';
import { Button, Card, Field, Input, Modal, toast } from '../../ui';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';

/** Demo mode: sample Bangladeshi FMCG data for trying the app. Only into an empty shop; clearing returns the shop exactly as it was. */
export function DemoTab() {
  const { t } = useI18n();
  const demo = useApp((s) => s.status?.demo ?? false);
  const refresh = useApp((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [word, setWord] = useState('');

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('demo:load');
      await refresh();
      toast.ok(t('demo.loaded'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('demo:clear', { confirm: 'DEMO' });
      toast.ok(t('demo.cleared'));
      setClearing(false);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('demo.title')}>
      <p style={{ marginTop: 0 }}>{t(demo ? 'demo.onBody' : 'demo.offBody')}</p>
      {error && <div className="p-error" role="alert" data-testid="demo-error">{error}</div>}
      {demo ? (
        <Button variant="danger" onClick={() => { setWord(''); setError(null); setClearing(true); }} data-testid="demo-clear">{t('demo.clear')}</Button>
      ) : (
        <Button variant="primary" disabled={busy} onClick={() => void load()} data-testid="demo-load">{t('demo.load')}</Button>
      )}
      <Modal open={clearing} title={t('demo.clearTitle')} onClose={() => setClearing(false)}
        footer={<><Button onClick={() => setClearing(false)}>{t('act.cancel')}</Button><Button variant="danger" disabled={busy || word.trim().toUpperCase() !== 'DEMO'} onClick={() => void clear()} data-testid="demo-clear-go">{t('demo.clear')}</Button></>}>
        <div className="grid" style={{ gap: 10 }}>
          <p style={{ margin: 0 }}>{t('demo.clearBody')}</p>
          <Field label={t('demo.typeDemo')}>{(a) => <Input id={a.id} data-autofocus value={word} onChange={(e) => setWord(e.target.value)} data-testid="demo-confirm" autoComplete="off" />}</Field>
          {error && <div className="p-error" role="alert">{error}</div>}
        </div>
      </Modal>
    </Card>
  );
}
