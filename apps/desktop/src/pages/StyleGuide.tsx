import { useEffect, useState } from 'react';
import type { Health } from '@petra/core';
import {
  Badge, BarChart, Button, Card, Checkbox, CheckMark, ConfirmDialog, DateInput, Drawer, EmptyState, Field, HBarList, Input, Kbd,
  LineChart, Modal, MoneyInput, Progress, QtyInput, Segmented, Select, Skeleton, Spinner, Stamp, Stat, Switch, Table, Tabs, Textarea, toast
} from '../ui';
import { CountUp } from '../ui/CountUp';
import { useI18n } from '../i18n';
import { useUi } from '../store/ui';

interface Row { id: number; name: string; stock: number; price: number }
const ROWS: Row[] = [
  { id: 1, name: 'Marks Full Cream Milk Powder 500g', stock: 120, price: 52000 },
  { id: 2, name: 'Ama Premium Tea 200g', stock: 45, price: 18500 },
  { id: 3, name: 'Shah Instant Noodles 8x', stock: 300, price: 9600 }
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sg-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function StyleGuide() {
  const { t, n, money, int, lang } = useI18n();
  const ui = useUi();
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState<'a' | 'b'>('a');
  const [on, setOn] = useState(true);
  const [amount, setAmount] = useState<number | null>(125050);
  const [qty, setQty] = useState<number | null>(12);
  const [date, setDate] = useState<string | null>('2026-10-07');
  const [shake, setShake] = useState(0);
  const [stamp, setStamp] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    window.petra.invoke('app:health').then(setHealth).catch((e: unknown) => setHealthError(String(e)));
  }, []);

  const week = ['6', '7', '8', '9', '10', '11', '12'].map((d, i) => ({ label: n(d), value: [42, 58, 35, 71, 64, 90, 77][i]! * 1000 }));

  return (
    <div data-testid="style-guide">
      <div className="page-h">
        <h2 data-testid="title">{t('sg.title')}</h2>
        <Kbd>Ctrl+Shift+G</Kbd>
      </div>

      <Section title={t('sg.type')}>
        <div className="sg-type" data-testid="sg-type">
          <div className="sg-font"><small className="muted">--font-display · Nunito / Tiro Bangla</small><div className="display" style={{ fontSize: 'var(--fs-3xl)' }}>Rahim Traders · রহিম ট্রেডার্স</div></div>
          <div className="sg-font"><small className="muted">--font-ui · Nunito 400 / 500 / 600 · Tiro Bangla 400</small>
            <div style={{ fontSize: 'var(--fs-lg)' }}>{t('sg.typeSample')}</div>
            <div className="row wrap" style={{ gap: 16 }} data-testid="sg-weights">
              {([400, 500, 600] as const).map((w) => <span key={w} style={{ fontWeight: w }}>Nunito {w}</span>)}
            </div>
            <div lang="bn" style={{ fontSize: 'var(--fs-lg)', fontFamily: 'var(--font-ui)' }} data-testid="sg-conjuncts">যুক্তাক্ষর: ক্ষ ত্র জ্ঞ ন্দ্র স্ত্র শ্রী ঙ্গ ক্ত হ্ম ষ্ণ · ০১২৩৪৫৬৭৮৯ · ৳১,২৩,৪৫৬.৭৮</div>
          </div>
          <div className="sg-font"><small className="muted">--font-num · JetBrains Mono (tabular)</small><div className="num" style={{ textAlign: 'left', fontSize: 'var(--fs-lg)' }}>{money(12345678, { fixed: true })} · {n('1,23,456.78')} · ৳০১২৩৪৫৬৭৮৯</div></div>
          <table className="sg-scale" data-testid="sg-scale">
            <tbody>
              {(['hero', '3xl', '2xl', 'xl', 'lg', 'md', 'sm', 'xs'] as const).map((k) => (
                <tr key={k}>
                  <td className="muted"><code>--fs-{k}</code></td>
                  <td style={{ fontSize: `var(--fs-${k})`, lineHeight: 'var(--lh-tight)' }}>{k === 'hero' || k === '3xl' || k === '2xl' ? t('sg.title') : t('sg.typeSample')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row wrap" style={{ gap: 12 }}>
            {['--brand', '--accent', '--gold', '--cream', '--paper', '--line-strong', '--red', '--ok', '--warn'].map((c) => <span key={c} className="sg-swatch" style={{ background: `var(${c})` }} title={c}><small>{c}</small></span>)}
          </div>
        </div>
      </Section>

      <Section title={t('sg.buttons')}>
        <div className="row wrap">
          <Button>{t('act.cancel')}</Button>
          <Button variant="primary" kbd="F9">{t('act.save')}</Button>
          <Button variant="dark">{t('act.print')}</Button>
          <Button variant="ghost">{t('act.skip')}</Button>
          <Button variant="danger">{t('act.delete')}</Button>
          <Button size="lg" variant="primary">{t('act.confirm')}</Button>
          <Button size="sm">{t('act.edit')}</Button>
          <Button disabled>{t('state.readOnly')}</Button>
        </div>
      </Section>

      <Section title={t('sg.forms')}>
        <div className="grid cols-3">
          <Field label={t('sg.fieldDemo')} hint={t('sg.fieldHint')} required>{(a) => <Input id={a.id} aria-describedby={a.describedBy} defaultValue="Marks Milk" />}</Field>
          <div key={shake} className={shake ? 'shake' : ''}>
            <Field label={t('sg.fieldDemo')} error={shake ? t('sg.fieldError') : null}>{(a) => <Input id={a.id} aria-describedby={a.describedBy} invalid={a.invalid} />}</Field>
          </div>
          <Field label={t('sg.moneyDemo')}>{(a) => <MoneyInput id={a.id} value={amount} onChange={setAmount} />}</Field>
          <Field label={t('sg.numberDemo')}>{(a) => <QtyInput id={a.id} value={qty} onChange={setQty} />}</Field>
          <Field label={t('sg.dateDemo')}>{(a) => <DateInput id={a.id} value={date} onChange={setDate} />}</Field>
          <Field label={t('sg.selectDemo')}>
            {(a) => (
              <Select id={a.id} defaultValue="carton">
                <option value="pcs">{t('word.pcs')}</option>
                <option value="carton">Carton</option>
              </Select>
            )}
          </Field>
          <Field label={t('word.note')}>{(a) => <Textarea id={a.id} rows={2} />}</Field>
          <div className="grid">
            <Checkbox label={t('state.active')} defaultChecked />
            <Switch checked={on} onChange={setOn} label={t('mode.full')} />
          </div>
          <div><Segmented label={t('sg.animations')} value={ui.animations} onChange={(v) => ui.set({ animations: v })} options={[{ value: 'full', label: t('sg.animFull') }, { value: 'reduced', label: t('sg.animReduced') }, { value: 'off', label: t('sg.animOff') }]} /></div>
        </div>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <span>{t('sg.fontSize')}</span>
          <Segmented label={t('sg.fontSize')} value={ui.fontSize} onChange={(v) => ui.set({ fontSize: v })} options={[{ value: 'normal', label: 'A' }, { value: 'large', label: 'A+' }, { value: 'xlarge', label: 'A++' }]} />
          <Switch checked={ui.contrast} onChange={(v) => ui.set({ contrast: v })} label={t('sg.contrast')} />
        </div>
      </Section>

      <Section title={t('sg.data')}>
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <Badge>{t('state.active')}</Badge>
          <Badge tone="red">{t('word.due')}</Badge>
          <Badge tone="ok">{t('word.paid')}</Badge>
          <Badge tone="warn">{t('state.void')}</Badge>
          <Badge tone="dark">{t('role.owner')}</Badge>
        </div>
        <Tabs label={t('sg.data')} value={tab} onChange={setTab} tabs={[{ value: 'a', label: t('nav.products') }, { value: 'b', label: t('nav.inventory') }]} />
        <Table
          rows={ROWS}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', header: t('sg.tableName'), render: (r) => r.name, sortValue: (r) => r.name },
            { key: 'stock', header: t('sg.tableStock'), right: true, render: (r) => int(r.stock), sortValue: (r) => r.stock, footer: int(ROWS.reduce((s, r) => s + r.stock, 0)) },
            { key: 'price', header: t('sg.tablePrice'), right: true, render: (r) => money(r.price), sortValue: (r) => r.price }
          ]}
        />
      </Section>

      <Section title={t('sg.stats')}>
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          <Stat accent label={t('nav.sales')} value={<CountUp value={5487500} format={(v) => money(v)} />} sub={t('word.today')} />
          <Stat label={t('word.due')} value={money(1250000)} />
          <Stat label={t('word.profit')} value={money(642300)} />
          <Stat label={t('nav.inventory')} value={int(465)} sub={t('word.pcs')} />
        </div>
        <div className="grid cols-2">
          <Card title={t('sg.salesWeek')}><BarChart data={week} title={t('sg.salesWeek')} fmt={(v) => int(Math.round(v / 1000))} /></Card>
          <Card title={t('sg.salesWeek')}><LineChart data={week} title={t('sg.salesWeek')} fmt={(v) => int(Math.round(v / 1000))} /></Card>
          <Card title={t('nav.products')}><HBarList data={ROWS.map((r) => ({ label: r.name, value: r.stock }))} fmt={int} /></Card>
          <Card title={t('state.loading')}>
            <div className="grid" style={{ gap: 8 }}>
              <Skeleton height={14} />
              <Skeleton width="70%" height={14} />
              <div className="row"><Spinner label={t('state.loading')} /><Progress value={0.6} /></div>
            </div>
          </Card>
        </div>
      </Section>

      <Section title={t('sg.overlays')}>
        <div className="row wrap">
          <Button onClick={() => setModal(true)}>{t('sg.openModal')}</Button>
          <Button onClick={() => setDrawer(true)}>{t('sg.openDrawer')}</Button>
          <Button onClick={() => setConfirm(true)}>{t('confirm.title')}</Button>
          <Button onClick={() => toast.withUndo(t('sg.sampleToast'), () => toast.ok(t('toast.undone')))}>{t('sg.showToast')}</Button>
          <Button onClick={() => toast.error(t('err.NEGATIVE_STOCK', { product: 'Ama Tea', available: n(3) }))}>{t('sg.showError')}</Button>
        </div>
        <Modal open={modal} title={t('sg.sampleModal')} onClose={() => setModal(false)} footer={<Button variant="primary" onClick={() => setModal(false)}>{t('act.close')}</Button>}>
          <p style={{ margin: 0 }}>{t('sg.sampleBody')}</p>
        </Modal>
        <Drawer open={drawer} title={t('sg.sampleDrawer')} onClose={() => setDrawer(false)}>
          <p style={{ margin: 0 }}>{t('sg.sampleBody')}</p>
        </Drawer>
        <ConfirmDialog open={confirm} title={t('confirm.title')} body={t('err.IN_USE')} confirmLabel={t('act.archive')} danger onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />
      </Section>

      <Section title={t('sg.motion')}>
        <div className="row wrap">
          <Button onClick={() => setShake((s) => s + 1)}>{t('sg.shake')}</Button>
          <Button onClick={() => setStamp((s) => s + 1)}>{t('sg.stamp')}</Button>
          <Button onClick={() => setPulse((s) => s + 1)}>{t('sg.pulse')}</Button>
          <span key={`s${stamp}`} style={{ display: 'inline-flex', gap: 16, alignItems: 'center' }}>
            <CheckMark size={36} />
            <Stamp kind={stamp % 2 ? 'due' : 'paid'}>{stamp % 2 ? t('word.due').toUpperCase() : t('word.paid').toUpperCase()}</Stamp>
          </span>
          <span key={`p${pulse}`} className={pulse ? 'pulse-once' : undefined}><Badge tone="red">{t('word.due')}</Badge></span>
        </div>
      </Section>

      <Section title={t('sg.empty')}>
        <Card flat><EmptyState title={t('empty.title')} body={t('sg.emptyBody')} action={<Button variant="primary">{t('sg.emptyAction')}</Button>} /></Card>
      </Section>

      <Section title="Runtime">
        {healthError && <p data-testid="error">{healthError}</p>}
        {health && (
          <dl data-testid="health" style={{ margin: 0 }}>
            <dt>Journal mode</dt><dd data-testid="journal-mode">{health.journalMode}</dd>
            <dt>Integrity</dt><dd data-testid="integrity">{health.integrity}</dd>
            <dt>Packaged</dt><dd data-testid="packaged">{String(health.packaged)}</dd>
          </dl>
        )}
        <span data-testid="lang" hidden>{lang}</span>
        <span data-testid="sg-ready" hidden>1</span>
      </Section>
    </div>
  );
}
