import { useMemo, useRef, useState } from 'react';
import type { ExpenseDto } from '@petra/core';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';
import { newRequestId } from '../../ui/requestId';
import { Badge, Button, Card, DateInput, DateRange, Drawer, EmptyState, Field, Input, Modal, MoneyInput, Select, Stat, Table, Textarea, monthStart, toast, useDisplayDate, useQuery, type Range } from '../../ui';

export function ExpensesTab() {
  const { t, money, int, lang } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const date = useDisplayDate();
  const [range, setRange] = useState<Range>({ from: monthStart(today), to: today });
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [cats, setCats] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseDto | null>(null);
  const categories = useQuery('exp:categories', { includeArchived: false });
  const list = useQuery('exp:list', { from: range.from, to: range.to, ...(categoryId ? { categoryId } : {}), ...(q.trim() ? { search: q.trim() } : {}), includeVoid: true });
  const catName = (c: { name: string; nameBn: string }) => (lang === 'bn' && c.nameBn ? c.nameBn : c.name);
  const top = list.data?.byCategory[0];
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  return (
    <div>
      <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
        <Stat label={t('exp.total')} value={money(list.data?.total ?? 0)} accent />
        <Stat label={t('exp.count')} value={int(rows.filter((r) => r.status === 'posted').length)} />
        {top && <Stat label={t('exp.biggest')} value={catName(top)} sub={money(top.total)} />}
      </div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <DateRange value={range} onChange={setRange} today={today} />
        <Select aria-label={t('exp.category')} value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 220 }} data-testid="exp-filter-cat">
          <option value="">{t('exp.category')}: {t('state.all')}</option>
          {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}
        </Select>
        <Input placeholder={t('act.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} aria-label={t('act.search')} />
        <span className="spacer" />
        <Button onClick={() => setCats(true)} data-testid="exp-categories">{t('exp.categories')}</Button>
        <Button variant="primary" onClick={() => setAdding(true)} data-testid="add-expense">{t('exp.add')}</Button>
      </div>
      {list.error && <div className="p-error" role="alert">{list.error}</div>}
      <Table
        rows={rows}
        rowKey={(r) => r.id}
        pageSize={50}
        columns={[
          { key: 'date', header: t('word.date'), render: (r) => date(r.date), sortValue: (r) => r.date },
          { key: 'no', header: t('word.number'), render: (r) => <span>{r.docNo} {r.status === 'void' && <Badge tone="warn">{t('state.void')}</Badge>}</span> },
          { key: 'cat', header: t('exp.category'), render: (r) => catName({ name: r.categoryName, nameBn: r.categoryNameBn }) },
          { key: 'payee', header: t('exp.payee'), render: (r) => <span>{r.payee} {r.note && <small className="muted">{r.note}</small>}</span> },
          { key: 'acc', header: t('pay.account'), render: (r) => r.accountName },
          { key: 'amt', header: t('word.amount'), right: true, render: (r) => <span style={r.status === 'void' ? { textDecoration: 'line-through' } : undefined}>{money(r.amount, { fixed: true })}</span>, sortValue: (r) => r.amount },
          { key: 'act', header: '', render: (r) => (r.status === 'posted' ? <Button size="sm" onClick={() => setVoiding(r)} data-testid={`exp-void-${r.docNo}`}>{t('act.void')}</Button> : <small className="muted">{r.voidReason}</small>) }
        ]}
        empty={list.loading ? undefined : <EmptyState title={t('exp.emptyTitle')} body={t('exp.emptyBody')} action={<Button variant="primary" onClick={() => setAdding(true)}>{t('exp.add')}</Button>} />}
      />
      <ExpenseModal open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />
      <VoidModal expense={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); list.reload(); }} />
      <CategoryDrawer open={cats} onClose={() => setCats(false)} onChanged={() => { categories.reload(); list.reload(); }} />
    </div>
  );
}

