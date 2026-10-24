import { useMemo, useRef, useState } from 'react';
import type { EmployeeDto, SalarySheetDto } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Badge, Button, Card, Checkbox, DateInput, Drawer, EmptyState, Field, Input, Modal, MoneyInput, PartyLedgerView, Segmented, Select, Stat, Table, Tabs, Textarea, toast, useDisplayDate, useQuery } from '../ui';
import { newRequestId } from '../ui/requestId';

export function EmployeesPage({ embedded }: { embedded?: boolean }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'staff' | 'salary'>('staff');
  return (
    <div>
      {!embedded && <div className="page-h"><h2>{t('nav.employees')}</h2></div>}
      <Tabs value={tab} label={t('nav.employees')} onChange={setTab} tabs={[{ value: 'staff', label: t('emp.tabPeople') }, { value: 'salary', label: t('emp.tabSalary') }]} />
      <div style={{ marginTop: 12 }}>{tab === 'staff' ? <PeopleTab /> : <SalaryTab />}</div>
    </div>
  );
}

function PeopleTab() {
  const { t, money, int } = useI18n();
  const [archived, setArchived] = useState(false);
  const [sel, setSel] = useState<EmployeeDto | 'new' | null>(null);
  const list = useQuery('emp:list', { includeArchived: archived });
  const rows = list.data ?? [];
  const owed = rows.filter((e) => e.status === 'active').reduce((a, e) => a + Math.max(0, e.balance), 0);
  return (
    <div>
      <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
        <Stat label={t('emp.owed')} value={money(owed)} accent={owed > 0} />
        <Stat label={t('emp.count')} value={int(rows.filter((e) => e.status === 'active').length)} />
      </div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <Checkbox label={t('prod.showArchived')} checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        <span className="spacer" />
        <Button variant="primary" onClick={() => setSel('new')} data-testid="add-employee">{t('emp.add')}</Button>
      </div>
      {list.error && <div className="p-error" role="alert">{list.error}</div>}
      <Table
        rows={rows}
        rowKey={(e) => e.id}
        onRowClick={setSel}
        columns={[
          { key: 'n', header: t('word.name'), render: (e) => <span><strong>{e.name}</strong> {e.status === 'archived' && <Badge tone="warn">{t('state.archived')}</Badge>}</span>, sortValue: (e) => e.name.toLowerCase() },
          { key: 'j', header: t('emp.jobTitle'), render: (e) => e.jobTitle },
          { key: 'p', header: t('word.phone'), render: (e) => e.phone },
          { key: 's', header: t('emp.baseSalary'), right: true, render: (e) => money(e.baseSalary, { fixed: true }), sortValue: (e) => e.baseSalary },
          { key: 'b', header: t('emp.balance'), right: true, render: (e) => (e.balance > 0 ? <Badge tone="red">{money(e.balance, { fixed: true })}</Badge> : e.balance < 0 ? <Badge tone="ok">{money(e.balance, { fixed: true })}</Badge> : money(0, { fixed: true })), sortValue: (e) => e.balance }
        ]}
        empty={list.loading ? undefined : <EmptyState title={t('emp.emptyTitle')} body={t('emp.emptyBody')} action={<Button variant="primary" onClick={() => setSel('new')}>{t('emp.add')}</Button>} />}
      />
      <EmployeeDrawer employee={sel === 'new' ? null : sel} open={sel !== null} onClose={() => setSel(null)} onChanged={() => list.reload()} />
    </div>
  );
}

