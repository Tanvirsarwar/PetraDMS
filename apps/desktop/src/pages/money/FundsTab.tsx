import { useState } from 'react';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Table, toast, useQuery } from '../../ui';

interface Edit { id?: number; code: string; name: string; nameBn: string; active: boolean }

/** Funds label cash movements (for example DSR). They hold no money of their own, see migration 0004. */
export function FundsTab() {
  const { t, int, lang } = useI18n();
  const owner = useApp((s) => s.status?.session?.role) === 'owner';
  const [showHidden, setShowHidden] = useState(false);
  const funds = useQuery('fund:list', { includeInactive: showHidden });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = (active: boolean) => {
    const e = edit!;
    setBusy(true);
    setError(null);
    void call('fund:save', { ...(e.id ? { id: e.id } : {}), code: e.code, name: e.name, nameBn: e.nameBn, active })
      .then(() => { setEdit(null); toast.ok(t('toast.saved')); funds.reload(); }, (x: unknown) => setError(errorText(x)))
      .finally(() => setBusy(false));
  };

  return (
    <Card title={t('fund.title')} actions={owner ? <Button variant="primary" data-testid="add-fund" onClick={() => { setError(null); setEdit({ code: '', name: '', nameBn: '', active: true }); }}>{t('fund.add')}</Button> : undefined}>
      <p className="muted" style={{ marginTop: 0 }}>{t('fund.intro')}</p>
      <label className="row" style={{ marginBottom: 8 }}><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> {t('fund.showHidden')}</label>
      {funds.error && <div className="p-error" role="alert">{funds.error}</div>}
      {funds.data && funds.data.length === 0 ? (
        <EmptyState title={t('fund.emptyTitle')} body={t('fund.emptyBody')} />
      ) : (
        <Table
          rows={funds.data ?? []}
          rowKey={(f) => f.id}
          columns={[
            { key: 'c', header: t('fund.code'), render: (f) => <strong data-testid="fund-code">{f.code}</strong> },
            { key: 'n', header: t('word.name'), render: (f) => <span>{lang === 'bn' && f.nameBn ? f.nameBn : f.name} {!f.active && <Badge tone="warn">{t('fund.hidden')}</Badge>}</span> },
            { key: 'm', header: t('fund.movements'), right: true, render: (f) => int(f.movements) },
            ...(owner ? [{ key: 'e', header: '', render: (f: { id: number; code: string; name: string; nameBn: string; active: boolean }) => <Button size="sm" onClick={() => { setError(null); setEdit({ id: f.id, code: f.code, name: f.name, nameBn: f.nameBn, active: f.active }); }}>{t('act.edit')}</Button> }] : [])
          ]}
        />
      )}
      <Modal
        open={edit !== null}
        title={edit?.id ? t('fund.edit') : t('fund.add')}
        onClose={() => setEdit(null)}
        footer={<>
          {edit?.id && <Button onClick={() => save(!edit.active)} disabled={busy} data-testid="fund-toggle">{edit.active ? t('fund.hide') : t('fund.show')}</Button>}
          <Button onClick={() => setEdit(null)}>{t('act.cancel')}</Button>
          <Button variant="primary" disabled={busy || !edit?.name.trim() || !edit?.code.trim()} onClick={() => save(edit?.active ?? true)} data-testid="fund-save">{t('act.save')}</Button>
        </>}
      >
        {edit && (
          <div className="grid" style={{ gap: 12 }}>
            <Field label={t('fund.code')} required hint={t('fund.codeHint')}>{(a) => <Input id={a.id} value={edit.code} disabled={Boolean(edit.id)} maxLength={12} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} data-testid="fund-code-input" />}</Field>
            <Field label={t('word.name')} required>{(a) => <Input id={a.id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="fund-name" />}</Field>
            <Field label={t('word.nameBn')}>{(a) => <Input id={a.id} value={edit.nameBn} onChange={(e) => setEdit({ ...edit, nameBn: e.target.value })} />}</Field>
            {error && <div className="p-error" role="alert" data-testid="fund-error">{error}</div>}
          </div>
        )}
      </Modal>
    </Card>
  );
}