export function ExpenseModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const categories = useQuery('exp:categories', { includeArchived: false }, open);
  const accounts = useQuery('money:accounts', undefined, open);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(today);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [payee, setPayee] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(newRequestId());
  const cat = categoryId ?? categories.data?.[0]?.id ?? null;
  const valid = cat !== null && amount !== null && amount > 0 && day !== null;
  const reset = () => { setAmount(null); setPayee(''); setNote(''); setError(null); setDay(today); reqId.current = newRequestId(); };
  const save = () => {
    setBusy(true);
    void call('exp:save', { categoryId: cat!, amount: amount!, date: day!, accountId, payee, note, requestId: reqId.current })
      .then((r) => { toast.ok(`${t('exp.saved')} ${r.docNo}`); reset(); onDone(); }, (e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Modal open={open} title={t('exp.add')} onClose={() => { reset(); onClose(); }}
      footer={<><Button onClick={() => { reset(); onClose(); }}>{t('act.cancel')}</Button><Button variant="primary" disabled={!valid || busy} onClick={save} data-testid="exp-save">{t('act.save')}</Button></>}>
      <div className="grid" style={{ gap: 12 }} onKeyDown={(e) => { if (e.key === 'Enter' && valid && !busy && (e.target as HTMLElement).tagName !== 'TEXTAREA') save(); }}>
        <Field label={t('exp.category')} required>
          {(a) => (
            <Select id={a.id} value={cat ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))} data-testid="exp-category">
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{lang === 'bn' && c.nameBn ? c.nameBn : c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('word.amount')} required>{(a) => <MoneyInput id={a.id} value={amount} onChange={setAmount} data-testid="exp-amount" data-autofocus />}</Field>
        <Field label={t('word.date')}>{(a) => <DateInput id={a.id} value={day} onChange={setDay} />}</Field>
        <Field label={t('exp.paidFrom')}>
          {(a) => (
            <Select id={a.id} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('pay.defaultAccount')}</option>
              {(accounts.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('exp.payee')}>{(a) => <Input id={a.id} value={payee} onChange={(e) => setPayee(e.target.value)} data-testid="exp-payee" />}</Field>
        <Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {error && <div className="p-error" role="alert" data-testid="exp-error">{error}</div>}
      </div>
    </Modal>
  );
}

function VoidModal({ expense, onClose, onDone }: { expense: ExpenseDto | null; onClose: () => void; onDone: () => void }) {
  const { t, money } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => { setReason(''); setError(null); onClose(); };
  return (
    <Modal open={expense !== null} title={t('exp.void')} onClose={close}
      footer={<><Button onClick={close}>{t('act.cancel')}</Button><Button variant="danger" disabled={!reason.trim()} data-testid="exp-void-confirm" onClick={() => void call('exp:void', { id: expense!.id, reason }).then(() => { toast.ok(t('exp.voided')); setReason(''); onDone(); }, (e: unknown) => setError(errorText(e)))}>{t('act.void')}</Button></>}>
      <div className="grid" style={{ gap: 12 }}>
        {expense && <p style={{ margin: 0 }}>{expense.docNo} · {money(expense.amount)} · {expense.payee}</p>}
        <Field label={t('word.reason')} required>{(a) => <Textarea id={a.id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus data-testid="exp-void-reason" />}</Field>
        {error && <div className="p-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

function CategoryDrawer({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, int } = useI18n();
  const cats = useQuery('exp:categories', { includeArchived: true }, open);
  const [name, setName] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const after = () => { cats.reload(); onChanged(); };
  const add = () => {
    void call('exp:categorySave', { name, nameBn, archived: false }).then(() => { setName(''); setNameBn(''); setError(null); after(); }, (e: unknown) => setError(errorText(e)));
  };
  return (
    <Drawer open={open} title={t('exp.categories')} onClose={onClose}>
      <div className="grid" style={{ gap: 12 }}>
        <Card flat>
          <div className="row wrap">
            <Input placeholder={t('word.name')} aria-label={t('word.name')} value={name} onChange={(e) => setName(e.target.value)} data-testid="cat-name" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) add(); }} />
            <Input placeholder={t('word.nameBn')} aria-label={t('word.nameBn')} value={nameBn} onChange={(e) => setNameBn(e.target.value)} />
            <Button variant="primary" disabled={!name.trim()} onClick={add} data-testid="cat-add">{t('act.add')}</Button>
          </div>
        </Card>
        {error && <div className="p-error" role="alert">{error}</div>}
        <Table
          rows={cats.data ?? []}
          rowKey={(c) => c.id}
          columns={[
            { key: 'n', header: t('word.name'), render: (c) => <span>{c.name} {c.nameBn && <small className="muted">{c.nameBn}</small>} {c.status === 'archived' && <Badge tone="warn">{t('state.archived')}</Badge>}</span> },
            { key: 'u', header: t('exp.used'), right: true, render: (c) => int(c.used) },
            { key: 'a', header: '', render: (c) => <Button size="sm" onClick={() => void call('exp:categorySave', { id: c.id, name: c.name, nameBn: c.nameBn, archived: c.status === 'active' }).then(after, (e: unknown) => setError(errorText(e)))}>{c.status === 'active' ? t('act.archive') : t('act.restore')}</Button> }
          ]}
        />
      </div>
    </Drawer>
  );
}