function EmployeeDrawer({ employee, open, onClose, onChanged }: { employee: EmployeeDto | null; open: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, money } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const blank = { name: '', nameBn: '', phone: '', jobTitle: '' };
  const [f, setF] = useState(blank);
  const [salary, setSalary] = useState<number | null>(0);
  const [joined, setJoined] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState('');
  const [pay, setPay] = useState(false);
  const [bump, setBump] = useState(0);
  const key = open ? String(employee?.id ?? 'new') : '';
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setF(employee ? { name: employee.name, nameBn: employee.nameBn, phone: employee.phone, jobTitle: employee.jobTitle } : blank);
      setSalary(employee?.baseSalary ?? 0);
      setJoined(employee?.joinedOn ?? today);
      setError(null);
    }
  }
  const live = useQuery('emp:list', { includeArchived: true }, open && !!employee);
  const current = (employee && live.data?.find((e) => e.id === employee.id)) || employee;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const reload = () => { live.reload(); onChanged(); setBump((b) => b + 1); };
  const save = () => {
    void call('emp:save', { ...(employee ? { id: employee.id } : {}), ...f, baseSalary: salary ?? 0, joinedOn: joined }).then(() => {
      toast.ok(t('toast.saved'));
      onChanged();
      if (!employee) onClose();
      else setError(null);
    }, (e: unknown) => setError(errorText(e)));
  };
  return (
    <Drawer open={open} title={employee ? employee.name : t('emp.add')} onClose={onClose}
      footer={<><Button onClick={onClose}>{t('act.close')}</Button><Button variant="primary" disabled={!f.name.trim()} onClick={save} data-testid="emp-save">{t('act.save')}</Button></>}>
      <div className="grid" style={{ gap: 12 }}>
        <Field label={t('word.name')} required>{(a) => <Input id={a.id} value={f.name} onChange={set('name')} data-testid="emp-name" data-autofocus />}</Field>
        <Field label={t('word.nameBn')}>{(a) => <Input id={a.id} value={f.nameBn} onChange={set('nameBn')} />}</Field>
        <Field label={t('word.phone')}>{(a) => <Input id={a.id} value={f.phone} onChange={set('phone')} inputMode="tel" />}</Field>
        <Field label={t('emp.jobTitle')}>{(a) => <Input id={a.id} value={f.jobTitle} onChange={set('jobTitle')} />}</Field>
        <Field label={t('emp.baseSalary')} hint={t('emp.baseSalaryHint')}>{(a) => <MoneyInput id={a.id} value={salary} onChange={setSalary} data-testid="emp-salary" />}</Field>
        <Field label={t('emp.joined')}>{(a) => <DateInput id={a.id} value={joined} onChange={setJoined} />}</Field>
        {error && <div className="p-error" role="alert" data-testid="emp-error">{error}</div>}
        {current && employee && (
          <>
            <Card flat>
              <div className="row wrap" style={{ gap: 12 }}>
                <span>{t('emp.balance')}: <strong data-testid="emp-balance">{money(current.balance)}</strong></span>
                <span className="spacer" />
                {current.status === 'active' && <Button variant="primary" onClick={() => setPay(true)} data-testid="emp-pay">{t('emp.pay')}</Button>}
                <Button onClick={() => void call('emp:archive', { id: employee.id, archived: current.status === 'active' }).then(() => { onChanged(); live.reload(); setError(null); }, (e: unknown) => setError(errorText(e)))}>{current.status === 'active' ? t('act.archive') : t('act.restore')}</Button>
              </div>
            </Card>
            <PartyLedgerView kind="employee" id={employee.id} reloadKey={bump} />
            <PayModal open={pay} employee={current} onClose={() => setPay(false)} onDone={() => { setPay(false); reload(); }} />
          </>
        )}
      </div>
    </Drawer>
  );
}

