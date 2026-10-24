import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Badge, ChangeSecretModal, ErrorBoundary, Modal, ProductFooter, Segmented, Toasts, TraderBrand, useTraderName } from '../ui';
import { VENDOR } from '@petra/core';
import { call } from '../api';
import { useI18n } from '../i18n';
import { effectiveMotion, useUi } from '../store/ui';
import { rememberMode, useApp } from '../store/app';
import { visibleNav } from './nav';
import { registeredPaths } from '../pages/registry';
import { Tour, markTour, tourSeen } from '../tour/Tour';
import { Dock } from '../dock/Dock';

/** Shown after the app restored a backup by itself because the data file was damaged. The Owner dismisses it once read. */
function RecoveryBanner() {
  const { t, n } = useI18n();
  const rec = useApp((s) => s.status?.recovery);
  const refresh = useApp((s) => s.refresh);
  const role = useApp((s) => s.status?.session?.role);
  const navigate = useNavigate();
  if (!rec) return null;
  const when = (iso: string) => n(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`);
  return (
    <div className="banner" role="alert" data-testid="recovery-banner">
      <span style={{ flex: 1 }}>{t('rec.banner', { when: when(rec.backupAt) })}</span>
      {role === 'owner' && <Button size="sm" onClick={() => navigate('/backup')}>{t('nav.backup')}</Button>}
      <Button size="sm" onClick={() => void call('recovery:dismiss').then(refresh)} data-testid="recovery-dismiss">{t('rec.understood')}</Button>
    </div>
  );
}

/** While demo mode is on, every screen says so, and the Owner can clear it. */
function DemoBanner() {
  const { t } = useI18n();
  const demo = useApp((s) => s.status?.demo);
  const role = useApp((s) => s.status?.session?.role);
  const navigate = useNavigate();
  if (!demo) return null;
  return (
    <div className="banner warn" role="status" data-testid="demo-banner">
      <span style={{ flex: 1 }}>{t('demo.banner')}</span>
      {role === 'owner' && <Button size="sm" onClick={() => navigate('/data', { state: { tab: 'demo' } })}>{t('demo.clear')}</Button>}
    </div>
  );
}

/** Offered once to each person after sign-in; "Not now" is remembered too. */
function TourInvite({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div className="banner tour-invite" role="status" data-testid="tour-invite">
      <span style={{ flex: 1 }}>{t('tour.invite')}</span>
      <Button size="sm" onClick={onStart} data-testid="tour-invite-start">{t('tour.start')}</Button>
      <Button size="sm" onClick={onDismiss} data-testid="tour-invite-dismiss">{t('tour.notNow')}</Button>
    </div>
  );
}

function Banners({ invite }: { invite: ReactNode }) {
  return (
    <div className="banners" style={{ gridColumn: 2 }}>
      <RecoveryBanner />
      <DemoBanner />
      {invite}
    </div>
  );
}

export function Shell() {
  const { t } = useI18n();
  const mode = useUi((s) => s.mode);
  const lang = useUi((s) => s.lang);
  const setUi = useUi((s) => s.set);
  const animations = useUi((s) => s.animations);
  const liteActive = useUi((s) => s.liteActive);
  const session = useApp((s) => s.status?.session);
  const refresh = useApp((s) => s.refresh);
  const loc = useLocation();
  const navigate = useNavigate();
  const [account, setAccount] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const role = session?.role ?? 'staff';
  const nav = visibleNav(mode, registeredPaths(role));
  const [launching, setLaunching] = useState(() => effectiveMotion({ animations, liteActive }) === 'full' && !sessionStorageFlag());
  const recovery = useApp((s) => s.status?.recovery);
  const demo = useApp((s) => s.status?.demo);
  const [touring, setTouring] = useState(false);
  const [inviteGone, setInviteGone] = useState(false);
  const showInvite = !!session && !inviteGone && !touring && !tourSeen(session.userId);
  const endTour = (finished: boolean) => {
    setTouring(false);
    setInviteGone(true);
    if (session) markTour(session.userId, finished ? 'done' : 'skipped');
  };
  const hasBanner = showInvite || !!demo || !!recovery;

  useEffect(() => {
    const start = () => setTouring(true);
    window.addEventListener('petra:tour', start);
    return () => window.removeEventListener('petra:tour', start);
  }, []);

  useEffect(() => {
    if (!launching) return;
    markLaunched();
    const end = () => setLaunching(false);
    const h = window.setTimeout(end, 700);
    window.addEventListener('keydown', end, { once: true });
    return () => {
      window.clearTimeout(h);
      window.removeEventListener('keydown', end);
    };
  }, [launching]);

  const title = nav.find((n) => (n.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.path)));
  const trader = useTraderName();
  // the window title carries the shop's name first; the product name follows
  useEffect(() => {
    document.title = trader ? `${trader} · ${VENDOR.productName}` : VENDOR.productName;
  }, [trader]);
  const signOut = async () => {
    await call('auth:logout');
    await refresh();
  };

  return (
    <div className={`shell${mode === 'simple' ? ' simple' : ''}${launching ? ' launching' : ''}`} style={hasBanner ? { gridTemplateRows: 'auto 48px 1fr' } : undefined}>
      <aside className="sidebar" style={hasBanner ? { gridRow: '1 / span 3' } : undefined}>
        <div className="brand">
          <TraderBrand />
        </div>
        <nav className="nav" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.id} to={n.path} end={n.path === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <n.Icon />
              <span>{t(n.labelKey)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <Button size="sm" onClick={() => session && rememberMode(session.userId, mode === 'simple' ? 'full' : 'simple')} className="side-btn" data-testid="mode-toggle">
            {mode === 'simple' ? t('mode.switchToFull') : t('mode.switchToSimple')}
          </Button>
          <ProductFooter />
        </div>
      </aside>
      {hasBanner && <Banners invite={showInvite ? <TourInvite onStart={() => setTouring(true)} onDismiss={() => endTour(false)} /> : null} />}
      <header className="topbar">
        <h1>{title ? t(title.labelKey) : t('app.name')}</h1>
        <Button size="sm" onClick={() => navigate('/help')} aria-label={t('help.title')} data-testid="help-open">{t('help.short')}</Button>
        <Segmented label={t('sg.language')} value={lang} options={[{ value: 'bn', label: 'বাংলা' }, { value: 'en', label: 'EN' }]} onChange={(v) => setUi({ lang: v })} />
        {session && (
          <Button size="sm" onClick={() => setAccount(true)} data-testid="account">
            {session.displayName} <Badge tone="dark">{t(`role.${session.role}`)}</Badge>
          </Button>
        )}
      </header>
      <main className="main">
        <div key={loc.pathname} className="page-fade">
          <ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary>
        </div>
      </main>
      <Modal open={account} title={session?.displayName ?? ''} onClose={() => setAccount(false)}>
        <div className="grid" style={{ gap: 8 }}>
          <Button onClick={() => { setAccount(false); setChangeOpen(true); }} data-testid="account-change">{t('set.changeSecret')}</Button>
          <Button variant="dark" onClick={() => void signOut()} data-testid="signout">{t('auth.signOut')}</Button>
        </div>
      </Modal>
      <ChangeSecretModal open={changeOpen} onClose={() => setChangeOpen(false)} />
      {touring && <Tour onEnd={endTour} />}
      <Dock />
      <Toasts />
    </div>
  );
}

function sessionStorageFlag(): boolean {
  try {
    return sessionStorage.getItem('petra.launched') === '1';
  } catch {
    return false;
  }
}
function markLaunched() {
  try {
    sessionStorage.setItem('petra.launched', '1');
  } catch {
    /* ignore */
  }
}
