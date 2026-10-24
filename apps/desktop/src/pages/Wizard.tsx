import { useEffect, useState } from 'react';
import { isBdMobile } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp, rememberMode } from '../store/app';
import { useUi } from '../store/ui';
import { Button, ProductFooter, TraderBrand, Card, Checkbox, Field, Input, Segmented, SecretPicker, emptySecret, secretValid, RecoverySheet, Toasts, toast, type SecretValue } from '../ui';

const STEPS = 6;

export function Wizard() {
  const { t, lang } = useI18n();
  const setUi = useUi((s) => s.set);
  const refresh = useApp((s) => s.refresh);
  const [step, setStep] = useState(1);
  const [biz, setBiz] = useState({ name: '', nameBn: '', address: '', phone: '', email: '', taxNo: '', footerNote: '' });
  const [owner, setOwner] = useState({ displayName: '', username: '' });
  const [sv, setSv] = useState<SecretValue>(emptySecret);
  const [mode, setMode] = useState<'simple' | 'full'>('full');
  const [folder, setFolder] = useState<{ current: string; recommended: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; userId: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void call('setup:dataDirInfo').then(setFolder);
  }, []);

  const phoneOk = biz.phone === '' || isBdMobile(biz.phone);
  const bizOk = biz.name.trim().length > 0 && phoneOk;
  const ownerOk = owner.displayName.trim().length > 0 && /^[A-Za-z0-9._-]{2,40}$/.test(owner.username) && secretValid(sv);

  const applyFolder = async (path: string | null) => {
    if (!path) return;
    setError(null);
    try {
      await call('setup:applyDataDir', { path });
      const info = await call('setup:dataDirInfo');
      setFolder(info);
      toast.ok(t('wiz.folderChanged', { path: info.current }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('setup:complete', {
        language: lang,
        business: { ...biz, name: biz.name.trim() },
        owner: { displayName: owner.displayName.trim(), username: owner.username, kind: sv.kind, secret: sv.secret },
        uiMode: mode
      });
      rememberMode(r.session.userId, mode);
      setResult({ code: r.recoveryCode, userId: r.session.userId });
      setStep(6);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setError(null);
    if (step === 5) void finish();
    else setStep(step + 1);
  };

  const canNext = step === 1 || step === 4 || (step === 2 && bizOk) || (step === 3 && ownerOk) || step === 5;

  return (
    <div className="center-screen">
      <div className="wizard-card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          {/* the shop's own name grows here as it is typed; until then, the page title */}
          {(lang === 'bn' && biz.nameBn.trim()) || biz.name.trim()
            ? <TraderBrand name={(lang === 'bn' && biz.nameBn.trim()) || biz.name.trim()} sub={t('wiz.title')} testId="wizard-brand" />
            : <h1 style={{ fontSize: 'var(--fs-xl)' }}>{t('wiz.title')}</h1>}
          <span>{t('wiz.step', { n: step, total: STEPS })}</span>
        </div>
        <div className="steps" aria-hidden="true">{Array.from({ length: STEPS }, (_, i) => <span key={i} className={i < step ? 'done' : ''} />)}</div>
        <Card title={[t('wiz.language'), t('wiz.business'), t('wiz.owner'), t('wiz.folder'), t('wiz.mode'), t('wiz.recovery')][step - 1]}>
          <div className="grid" style={{ gap: 12 }} data-testid={`wizard-step-${step}`}>
            {step === 1 && (
              <>
                <p style={{ margin: 0 }}>{t('wiz.languageBody')}</p>
                <Segmented label={t('wiz.language')} value={lang} onChange={(v) => setUi({ lang: v })} options={[{ value: 'bn', label: 'বাংলা' }, { value: 'en', label: 'English' }]} />
              </>
            )}
            {step === 2 && (
              <>
                <p style={{ margin: 0 }}>{t('wiz.businessBody')}</p>
                <div className="form-grid">
                  <Field label={t('biz.name')} required>{(a) => <Input id={a.id} value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} data-testid="biz-name" />}</Field>
                  <Field label={t('biz.nameBn')}>{(a) => <Input id={a.id} value={biz.nameBn} onChange={(e) => setBiz({ ...biz, nameBn: e.target.value })} />}</Field>
                  <Field label={t('biz.phone')} error={biz.phone !== '' && !phoneOk ? t('field.invalidPhone') : null}>{(a) => <Input id={a.id} aria-describedby={a.describedBy} invalid={a.invalid} inputMode="tel" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} data-testid="biz-phone" />}</Field>
                  <Field label={t('biz.email')}>{(a) => <Input id={a.id} value={biz.email} onChange={(e) => setBiz({ ...biz, email: e.target.value })} />}</Field>
                  <div className="wide"><Field label={t('biz.address')}>{(a) => <Input id={a.id} value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} />}</Field></div>
                  <Field label={t('biz.taxNo')}>{(a) => <Input id={a.id} value={biz.taxNo} onChange={(e) => setBiz({ ...biz, taxNo: e.target.value })} />}</Field>
                  <Field label={t('biz.footer')}>{(a) => <Input id={a.id} value={biz.footerNote} onChange={(e) => setBiz({ ...biz, footerNote: e.target.value })} />}</Field>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <p style={{ margin: 0 }}>{t('wiz.ownerBody')}</p>
                <div className="form-grid">
                  <Field label={t('owner.name')} required>{(a) => <Input id={a.id} value={owner.displayName} onChange={(e) => setOwner({ ...owner, displayName: e.target.value })} data-testid="owner-name" />}</Field>
                  <Field label={t('owner.username')} hint={t('owner.usernameHint')} required>{(a) => <Input id={a.id} aria-describedby={a.describedBy} value={owner.username} onChange={(e) => setOwner({ ...owner, username: e.target.value })} data-testid="owner-username" />}</Field>
                </div>
                <SecretPicker value={sv} onChange={setSv} />
              </>
            )}
            {step === 4 && folder && (
              <>
                <p style={{ margin: 0 }}>{t('wiz.folderBody')}</p>
                <div><strong>{t('wiz.folderCurrent')}</strong><div className="num" style={{ textAlign: 'left', wordBreak: 'break-all' }} data-testid="folder-current">{folder.current}</div></div>
                {folder.recommended !== folder.current && (
                  <div><strong>{t('wiz.folderRecommended')}</strong><div className="num" style={{ textAlign: 'left', wordBreak: 'break-all' }}>{folder.recommended}</div></div>
                )}
                <div className="row wrap">
                  {folder.recommended !== folder.current && <Button variant="primary" onClick={() => void applyFolder(folder.recommended)} data-testid="use-recommended">{t('wiz.useRecommended')}</Button>}
                  <Button onClick={() => void call('setup:chooseDataDir').then((r) => applyFolder(r.path))}>{t('wiz.chooseFolder')}</Button>
                </div>
              </>
            )}
            {step === 5 && (
              <>
                <p style={{ margin: 0 }}>{t('wiz.modeBody')}</p>
                <button type="button" className="opt-card" aria-pressed={mode === 'simple'} onClick={() => setMode('simple')}>{t('wiz.modeSimple')}</button>
                <button type="button" className="opt-card" aria-pressed={mode === 'full'} onClick={() => setMode('full')} data-testid="mode-full">{t('wiz.modeFull')}</button>
              </>
            )}
            {step === 6 && result && (
              <>
                <p style={{ margin: 0 }}>{t('wiz.recoveryBody')}</p>
                <div className="p-badge red" style={{ justifySelf: 'start' }}>{t('wiz.recoveryWarn')}</div>
                <RecoverySheet code={result.code} business={biz.name} owner={owner.displayName} />
                <div className="no-print"><Checkbox label={t('wiz.recoveryConfirm')} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="recovery-confirm" /></div>
              </>
            )}
            {error && <div className="p-error" role="alert" data-testid="wizard-error">{error}</div>}
          </div>
        </Card>
        <div className="row no-print" style={{ marginTop: 12 }}>
          {step > 1 && step < 6 && <Button onClick={() => setStep(step - 1)}>{t('act.back')}</Button>}
          <span className="spacer" />
          {step < 6 ? (
            <Button variant="primary" size="lg" disabled={!canNext || busy} onClick={next} data-testid="wizard-next">{step === 5 ? t('act.finish') : t('act.next')}</Button>
          ) : (
            <Button variant="primary" size="lg" disabled={!confirmed} onClick={() => void refresh()} data-testid="wizard-finish">{t('wiz.finish')}</Button>
          )}
        </div>
        <ProductFooter />
      </div>
      <Toasts />
    </div>
  );
}
