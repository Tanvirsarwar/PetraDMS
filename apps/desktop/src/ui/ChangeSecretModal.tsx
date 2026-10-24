import { useState } from 'react';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { Button, Field, Input } from './controls';
import { Modal } from './overlay';
import { SecretPicker, emptySecret, secretValid, type SecretValue } from './Secret';
import { toast } from './toast';

export function ChangeSecretModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [old, setOld] = useState('');
  const [sv, setSv] = useState<SecretValue>(emptySecret);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOld('');
    setSv(emptySecret);
    setError(null);
    onClose();
  };
  return (
    <Modal
      open={open}
      title={t('set.changeSecret')}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t('act.cancel')}</Button>
          <Button
            variant="primary"
            disabled={old === '' || !secretValid(sv)}
            data-testid="change-secret-submit"
            onClick={() =>
              void call('auth:changeSecret', { oldSecret: old, kind: sv.kind, newSecret: sv.secret }).then(
                () => {
                  toast.ok(t('set.secretChanged'));
                  close();
                },
                (e: unknown) => setError(errorText(e))
              )
            }
          >
            {t('act.save')}
          </Button>
        </>
      }
    >
      <div className="grid" style={{ gap: 12 }}>
        <Field label={t('set.oldSecret')} required>{(a) => <Input id={a.id} type="password" value={old} onChange={(e) => setOld(e.target.value)} data-testid="old-secret" />}</Field>
        <SecretPicker value={sv} onChange={setSv} />
        {error && <div className="p-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
