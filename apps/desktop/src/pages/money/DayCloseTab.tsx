import { useState } from 'react';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';
import { Badge, Button, Card, DateInput, EmptyState, Field, Modal, MoneyInput, Stat, Table, Textarea, toast, useDisplayDate, useQuery } from '../../ui';

export function DayCloseTab() {
  const { t, money, int } = useI18n();
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const refreshStatus = useApp((s) => s.refresh);
  const today = useApp((s) => s.status?.businessDate ?? '');
  const date = useDisplayDate();
  const [day, setDay] = useState<string | null>(today);
  const status = useQuery('day:status', { date: day ?? today });
  const history = useQuery('day:history', { limit: 60 });
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [reopen, setReopen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const s = status.data;
  const closed = s?.closing?.status === 'closed';
  const diff = counted === null || !s ? null : counted - s.figures.expectedCash;
  const reload = () => { status.reload(); history.reload(); void refreshStatus(); };
  const close = () => {
    void call('day:close', { date: s!.date, actualCash: counted!, note }).then((r) => {
      setConfirm(false);
      setCounted(null);
      setNote('');
      setError(null);
      toast.ok(r.difference === 0 ? t('day.closedExact') : t('day.closedDiff', { diff: money(Math.abs(r.difference)) }));
      reload();
    }, (e: unknown) => { setConfirm(false); setError(errorText(e)); });
  };
  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card title={t('day.title')}>
        <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
          <Field label={t('word.date')}>{(a) => <DateInput id={a.id} value={day} onChange={setDay} />}</Field>
          {s && s.unclosedBefore > 0 && <Badge tone="warn">{t('day.unclosed', { n: int(s.unclosedBefore) })}</Badge>}
          {closed && <Badge tone="ok">{t('day.isClosed')}</Badge>}
        </div>
        {s && (
          <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
            <Stat label={t('day.opening')} value={money(s.figures.openingCash)} />
            <Stat label={t('day.collections')} value={money(s.figures.collections)} />
            <Stat label={t('day.expenses')} value={money(s.figures.expenses)} />
            <Stat label={t('day.expected')} value={<span data-testid="day-expected">{money(s.figures.expectedCash)}</span>} accent />
          </div>
        )}
        {closed && s?.closing ? (
          <div className="grid" style={{ gap: 8 }}>
            <div>{t('day.counted')}: <strong>{money(s.closing.actual)}</strong> · {t('day.difference')}: <strong data-testid="day-closed-diff">{money(s.closing.difference)}</strong></div>
            {s.closing.note && <div className="muted">{s.closing.note}</div>}
            {role === 'owner' && s.lastClosed === s.date && <div><Button onClick={() => setReopen(s.date)} data-testid="day-reopen">{t('day.reopen')}</Button></div>}
          </div>
        ) : (
          <div className="grid" style={{ gap: 12, maxWidth: 420 }}>
            <Field label={t('day.counted')} hint={t('day.countedHint')}>{(a) => <MoneyInput id={a.id} value={counted} onChange={setCounted} data-testid="day-counted" />}</Field>
            {diff !== null && (
              <div role="status" data-testid="day-diff">
                {diff === 0 ? <Badge tone="ok">{t('day.matches')}</Badge> : <Badge tone={diff < 0 ? 'red' : 'warn'}>{diff < 0 ? t('day.short', { diff: money(-diff) }) : t('day.over', { diff: money(diff) })}</Badge>}
              </div>
            )}
            <Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            {error && <div className="p-error" role="alert" data-testid="day-error">{error}</div>}
            <div><Button variant="primary" disabled={counted === null || !s} onClick={() => setConfirm(true)} data-testid="day-close">{t('day.close')}</Button></div>
          </div>
        )}
      </Card>
      <Card title={t('day.history')}>
        <Table
          rows={history.data ?? []}
          rowKey={(r) => r.id}
          pageSize={30}
          columns={[
            { key: 'd', header: t('word.date'), render: (r) => <span>{date(r.date)} {r.status === 'reopened' && <Badge tone="warn">{t('day.reopened')}</Badge>}</span> },
            { key: 'e', header: t('day.expected'), right: true, render: (r) => money(r.expected, { fixed: true }) },
            { key: 'a', header: t('day.counted'), right: true, render: (r) => money(r.actual, { fixed: true }) },
            { key: 'f', header: t('day.difference'), right: true, render: (r) => (r.difference === 0 ? money(0, { fixed: true }) : <Badge tone={r.difference < 0 ? 'red' : 'warn'}>{money(r.difference, { fixed: true })}</Badge>) },
            { key: 'u', header: t('day.closedBy'), render: (r) => r.closedBy }
          ]}
          empty={<EmptyState title={t('day.emptyTitle')} body={t('day.emptyBody')} />}
        />
      </Card>
      <Modal open={confirm} title={t('day.confirmTitle')} onClose={() => setConfirm(false)}
        footer={<><Button onClick={() => setConfirm(false)}>{t('act.cancel')}</Button><Button variant="primary" onClick={close} data-testid="day-confirm">{t('day.close')}</Button></>}>
        <p style={{ margin: 0 }}>{t('day.confirmBody')}</p>
      </Modal>
      <Modal open={reopen !== null} title={t('day.reopen')} onClose={() => setReopen(null)}
        footer={<><Button onClick={() => setReopen(null)}>{t('act.cancel')}</Button><Button variant="danger" disabled={!reason.trim()} data-testid="day-reopen-confirm" onClick={() => void call('day:reopen', { date: reopen!, reason }).then(() => { setReopen(null); setReason(''); toast.ok(t('day.reopenedToast')); reload(); }, (e: unknown) => { setReopen(null); setError(errorText(e)); })}>{t('day.reopen')}</Button></>}>
        <Field label={t('word.reason')} required>{(a) => <Textarea id={a.id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus data-testid="day-reopen-reason" />}</Field>
      </Modal>
    </div>
  );
}
