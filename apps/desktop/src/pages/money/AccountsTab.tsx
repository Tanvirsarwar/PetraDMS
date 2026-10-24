import { useState } from 'react';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, Select, Table, toast, useQuery } from '../../ui';

type Kind = 'cash' | 'bank' | 'bkash' | 'nagad' | 'other';
const KINDS: Kind[] = ['cash', 'bank', 'bkash', 'nagad', 'other'];

export function AccountsTab() {
  const { t, money } = useI18n();
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const accounts = useQuery('money:accounts', undefined);
  const [edit, setEdit] = useState<{ id?: number; name: string; nameBn: string; kind: Kind; opening: number | null; isDefault: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = (accounts.data ?? []).reduce((a, x) => a + x.balance, 0);
  const owner = role === 'owner';
  const save = (active = true) => {
    const e = edit!;
    void call('money:accountSave', { ...(e.id ? { id: e.id } : {}), name: e.name, nameBn: e.nameBn, kind: e.kind, openingBalance: e.opening ?? 0, isDefault: e.isDefault, active }).then(() => {
      setEdit(null);
      setError(null);
      toast.ok(t('toast.saved'));
      accounts.reload();
    }, (x: unknown) => setError(errorText(x)));
  };
  return (
    <Card title={t('acc.title')} actions={owner ? <Button variant="primary" data-testid="add-account" onClick={() => { setError(null); setEdit({ name: '', nameBn: '', kind: 'bkash', opening: null, isDefault: false }); }}>{t('acc.add')}</Button> : undefined}>
      <p className="muted" style={{ marginTop: 0 }}>{t('acc.total')}: <strong>{money(total)}</strong></p>
      <Table
        rows={accounts.data ?? []}
        rowKey={(a) => a.id}
        columns={[
          { key: 'n', header: t('word.name'), render: (a) => <span>{a.name} {a.isDefault && <Badge tone="ok">{t('acc.default')}</Badge>}</span> },
          { key: 'k', header: t('word.type'), render: (a) => t(`acc.kind.${a.kind}`) },
          { key: 'b', header: t('word.balance'), right: true, render: (a) => money(a.balance, { fixed: true }) },
          ...(owner ? [{ key: 'e', header: '', render: (a: { id: number; name: string; nameBn: string; kind: string; isDefault: boolean }) => <Button size="sm" onClick={() => { setError(null); setEdit({ id: a.id, name: a.name, nameBn: a.nameBn, kind: a.kind as Kind, opening: null, isDefault: a.isDefault }); }}>{t('act.edit')}</Button> }] : [])
        ]}
      />
      <Modal open={edit !== null} title={edit?.id ? t('acc.edit') : t('acc.add')} onClose={() => setEdit(null)}
        footer={<>
          {edit?.id && !edit.isDefault && <Button variant="danger" onClick={() => save(false)} data-testid="acc-hide">{t('acc.hide')}</Button>}
          <Button onClick={() => setEdit(null)}>{t('act.cancel')}</Button>
          <Button variant="primary" disabled={!edit?.name.trim()} onClick={() => save()} data-testid="acc-save">{t('act.save')}</Button>
        </>}>
        {edit && (
          <div className="grid" style={{ gap: 12 }}>
            <Field label={t('word.name')} required>{(a) => <Input id={a.id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="acc-name" data-autofocus />}</Field>
            <Field label={t('word.nameBn')}>{(a) => <Input id={a.id} value={edit.nameBn} onChange={(e) => setEdit({ ...edit, nameBn: e.target.value })} />}</Field>
            {!edit.id && (
              <>
                <Field label={t('word.type')}>{(a) => <Select id={a.id} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Kind })}>{KINDS.map((k) => <option key={k} value={k}>{t(`acc.kind.${k}`)}</option>)}</Select>}</Field>
                <Field label={t('acc.opening')}>{(a) => <MoneyInput id={a.id} value={edit.opening} onChange={(v) => setEdit({ ...edit, opening: v })} data-testid="acc-opening" />}</Field>
              </>
            )}
            <label className="row"><input type="checkbox" checked={edit.isDefault} onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })} /> {t('acc.makeDefault')}</label>
            {error && <div className="p-error" role="alert" data-testid="acc-error">{error}</div>}
          </div>
        )}
      </Modal>
    </Card>
  );
}
