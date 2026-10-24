import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LOGO_MAX_BYTES, LOGO_TYPES, isBdMobile, type BusinessProfile, type Settings, type UserRow, type Role } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp, rememberMode } from '../store/app';
import { useUi } from '../store/ui';
import { Badge, Button, Card, ChangeSecretModal, Checkbox, Field, Input, Modal, Segmented, Select, SecretPicker, Switch, Table, Tabs, Textarea, TraderBrand, emptySecret, secretValid, toast, type SecretValue } from '../ui';

type Tab = 'business' | 'appearance' | 'rules' | 'users' | 'security';

export function SettingsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('business');
  const navigate = useNavigate();
  return (
    <div>
      <div className="page-h"><h2>{t('set.title')}</h2><Button onClick={() => navigate('/data')} data-testid="open-data">{t('data.title')}</Button></div>
      <Tabs
        label={t('set.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'business', label: t('set.tab.business') },
          { value: 'appearance', label: t('set.tab.appearance') },
          { value: 'rules', label: t('set.tab.rules') },
          { value: 'users', label: t('set.tab.users') },
          { value: 'security', label: t('set.tab.security') }
        ]}
      />
      <div style={{ marginTop: 16 }}>
        {tab === 'business' && <BusinessTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'rules' && <RulesTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'security' && <SecurityTab />}
      </div>
    </div>
  );
}

function useSettings() {
  const refresh = useApp((s) => s.refresh);
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    void call('settings:get').then(setS);
  }, []);
  const save = async (patch: Partial<Settings>) => {
    const next = await call('settings:save', patch);
    setS(next);
    await refresh();
    return next;
  };
  return { s, save };
}

function BusinessTab() {
  const { t } = useI18n();
  const refresh = useApp((s) => s.refresh);
  const [p, setP] = useState<BusinessProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void call('profile:get').then(setP);
  }, []);
  if (!p) return null;
  const phoneOk = p.phone === '' || isBdMobile(p.phone);
  const set = (k: keyof BusinessProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });
  return (
    <Card title={t('set.tab.business')}>
      <div className="form-grid" style={{ maxWidth: 760 }}>
        <Field label={t('biz.name')} required>{(a) => <Input id={a.id} value={p.name} onChange={set('name')} data-testid="set-biz-name" />}</Field>
        <Field label={t('biz.nameBn')}>{(a) => <Input id={a.id} value={p.nameBn} onChange={set('nameBn')} />}</Field>
        <Field label={t('biz.phone')} error={!phoneOk ? t('field.invalidPhone') : null}>{(a) => <Input id={a.id} aria-describedby={a.describedBy} invalid={a.invalid} value={p.phone} onChange={set('phone')} />}</Field>
        <Field label={t('biz.email')}>{(a) => <Input id={a.id} value={p.email} onChange={set('email')} />}</Field>
        <div className="wide"><Field label={t('biz.address')}>{(a) => <Input id={a.id} value={p.address} onChange={set('address')} />}</Field></div>
        <Field label={t('biz.taxNo')}>{(a) => <Input id={a.id} value={p.taxNo} onChange={set('taxNo')} />}</Field>
        <div className="wide"><Field label={t('biz.footer')}>{(a) => <Textarea id={a.id} rows={2} value={p.footerNote} onChange={set('footerNote')} />}</Field></div>
      </div>
      {error && <div className="p-error" role="alert">{error}</div>}
      <div className="row" style={{ marginTop: 16 }}>
        <Button
          variant="primary"
          disabled={!p.name.trim() || !phoneOk}
          data-testid="set-biz-save"
          onClick={() => void call('profile:save', p).then(() => { setError(null); toast.ok(t('set.saved')); return refresh(); }, (e: unknown) => setError(errorText(e)))}
        >
          {t('act.save')}
        </Button>
      </div>
      <LogoPicker />
    </Card>
  );
}

