import { useState } from 'react';
import type { AuditRow } from '@petra/core';
import { Button, Drawer, Input, Select, Table, useQuery, DateInput } from '../../ui';
import { useI18n } from '../../i18n';

const PAGE = 100;

function pretty(json: string | null): string {
  if (!json) return '';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/** Every change of settings, users, voids, edits, restores and more, with who and when (plan 12). Owner only. */
export function AuditTab() {
  const { t, n, int } = useI18n();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const page = useQuery('audit:list', { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(userId ? { userId: Number(userId) } : {}), ...(action ? { action } : {}), ...(q.trim() ? { search: q.trim() } : {}), limit: PAGE, offset });
  const d = page.data;
  const reset = () => setOffset(0);
  const stamp = (iso: string) => n(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`);
  return (
    <div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <DateInput aria-label={t('bk.from')} value={from} onChange={(v) => { setFrom(v); reset(); }} />
        <DateInput aria-label={t('bk.to')} value={to} onChange={(v) => { setTo(v); reset(); }} />
        <Select aria-label={t('bk.user')} value={userId} onChange={(e) => { setUserId(e.target.value); reset(); }} style={{ maxWidth: 180 }} data-testid="audit-user">
          <option value="">{t('bk.user')}: {t('state.all')}</option>
          {(d?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select aria-label={t('bk.action')} value={action} onChange={(e) => { setAction(e.target.value); reset(); }} style={{ maxWidth: 220 }} data-testid="audit-action">
          <option value="">{t('bk.action')}: {t('state.all')}</option>
          {(d?.actions ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Input placeholder={t('act.search')} aria-label={t('act.search')} value={q} onChange={(e) => { setQ(e.target.value); reset(); }} style={{ maxWidth: 220 }} data-testid="audit-search" />
      </div>
      {page.error && <div className="p-error" role="alert">{page.error}</div>}
      <Table
        rows={d?.rows ?? []}
        rowKey={(r) => r.id}
        pageSize={PAGE}
        onRowClick={(r) => setOpen(r)}
        columns={[
          { key: 'at', header: t('word.date'), render: (r: AuditRow) => <span data-testid="audit-row">{stamp(r.at)}</span> },
          { key: 'user', header: t('bk.user'), render: (r) => r.userName || '-' },
          { key: 'action', header: t('bk.action'), render: (r) => <code>{r.action}</code> },
          { key: 'entity', header: t('bk.record'), render: (r) => `${r.entity}${r.entityId ? ` #${n(r.entityId)}` : ''}` },
          { key: 'reason', header: t('bk.reason'), render: (r) => r.reason }
        ]}
      />
      <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <span className="muted" data-testid="audit-total">{t('bk.auditCount', { from: int(d && d.total > 0 ? offset + 1 : 0), to: int(offset + (d?.rows.length ?? 0)), total: int(d?.total ?? 0) })}</span>
        <span className="row">
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('act.back')}</Button>
          <Button size="sm" disabled={!d || offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)} data-testid="audit-next">{t('act.next')}</Button>
        </span>
      </div>
      <Drawer wide open={open !== null} title={open ? open.action : ''} onClose={() => setOpen(null)}>
        {open && (
          <div className="grid" style={{ gap: 10 }}>
            <div><strong>{t('bk.user')}:</strong> {open.userName || '-'}</div>
            <div><strong>{t('word.date')}:</strong> {stamp(open.at)}</div>
            <div><strong>{t('bk.record')}:</strong> {open.entity}{open.entityId ? ` #${n(open.entityId)}` : ''}</div>
            {open.reason && <div><strong>{t('bk.reason')}:</strong> {open.reason}</div>}
            {open.before && <><strong>{t('bk.before')}</strong><pre className="audit-json">{pretty(open.before)}</pre></>}
            {open.after && <><strong>{t('bk.after')}</strong><pre className="audit-json">{pretty(open.after)}</pre></>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
