import { useEffect, useState } from 'react';
import { Button, Field, Input, Select } from './controls';
import { Modal } from './overlay';
import { useQuery } from './hooks';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';

/** A manager or the Owner approves a staff override (below minimum price, over credit limit) by entering their own secret. */
export function ApprovalModal({ open, reason, onClose, onApproved }: { open: boolean; reason: 'min_price' | 'credit_limit' | string; onClose: () => void; onApproved: (token: string) => void }) {
  const { t } = useI18n();
  const users = useQuery('auth:users', undefined, open);
  const approvers = (users.data ?? []).filter((u) => u.role !== 'staff');
  const [userId, setUserId] = useState<number | null>(null);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setSecret('');
      setError(null);
    }
  }, [open]);
  useEffect(() => {
    if (userId === null && approvers[0]) setUserId(approvers[0].id);
  }, [approvers, userId]);
  const go = async () => {
    if (userId === null) return;
    try {
      const r = await call('auth:approve', { userId, secret });
      setSecret('');
      onApproved(r.token);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal open={open} title={t('appr.title')} onClose={onClose}
      footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button variant="primary" disabled={!secret} onClick={() => void go()} data-testid="approve-go">{t('appr.approve')}</Button></>}>
      <div className="grid" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>{reason === 'credit_limit' ? t('appr.creditLimit') : t('appr.minPrice')}</p>
        <Field label={t('appr.who')}>
          {(a) => (
            <Select id={a.id} value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))} data-testid="approve-user">
              {approvers.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({t(`role.${u.role}`)})</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('appr.secret')}>
          {(a) => (
            <Input id={a.id} type="password" inputMode="numeric" value={secret} onChange={(e) => setSecret(e.target.value)} data-autofocus data-testid="approve-secret"
              onKeyDown={(e) => { if (e.key === 'Enter' && secret) void go(); }} />
          )}
        </Field>
        {error && <div className="p-error shake" role="alert" data-testid="approve-error">{error}</div>}
      </div>
    </Modal>
  );
}
