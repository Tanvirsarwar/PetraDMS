import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';
import { Badge, DateRange, EmptyState, Select, Stat, Table, monthStart, useDisplayDate, useQuery, type Range } from '../../ui';

export function CashbookTab() {
  const { t, money, lang } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const date = useDisplayDate();
  const [range, setRange] = useState<Range>({ from: monthStart(today), to: today });
  const [accountId, setAccountId] = useState<number | null>(null);
  const accounts = useQuery('money:accounts', undefined);
  const book = useQuery('cash:book', { from: range.from, to: range.to, ...(accountId ? { accountId } : {}) });
  const b = book.data;
  return (
    <div>
      <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
        <Stat label={t('cash.opening')} value={money(b?.opening ?? 0)} />
        <Stat label={t('cash.in')} value={money(b?.totalIn ?? 0)} />
        <Stat label={t('cash.out')} value={money(b?.totalOut ?? 0)} />
        <Stat label={t('cash.closing')} value={<span data-testid="cash-closing">{money(b?.closing ?? 0)}</span>} accent />
      </div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <DateRange value={range} onChange={setRange} today={today} />
        <Select aria-label={t('pay.account')} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 220 }} data-testid="cash-account">
          <option value="">{t('pay.account')}: {t('state.all')}</option>
          {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{lang === 'bn' && a.nameBn ? a.nameBn : a.name}</option>)}
        </Select>
      </div>
      {book.error && <div className="p-error" role="alert">{book.error}</div>}
      <Table
        rows={b?.rows ?? []}
        rowKey={(r) => r.id}
        pageSize={100}
        columns={[
          { key: 'd', header: t('word.date'), render: (r) => date(r.date) },
          { key: 's', header: t('word.type'), render: (r) => <span>{t(`cash.source.${r.source}`)} {r.reversal && <Badge tone="warn">{t('state.void')}</Badge>} {r.reversed && <Badge tone="default">{t('cash.cancelled')}</Badge>} <small className="muted">{r.refNo}</small></span> },
          { key: 'a', header: t('pay.account'), render: (r) => r.accountName },
          // the fund column only appears once some movement in view belongs to a fund
          ...((b?.rows ?? []).some((r) => r.fundCode) ? [{ key: 'f', header: t('fund.col'), render: (r: { fundCode: string | null }) => (r.fundCode ? <Badge>{r.fundCode}</Badge> : '') }] : []),
          { key: 'n', header: t('word.note'), render: (r) => <small className="muted">{r.note}</small> },
          { key: 'i', header: t('cash.in'), right: true, render: (r) => (r.amount > 0 ? money(r.amount, { fixed: true }) : '') },
          { key: 'o', header: t('cash.out'), right: true, render: (r) => (r.amount < 0 ? money(-r.amount, { fixed: true }) : '') },
          { key: 'b', header: t('word.balance'), right: true, render: (r) => money(r.balanceAfter, { fixed: true }) }
        ]}
        empty={book.loading ? undefined : <EmptyState title={t('cash.emptyTitle')} body={t('cash.emptyBody')} />}
      />
    </div>
  );
}
