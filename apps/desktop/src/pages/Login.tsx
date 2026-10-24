import { useEffect, useRef, useState } from 'react';
import type { LoginUser } from '@petra/core';
import { call, errorText } from '../api';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { useUi } from '../store/ui';
import petraLogo from '../assets/brand/petra-logo.png';
import { Button, ProductFooter, TraderBrand, Field, Input, Modal, Segmented, SecretPicker, emptySecret, secretValid, RecoverySheet, Toasts, Scene3D, toast, type SecretValue } from '../ui';

function Keypad({ onDigit, onBack, disabled }: { onDigit: (d: string) => void; onBack: () => void; disabled?: boolean }) {
  const { n } = useI18n();
  return (
    <div className="keypad" role="group" aria-label="PIN keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <Button key={d} disabled={disabled} onClick={() => onDigit(d)}>{n(d)}</Button>
      ))}
      <span />
      <Button disabled={disabled} onClick={() => onDigit('0')}>{n('0')}</Button>
      <Button disabled={disabled} onClick={onBack} aria-label="Backspace">&lt;</Button>
    </div>
  );
}

export function Login() {
  const { t, n, lang } = useI18n();
  const setUi = useUi((s) => s.set);
  const refresh = useApp((s) => s.refresh);
  const [users, setUsers] = useState<LoginUser[] | null>(null);
  const [picked, setPicked] = useState<LoginUser | null>(null);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recover, setRecover] = useState(false);
  const submitting = useRef(false);

  const load = () => call('auth:users').then((u) => {
    setUsers(u);
    if (u.length === 1) setPicked(u[0]!);
  });
  useEffect(() => {
    void load();
  }, []);

  const submit = async (value: string) => {
    if (!picked || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await call('auth:login', { userId: picked.id, secret: value });
      await refresh();
    } catch (e) {
      setError(errorText(e));
      setSecret('');
      void load();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  // PINs submit as soon as the digits are entered and the user taps Enter; typing on a keyboard also works.
  useEffect(() => {
    if (!picked || picked.secretKind !== 'pin') return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setSecret((s) => (s.length < 6 ? s + e.key : s));
      else if (e.key === 'Backspace') setSecret((s) => s.slice(0, -1));
      else if (e.key === 'Enter') void submit(secretRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked]);
  const secretRef = useRef('');
  secretRef.current = secret;

  const lockedMsg = picked?.lockedUntil ? t('auth.lockedUntil', { time: n(new Date(picked.lockedUntil).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { hour: '2-digit', minute: '2-digit' })) }) : null;

  return (
    <div className="center-screen has-scene login-screen">
      <Scene3D />
      <div className="login-top">
        <Segmented label={t('sg.language')} value={lang} onChange={(v) => setUi({ lang: v })} options={[{ value: 'bn', label: 'বাংলা' }, { value: 'en', label: 'EN' }]} />
      </div>
      <main className="login-glass" aria-labelledby="login-title">
        <img className="login-logo" src={petraLogo} width={1280} height={553} alt="PETRA Software Solutions" data-testid="login-logo" draggable={false} />
        <TraderBrand testId="login-brand" />
        <h2 className="login-title" id="login-title">{picked ? picked.displayName : t('auth.whoIsThis')}</h2>
        <div className="login-body">
          {!picked && (
            <div className="grid" style={{ gap: 8 }} data-testid="user-list">
              {(users ?? []).map((u) => (
                <button key={u.id} type="button" className="user-tile" onClick={() => { setPicked(u); setSecret(''); setError(null); }}>
                  <span className="avatar" aria-hidden="true">{u.displayName.slice(0, 1).toUpperCase()}</span>
                  <span style={{ flex: 1 }}>
                    <strong>{u.displayName}</strong>
                    <br />
                    <small>{t(`role.${u.role}`)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {picked && (
            <>
              <p className="login-hint">{picked.secretKind === 'pin' ? t('auth.enterPin') : t('auth.enterPassword')}</p>
              {picked.secretKind === 'pin' ? (
                <>
                  <div className="pin-dots" data-testid="pin-dots" aria-label={`${secret.length}`}>
                    {Array.from({ length: 6 }, (_, i) => (<span key={i} className={i < secret.length ? 'on' : ''} />))}
                  </div>
                  <div style={{ display: 'grid', placeItems: 'center' }}>
                    <Keypad disabled={busy || !!picked.lockedUntil} onDigit={(d) => setSecret((s) => (s.length < 6 ? s + d : s))} onBack={() => setSecret((s) => s.slice(0, -1))} />
                  </div>
                  <Button variant="primary" size="lg" disabled={busy || secret.length < 4 || !!picked.lockedUntil} onClick={() => void submit(secret)} data-testid="signin">{t('auth.signIn')}</Button>
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); void submit(secret); }} className="grid" style={{ gap: 12 }}>
                  <Field label={t('auth.password')}>
                    {(a) => <Input id={a.id} type="password" autoFocus autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} data-testid="password" />}
                  </Field>
                  <Button variant="primary" size="lg" type="submit" disabled={busy || secret.length < 1 || !!picked.lockedUntil} data-testid="signin">{t('auth.signIn')}</Button>
                </form>
              )}
              {(error || lockedMsg) && <div className="p-error shake" role="alert" data-testid="login-error">{lockedMsg ?? error}</div>}
              <div className="login-actions">
                {users && users.length > 1 && <Button variant="ghost" onClick={() => { setPicked(null); setSecret(''); setError(null); }}>{t('act.back')}</Button>}
                <span className="spacer" />
                {picked.role === 'owner' && <Button variant="ghost" onClick={() => setRecover(true)} data-testid="forgot">{t('auth.forgot')}</Button>}
              </div>
            </>
          )}
        </div>
        <ProductFooter />
      </main>
      <Recover open={recover} onClose={() => setRecover(false)} onDone={() => { setRecover(false); void refresh(); }} />
      <Toasts />
    </div>
  );
}

function Recover({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [sv, setSv] = useState<SecretValue>(emptySecret);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [name, setName] = useState('');
  const submit = async () => {
    setError(null);
    try {
      const r = await call('auth:recover', { recoveryCode: code, kind: sv.kind, newSecret: sv.secret });
      setFresh(r.recoveryCode);
      setName(r.session.displayName);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal
      open={open}
      title={t('auth.recoverTitle')}
      onClose={fresh ? onDone : onClose}
      footer={fresh ? <Button variant="primary" onClick={() => { toast.ok(t('toast.saved')); onDone(); }} data-testid="recover-done">{t('act.close')}</Button> : (
        <>
          <Button onClick={onClose}>{t('act.cancel')}</Button>
          <Button variant="primary" disabled={code.trim().length < 8 || !secretValid(sv)} onClick={() => void submit()} data-testid="recover-submit">{t('act.confirm')}</Button>
        </>
      )}
    >
      {fresh ? (
        <div className="grid" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>{t('auth.recoverDone')}</p>
          <RecoverySheet code={fresh} business="" owner={name} />
        </div>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>{t('auth.recoverBody')}</p>
          <Field label={t('auth.recoveryCode')} required>{(a) => <Input id={a.id} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" data-testid="recover-code" />}</Field>
          <SecretPicker value={sv} onChange={setSv} />
          {error && <div className="p-error" role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
