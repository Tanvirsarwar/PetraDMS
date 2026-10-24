import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Shell } from './shell/Shell';
import { pagesFor } from './pages/registry';
import { Login } from './pages/Login';
import { Wizard } from './pages/Wizard';
import { applyUiToDocument, useUi } from './store/ui';
import { useApp } from './store/app';
import { startLiteGuard } from './motion/lite';
import { Skeleton, toast } from './ui';
import { translate } from './i18n';
import { call } from './api';
import { GlobalTools } from './tools/GlobalTools';

function Hotkeys() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        navigate('/style-guide');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return null;
}

/** Optional auto-lock after a period without keyboard or pointer use (Settings > Sales rules). */
function IdleLock() {
  const minutes = useApp((s) => s.status?.settings.idleLockMinutes ?? 0);
  const refresh = useApp((s) => s.refresh);
  useEffect(() => {
    if (!minutes) return;
    let h = 0;
    const arm = () => {
      window.clearTimeout(h);
      h = window.setTimeout(() => {
        void call('auth:logout').then(refresh);
      }, minutes * 60_000);
    };
    const evts = ['keydown', 'pointerdown', 'wheel'] as const;
    evts.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      window.clearTimeout(h);
      evts.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [minutes, refresh]);
  return null;
}

function Authed() {
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const pages = pagesFor(role);
  const home = pages.find((p) => p.nav)?.path ?? '/style-guide';
  return (
    <HashRouter>
      <Hotkeys />
      <GlobalTools />
      <IdleLock />
      <Routes>
        <Route element={<Shell />}>
          {pages.map((p) => (
            <Route key={p.path} path={p.path} element={p.element} />
          ))}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export function App() {
  const status = useApp((s) => s.status);
  const loading = useApp((s) => s.loading);
  const fatal = useApp((s) => s.fatal);
  const refresh = useApp((s) => s.refresh);
  useEffect(() => {
    applyUiToDocument();
    const unsub = useUi.subscribe(applyUiToDocument);
    const stop = startLiteGuard(() => toast.ok(translate(useUi.getState().lang, 'sg.lite')));
    void refresh();
    return () => {
      unsub();
      stop();
    };
  }, [refresh]);

  if (fatal) return <div className="center-screen" role="alert"><p data-testid="fatal">{fatal}</p></div>;
  if (loading || !status) {
    return (
      <div className="center-screen" aria-busy="true">
        <div style={{ width: 280 }}><Skeleton height={20} /></div>
      </div>
    );
  }
  if (status.needsSetup) return <Wizard />;
  if (!status.session) return <Login />;
  return <Authed />;
}

