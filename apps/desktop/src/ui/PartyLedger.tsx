import { useEffect, useRef, useState } from 'react';
import { Badge, Card, Table } from './data';
import { Button, Field, Input } from './controls';
import { MoneyInput, DateInput } from './inputs';
import { Modal } from './overlay';
import { Select } from './controls';
import { toast } from './toast';
import { useQuery } from './hooks';
import { useDisplayDate } from './format';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { newRequestId } from './requestId';

/** Payment modal shared by customers (receive) and suppliers (pay). */
export function PaymentModal({ open, kind, partyId, partyName, balance, onClose, onDone }: { open: boolean; kind: 'customer' | 'supplier'; partyId: number; partyName: string; balance: number; onClose: () => void; onDone: () => void }) {
  const { t, money } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const accounts = useQuery('money:accounts', undefined, open);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(today);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(newRequestId());
  const received = kind === 'customer';
  const valid = amount !== null && amount > 0 && date !== null;
  const reset = () => {
    setAmount(null);
    setReference('');
    setError(null);
    setDate(today);
    reqId.current = newRequestId();
  };
  return (
    <Modal
      open={open}
      title={`${received ? t('pay.receive') : t('pay.pay')}: ${partyName}`}
      onClose={() => { reset(); onClose(); }}
      footer={
        <>
          <Button onClick={() => { reset(); onClose(); }}>{t('act.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!valid || busy}
            data-testid="payment-save"
            onClick={() => {
              setBusy(true);
              void call('payment:save', { partyKind: kind, partyId, amount: amount!, date: date!, accountId, reference, note: '', requestId: reqId.current }).then(
                (r) => { toast.ok(`${received ? t('pay.received') : t('pay.paid')} ${r.docNo}`); reset(); onDone(); },
                (e: unknown) => setError(errorText(e))
              ).finally(() => setBusy(false));
            }}
          >
            {received ? t('pay.receive') : t('pay.pay')}
          </Button>
        </>
      }
    >
      <div className="grid" style={{ gap: 12 }}>
        <div>{received ? t('pay.theyOwe') : t('pay.weOwe')}: <strong>{money(balance)}</strong></div>
        <Field label={t('word.amount')} required>{(a) => <MoneyInput id={a.id} value={amount} onChange={setAmount} data-testid="payment-amount" />}</Field>
        <div className="row"><Button size="sm" disabled={balance <= 0} onClick={() => setAmount(balance)}>{t('pay.fullBalance')}</Button></div>
        <Field label={t('word.date')}>{(a) => <DateInput id={a.id} value={date} onChange={setDate} />}</Field>
        <Field label={t('pay.account')}>
          {(a) => (
            <Select id={a.id} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('pay.defaultAccount')}</option>
              {(accounts.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('pay.reference')}>{(a) => <Input id={a.id} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
        {error && <div className="p-error" role="alert" data-testid="payment-error">{error}</div>}
      </div>
    </Modal>
  );
}

/** Running ledger of one customer or supplier (plain words: Due, Paid). */
export function PartyLedgerView({ kind, id, reloadKey }: { kind: 'customer' | 'supplier' | 'employee'; id: number; reloadKey?: number }) {
  const { t, money } = useI18n();
  const date = useDisplayDate();
  const ledger = useQuery('party:ledger', { kind, id });
  const data = ledger.data;
  const { reload } = ledger;
  useEffect(() => {
    if (reloadKey) reload();
  }, [reloadKey, reload]);
  return (
    <Card title={t('ledger.title')}>
      {ledger.error && <div className="p-error" role="alert">{ledger.error}</div>}
      <Table
        rows={[...(data?.rows ?? [])].reverse()}
        rowKey={(r) => r.id}
        pageSize={30}
        columns={[
          { key: 'date', header: t('word.date'), render: (r) => date(r.date) },
          { key: 'kind', header: t('word.type'), render: (r) => <span>{t(`ledger.kind.${r.kind}`)} {r.reversal && <Badge tone="warn">{t('state.void')}</Badge>} <small className="muted">{r.refNo}</small></span> },
          { key: 'amount', header: t('word.amount'), right: true, render: (r) => money(r.amount, { fixed: true }) },
          { key: 'bal', header: t('word.balance'), right: true, render: (r) => money(r.balanceAfter, { fixed: true }) }
        ]}
      />
    </Card>
  );
}