/** The trader's logo: a PNG, JPEG or WebP up to 256 KB, kept in the database (so backups carry it). */
function LogoPicker() {
  const { t } = useI18n();
  const refresh = useApp((s) => s.refresh);
  const logo = useApp((s) => s.status?.logo ?? null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const send = (dataUrl: string | null) => void call('profile:logo', { dataUrl }).then(() => { setError(null); toast.ok(t('set.saved')); return refresh(); }, (e: unknown) => setError(errorText(e)));
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type as (typeof LOGO_TYPES)[number])) { setError(t('set.logoType')); return; }
    if (file.size > LOGO_MAX_BYTES) { setError(t('set.logoSize')); return; }
    const r = new FileReader();
    r.onload = () => send(String(r.result));
    r.onerror = () => setError(t('set.logoType'));
    r.readAsDataURL(file);
  };
  return (
    <div className="grid" style={{ gap: 8, marginTop: 20, maxWidth: 760 }} data-testid="logo-picker">
      <strong>{t('set.logo')}</strong>
      <div className="row wrap">
        <TraderBrand testId="logo-preview" />
        <span className="spacer" />
        <input ref={input} type="file" accept={LOGO_TYPES.join(',')} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="logo-file" />
        <Button onClick={() => input.current?.click()} data-testid="logo-choose">{logo ? t('set.logoChange') : t('set.logoChoose')}</Button>
        {logo && <Button variant="ghost" onClick={() => send(null)} data-testid="logo-remove">{t('set.logoRemove')}</Button>}
      </div>
      <div className="p-hint">{t('set.logoHint')}</div>
      {error && <div className="p-error" role="alert" data-testid="logo-error">{error}</div>}
    </div>
  );
}

function AppearanceTab() {
  const { t } = useI18n();
  const ui = useUi();
  const session = useApp((s) => s.status?.session);
  const { s, save } = useSettings();
  if (!s) return null;
  const apply = (patch: Partial<Settings>) => void save(patch).then(() => toast.ok(t('set.saved')), (e: unknown) => toast.error(errorText(e)));
  return (
    <Card title={t('set.tab.appearance')}>
      <div className="grid" style={{ gap: 16, maxWidth: 640 }}>
        <Field label={t('set.language')}>
          {() => (
            <Segmented label={t('set.language')} value={ui.lang} onChange={(v) => { ui.set({ lang: v }); apply({ language: v, bnDigits: v === 'bn' }); }} options={[{ value: 'bn', label: 'বাংলা' }, { value: 'en', label: 'English' }]} />
          )}
        </Field>
        <Switch checked={s.bnDigits} label={t('set.digits')} onChange={(v) => apply({ bnDigits: v })} />
        <Field label={t('set.mode')}>
          {() => (
            <Segmented label={t('set.mode')} value={ui.mode} onChange={(v) => { if (session) rememberMode(session.userId, v); apply({ uiMode: v }); }} options={[{ value: 'simple', label: t('mode.simple') }, { value: 'full', label: t('mode.full') }]} />
          )}
        </Field>
        <Field label={t('set.animations')}>
          {() => (
            <Segmented label={t('set.animations')} value={ui.animations} onChange={(v) => { ui.set({ animations: v }); apply({ animations: v }); }} options={[{ value: 'full', label: t('sg.animFull') }, { value: 'reduced', label: t('sg.animReduced') }, { value: 'off', label: t('sg.animOff') }]} />
          )}
        </Field>
        <Field label={t('set.fontSize')}>
          {() => (
            <Segmented label={t('set.fontSize')} value={ui.fontSize} onChange={(v) => { ui.set({ fontSize: v }); apply({ fontSize: v }); }} options={[{ value: 'normal', label: t('set.size.normal') }, { value: 'large', label: t('set.size.large') }, { value: 'xlarge', label: t('set.size.xlarge') }]} />
          )}
        </Field>
        <Switch checked={ui.contrast} label={t('set.contrast')} onChange={(v) => { ui.set({ contrast: v }); apply({ highContrast: v }); }} />
        <div className="grid" style={{ gap: 10 }} data-testid="set-dock">
          <h3 className="dash-h">{t('set.dockTitle')}</h3>
          <div>
            <Switch checked={s.dockCalculator} label={t('set.dock')} onChange={(v) => apply({ dockCalculator: v })} data-testid="set-dock-calc" />
            <div className="p-hint">{t('set.dockHint')}</div>
          </div>
          <div>
            <Switch checked={s.dockGames} disabled={!s.dockCalculator} label={t('set.dockGames')} onChange={(v) => apply({ dockGames: v })} data-testid="set-dock-games" />
            <div className="p-hint">{t('set.dockGamesHint')}</div>
          </div>
        </div>
        <Field label={t('set.grouping')}>
          {(a) => (
            <Select id={a.id} value={s.grouping} onChange={(e) => apply({ grouping: e.target.value as Settings['grouping'] })}>
              <option value="lakh">{t('set.grouping.lakh')}</option>
              <option value="intl">{t('set.grouping.intl')}</option>
            </Select>
          )}
        </Field>
      </div>
    </Card>
  );
}