function PayModal({ open, employee, onClose, onDone }: { open: boolean; employee: EmployeeDto; onClose: () => void; onDone: () => void }) {
  const { t, money } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const accounts = useQuery('money:accounts', undefined, open);
  const [purpose, setPurpose] = useState<'salary' | 'advance'>('salary');
  const [amount, setAmount] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(today);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(newRequestId());
  const valid = amount !== null && amount > 0 && day !== null;
  const close = () => { setAmount(null); setNote(''); setError(null); reqId.current = newRequestId(); onClose(); };
  const pay = () => {
    setBusy(true);
    void call('emp:pay', { employeeId: employee.id, amount: amount!, date: day!, purpose, accountId, note, requestId: reqId.current })
      .then((r) => { toast.ok(`${t('pay.paid')} ${r.docNo}`); setAmount(null); setNote(''); setError(null); reqId.current = newRequestId(); onDone(); }, (e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Modal open={open} title={`${t('emp.pay')}: ${employee.name}`} onClose={close}
      footer={<><Button onClick={close}>{t('act.cancel')}</Button><Button variant="primary" disabled={!valid || busy} data-testid="emp-pay-save" onClick={pay}>{t('emp.pay')}</Button></>}>
      <div className="grid" style={{ gap: 12 }}>
        <div>{t('emp.balance')}: <strong>{money(employee.balance)}</strong></div>
        <Segmented label={t('emp.purpose')} value={purpose} onChange={setPurpose} options={[{ value: 'salary', label: t('emp.purposeSalary') }, { value: 'advance', label: t('emp.purposeAdvance') }]} />
        <Field label={t('word.amount')} required>{(a) => <MoneyInput id={a.id} value={amount} onChange={setAmount} data-testid="emp-pay-amount" data-autofocus />}</Field>
        <div className="row"><Button size="sm" disabled={employee.balance <= 0} onClick={() => setAmount(employee.balance)}>{t('pay.fullBalance')}</Button></div>
        <Field label={t('word.date')}>{(a) => <DateInput id={a.id} value={day} onChange={setDay} />}</Field>
        <Field label={t('pay.account')}>
          {(a) => (
            <Select id={a.id} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('pay.defaultAccount')}</option>
              {(accounts.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {error && <div className="p-error" role="alert" data-testid="emp-pay-error">{error}</div>}
      </div>
    </Modal>
  );
}

function SalaryTab() {
  const { t, money } = useI18n();
  const date = useDisplayDate();
  const sheets = useQuery('salary:list', undefined);
  const [gen, setGen] = useState(false);
  const [open, setOpen] = useState<SalarySheetDto | null>(null);
  return (
    <div>
      <div className="p-toolbar" style={{ marginBottom: 12 }}>
        <span className="muted">{t('sal.hint')}</span>
        <span className="spacer" />
        <Button variant="primary" onClick={() => setGen(true)} data-testid="sal-generate">{t('sal.generate')}</Button>
      </div>
      {sheets.error && <div className="p-error" role="alert">{sheets.error}</div>}
      <Table
        rows={sheets.data ?? []}
        rowKey={(s) => s.id}
        onRowClick={setOpen}
        columns={[
          { key: 'm', header: t('sal.month'), render: (s) => <span><strong>{s.month}</strong> {s.status === 'void' && <Badge tone="warn">{t('state.void')}</Badge>}</span>, sortValue: (s) => s.month },
          { key: 'd', header: t('word.date'), render: (s) => date(s.date) },
          { key: 'l', header: t('sal.people'), right: true, render: (s) => s.lines },
          { key: 't', header: t('word.total'), right: true, render: (s) => money(s.total, { fixed: true }), sortValue: (s) => s.total }
        ]}
        empty={sheets.loading ? undefined : <EmptyState title={t('sal.emptyTitle')} body={t('sal.emptyBody')} />}
      />
      <GenerateModal open={gen} onClose={() => setGen(false)} onDone={() => { setGen(false); sheets.reload(); }} />
      <SheetDrawer sheet={open} onClose={() => setOpen(null)} onChanged={() => sheets.reload()} />
    </div>
  );
}

function GenerateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t, money } = useI18n();
  const today = useApp((s) => s.status?.businessDate ?? '');
  const emps = useQuery('emp:list', { includeArchived: false }, open);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [adj, setAdj] = useState<Record<number, { bonus: number | null; deduction: number | null }>>({});
  const [error, setError] = useState<string | null>(null);
  const paid = useMemo(() => (emps.data ?? []).filter((e) => e.baseSalary > 0 || (adj[e.id]?.bonus ?? 0) > 0), [emps.data, adj]);
  const net = (e: EmployeeDto) => e.baseSalary + (adj[e.id]?.bonus ?? 0) - (adj[e.id]?.deduction ?? 0);
  const total = paid.reduce((a, e) => a + net(e), 0);
  const set = (id: number, k: 'bonus' | 'deduction', v: number | null) => setAdj({ ...adj, [id]: { bonus: adj[id]?.bonus ?? null, deduction: adj[id]?.deduction ?? null, [k]: v } });
  return (
    <Modal open={open} wide title={t('sal.generate')} onClose={onClose}
      footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button variant="primary" disabled={paid.length === 0 || !/^\d{4}-\d{2}$/.test(month)} data-testid="sal-confirm" onClick={() => void call('salary:generate', { month, date: today, adjustments: paid.map((e) => ({ employeeId: e.id, bonus: adj[e.id]?.bonus ?? 0, deduction: adj[e.id]?.deduction ?? 0 })) }).then(() => { toast.ok(t('sal.generated')); setAdj({}); setError(null); onDone(); }, (e: unknown) => setError(errorText(e)))}>{t('sal.generate')} · {money(total)}</Button></>}>
      <div className="grid" style={{ gap: 12 }}>
        <Field label={t('sal.month')} hint={t('sal.monthHint')}>{(a) => <Input id={a.id} type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="sal-month" />}</Field>
        <Table
          rows={paid}
          rowKey={(e) => e.id}
          columns={[
            { key: 'n', header: t('word.name'), render: (e) => e.name },
            { key: 'b', header: t('emp.baseSalary'), right: true, render: (e) => money(e.baseSalary, { fixed: true }) },
            { key: 'bo', header: t('sal.bonus'), right: true, render: (e) => <MoneyInput aria-label={`${t('sal.bonus')} ${e.name}`} value={adj[e.id]?.bonus ?? null} onChange={(v) => set(e.id, 'bonus', v)} data-testid={`sal-bonus-${e.id}`} /> },
            { key: 'de', header: t('sal.deduction'), right: true, render: (e) => <MoneyInput aria-label={`${t('sal.deduction')} ${e.name}`} value={adj[e.id]?.deduction ?? null} onChange={(v) => set(e.id, 'deduction', v)} data-testid={`sal-deduction-${e.id}`} /> },
            { key: 'nt', header: t('sal.net'), right: true, render: (e) => money(net(e), { fixed: true }) }
          ]}
          empty={<EmptyState title={t('sal.noneTitle')} body={t('sal.noneBody')} />}
        />
        {error && <div className="p-error" role="alert" data-testid="sal-error">{error}</div>}
      </div>
    </Modal>
  );
}

function SheetDrawer({ sheet, onClose, onChanged }: { sheet: SalarySheetDto | null; onClose: () => void; onChanged: () => void }) {
  const { t, money } = useI18n();
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const detail = useQuery('salary:get', { id: sheet?.id ?? 1 }, sheet !== null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const d = detail.data;
  return (
    <Drawer wide open={sheet !== null} title={sheet ? `${t('sal.sheet')} ${sheet.month}` : ''} onClose={onClose}
      footer={<><Button onClick={onClose}>{t('act.close')}</Button>{d?.status === 'posted' && role !== 'staff' && <Button variant="danger" onClick={() => setVoiding(true)} data-testid="sal-void">{t('act.void')}</Button>}</>}>
      <div className="grid" style={{ gap: 12 }}>
        {d?.status === 'void' && <Badge tone="warn">{t('state.void')}: {d.voidReason}</Badge>}
        <Table
          rows={d?.rows ?? []}
          rowKey={(r) => r.employeeId}
          columns={[
            { key: 'n', header: t('word.name'), render: (r) => r.name },
            { key: 'b', header: t('emp.baseSalary'), right: true, render: (r) => money(r.base, { fixed: true }) },
            { key: 'bo', header: t('sal.bonus'), right: true, render: (r) => money(r.bonus, { fixed: true }) },
            { key: 'de', header: t('sal.deduction'), right: true, render: (r) => money(r.deduction, { fixed: true }) },
            { key: 'nt', header: t('sal.net'), right: true, render: (r) => money(r.net, { fixed: true }) }
          ]}
        />
        <div style={{ textAlign: 'right' }}>{t('word.total')}: <strong data-testid="sal-total">{money(d?.total ?? 0)}</strong></div>
        {error && <div className="p-error" role="alert">{error}</div>}
      </div>
      <Modal open={voiding} title={t('sal.void')} onClose={() => setVoiding(false)}
        footer={<><Button onClick={() => setVoiding(false)}>{t('act.cancel')}</Button><Button variant="danger" disabled={!reason.trim()} data-testid="sal-void-confirm" onClick={() => void call('salary:void', { id: sheet!.id, reason }).then(() => { setVoiding(false); setReason(''); toast.ok(t('sal.voided')); onChanged(); onClose(); }, (e: unknown) => { setVoiding(false); setError(errorText(e)); })}>{t('act.void')}</Button></>}>
        <Field label={t('word.reason')} required>{(a) => <Textarea id={a.id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus data-testid="sal-void-reason" />}</Field>
      </Modal>
    </Drawer>
  );
}