function RulesTab() {
  const { t } = useI18n();
  const { s, save } = useSettings();
  const [tax, setTax] = useState('');
  useEffect(() => {
    if (s) setTax(String(s.taxBp / 100));
  }, [s?.taxBp]);
  if (!s) return null;
  const apply = (patch: Partial<Settings>) => void save(patch).then(() => toast.ok(t('set.saved')), (e: unknown) => toast.error(errorText(e)));
  const taxNum = Number(tax.replace(',', '.'));
  const taxOk = tax.trim() !== '' && Number.isFinite(taxNum) && taxNum >= 0 && taxNum <= 50;
  return (
    <Card title={t('set.tab.rules')}>
      <div className="grid" style={{ gap: 16, maxWidth: 640 }}>
        <div>
          <Switch checked={s.allowNegativeStock} label={t('set.negStock')} onChange={(v) => apply({ allowNegativeStock: v })} />
          <div className="p-hint">{t('set.negStockHint')}</div>
        </div>
        <Field label={t('set.creditMode')}>
          {(a) => (
            <Select id={a.id} value={s.creditLimitMode} onChange={(e) => apply({ creditLimitMode: e.target.value as Settings['creditLimitMode'] })}>
              {(['off', 'warn', 'approval', 'block'] as const).map((m) => <option key={m} value={m}>{t(`set.credit.${m}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('set.minPrice')}>
          {(a) => (
            <Select id={a.id} value={s.minPriceMode} onChange={(e) => apply({ minPriceMode: e.target.value as Settings['minPriceMode'] })}>
              {(['off', 'approval'] as const).map((m) => <option key={m} value={m}>{t(`set.minPrice.${m}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('set.tax')} hint={t('set.taxHint')} error={tax !== '' && !taxOk ? t('field.invalidNumber') : null}>
          {(a) => (
            <div className="row">
              <Input id={a.id} aria-describedby={a.describedBy} invalid={a.invalid} numeric inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} style={{ maxWidth: 140 }} data-testid="set-tax" />
              <Button disabled={!taxOk || Math.round(taxNum * 100) === s.taxBp} onClick={() => apply({ taxBp: Math.round(taxNum * 100) })} data-testid="set-tax-save">{t('act.save')}</Button>
            </div>
          )}
        </Field>
        <Switch checked={s.roundOff} label={t('set.roundOff')} onChange={(v) => apply({ roundOff: v })} />
        <div>
          <Switch checked={s.purchaseCharges} label={t('set.purchaseCharges')} onChange={(v) => apply({ purchaseCharges: v })} />
          <div className="p-hint">{t('set.purchaseChargesHint')}</div>
        </div>
        <Field label={t('set.rollover')} hint={t('set.rolloverHint')}>
          {(a) => (
            <Select id={a.id} aria-describedby={a.describedBy} value={s.rolloverHour} onChange={(e) => apply({ rolloverHour: Number(e.target.value) })} style={{ maxWidth: 140 }}>
              {Array.from({ length: 9 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('set.idleLock')}>
          {(a) => (
            <Select id={a.id} value={s.idleLockMinutes} onChange={(e) => apply({ idleLockMinutes: Number(e.target.value) })} style={{ maxWidth: 140 }}>
              {[0, 1, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          )}
        </Field>
      </div>
    </Card>
  );
}

function UsersTab() {
  const { t } = useI18n();
  const me = useApp((s) => s.status?.session);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<UserRow | null>(null);
  const load = () => call('users:list').then(setRows);
  useEffect(() => {
    void load();
  }, []);
  return (
    <Card title={t('set.users')} actions={<Button variant="primary" onClick={() => setAdd(true)} data-testid="add-user">{t('set.addUser')}</Button>}>
      <Table
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={setEdit}
        columns={[
          { key: 'name', header: t('set.userName'), render: (r) => <span>{r.displayName} <small>({r.username})</small></span> },
          { key: 'role', header: t('set.userRole'), render: (r) => <Badge tone={r.role === 'owner' ? 'dark' : r.role === 'manager' ? 'warn' : 'default'}>{t(`role.${r.role}`)}</Badge> },
          { key: 'active', header: t('word.status'), render: (r) => <Badge tone={r.active ? 'ok' : 'red'}>{r.active ? t('set.userActive') : t('set.userInactive')}</Badge> }
        ]}
      />
      <div className="grid" style={{ gap: 4, marginTop: 12 }}>
        <strong>{t('role.hint')}</strong>
        {(['owner', 'manager', 'staff'] as const).map((r) => <div key={r}><Badge>{t(`role.${r}`)}</Badge> {t(`set.roleHelp.${r}`)}</div>)}
      </div>
      <UserModal open={add} onClose={() => setAdd(false)} onDone={() => { setAdd(false); void load(); }} />
      <UserModal open={!!edit} user={edit ?? undefined} isSelf={edit?.id === me?.userId} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void load(); }} />
    </Card>
  );
}

function UserModal({ open, user, isSelf, onClose, onDone }: { open: boolean; user?: UserRow; isSelf?: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [active, setActive] = useState(true);
  const [reset, setReset] = useState(false);
  const [sv, setSv] = useState<SecretValue>(emptySecret);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setUsername(user?.username ?? '');
    setDisplayName(user?.displayName ?? '');
    setRole(user?.role ?? 'staff');
    setActive(user?.active ?? true);
    setReset(false);
    setSv(emptySecret);
    setError(null);
  }, [open, user]);
  const valid = displayName.trim() !== '' && (user ? !reset || secretValid(sv) : /^[A-Za-z0-9._-]{2,40}$/.test(username) && secretValid(sv));
  const submit = async () => {
    try {
      if (user) {
        await call('users:update', { id: user.id, displayName: displayName.trim(), role, active, ...(reset ? { reset: { kind: sv.kind, secret: sv.secret } } : {}) });
        toast.ok(t('set.userUpdated'));
      } else {
        await call('users:create', { username, displayName: displayName.trim(), role, kind: sv.kind, secret: sv.secret });
        toast.ok(t('set.userCreated'));
      }
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal open={open} title={user ? user.displayName : t('set.addUser')} onClose={onClose} footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button variant="primary" disabled={!valid} onClick={() => void submit()} data-testid="user-save">{t('act.save')}</Button></>}>
      <div className="grid" style={{ gap: 12 }}>
        {!user && <Field label={t('owner.username')} hint={t('owner.usernameHint')} required>{(a) => <Input id={a.id} aria-describedby={a.describedBy} value={username} onChange={(e) => setUsername(e.target.value)} data-testid="user-username" />}</Field>}
        <Field label={t('set.userName')} required>{(a) => <Input id={a.id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="user-name" />}</Field>
        <Field label={t('set.userRole')}>
          {(a) => (
            <Select id={a.id} value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)} data-testid="user-role">
              {(['owner', 'manager', 'staff'] as const).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
            </Select>
          )}
        </Field>
        {user && !isSelf && <Checkbox label={t('set.userActive')} checked={active} onChange={(e) => setActive(e.target.checked)} />}
        {user ? <Checkbox label={t('set.userReset')} checked={reset} onChange={(e) => setReset(e.target.checked)} /> : null}
        {(!user || reset) && <SecretPicker value={sv} onChange={setSv} />}
        {error && <div className="p-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

function SecurityTab() {
  const { t } = useI18n();
  const [changeOpen, setChangeOpen] = useState(false);
  return (
    <div className="grid" style={{ gap: 16, maxWidth: 760 }}>
      <Card title={t('set.changeSecret')}><Button onClick={() => setChangeOpen(true)}>{t('set.changeSecret')}</Button></Card>
      <ChangeSecretModal open={changeOpen} onClose={() => setChangeOpen(false)} />
    </div>
  );
}
