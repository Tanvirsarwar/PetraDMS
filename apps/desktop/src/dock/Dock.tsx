import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Button } from '../ui';
import { IconCalc, IconClose, IconGame, IconGrip } from '../ui/icons';
import { DockCalculator } from './DockCalculator';
import { Games } from './Games';

type Tool = 'calc' | 'games';
interface Saved { open: Tool | null; x: number | null; y: number | null }
const KEY = 'petra.dock.v1';
const PANEL_W = { calc: 300, games: 340 } as const;
const MARGIN = 8;

function readSaved(): Saved {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return { open: v.open === 'calc' || v.open === 'games' ? v.open : null, x: typeof v.x === 'number' ? v.x : null, y: typeof v.y === 'number' ? v.y : null };
  } catch {
    return { open: null, x: null, y: null };
  }
}
function writeSaved(s: Saved) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not remembered */
  }
}
/** Keeps the panel fully on screen (and clear of the dock handle). */
export function clampPos(x: number, y: number, w: number, h: number, vw: number, vh: number, handle = 44): { x: number; y: number } {
  return { x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - w - handle - MARGIN)), y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - h - MARGIN)) };
}
const modalOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');
const typingIn = (el: Element | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);

/**
 * The utility dock (v1.1.1, D23): a slim handle on the right edge with Calculator and Games. A tool opens as a
 * floating card over the page (the page never resizes), can be dragged by its header, remembers where it was and
 * whether it was open, sits under dialogs, is hidden when printing, and never takes the focus from the field the
 * user is typing in: it only gets the keyboard once the user clicks into it.
 * Alt+C toggles the calculator and Alt+G the games (by key position, so a Bangla keyboard layout works too).
 */
export function Dock() {
  const { t } = useI18n();
  const settings = useApp((s) => s.status?.settings);
  const showCalc = settings?.dockCalculator ?? true;
  const showGames = showCalc && (settings?.dockGames ?? true);
  const [saved, setSaved] = useState<Saved>(readSaved);
  const [focused, setFocused] = useState(() => document.hasFocus() && document.visibilityState === 'visible');
  const [mounted, setMounted] = useState<Record<Tool, boolean>>(() => ({ calc: saved.open === 'calc', games: saved.open === 'games' }));
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);

  // a tool that is switched off in Settings is closed
  const open: Tool | null = saved.open === 'games' && !showGames ? null : saved.open === 'calc' && !showCalc ? null : saved.open;

  const update = useCallback((patch: Partial<Saved>) => {
    setSaved((cur) => {
      const next = { ...cur, ...patch };
      writeSaved(next);
      return next;
    });
  }, []);
  const toggle = useCallback((tool: Tool) => {
    setMounted((m) => ({ ...m, [tool]: true }));
    setSaved((cur) => {
      const next = { ...cur, open: cur.open === tool ? null : tool };
      writeSaved(next);
      return next;
    });
  }, []);
  const close = useCallback(() => {
    // if the keyboard was inside the panel, give it back to the page instead of losing it
    if (panel.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    update({ open: null });
  }, [update]);

  // Alt+C / Alt+G anywhere; Esc closes the panel when the keyboard is in it, or when nothing else would take Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyG')) {
        const tool: Tool = e.code === 'KeyC' ? 'calc' : 'games';
        if ((tool === 'calc' && !showCalc) || (tool === 'games' && !showGames) || modalOpen()) return;
        e.preventDefault();
        toggle(tool);
      } else if (e.key === 'Escape' && open) {
        const inPanel = !!panel.current?.contains(document.activeElement);
        if (inPanel || (!modalOpen() && !typingIn(document.activeElement))) {
          if (!inPanel && e.defaultPrevented) return;
          close();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, showCalc, showGames, toggle, close]);

  // games pause when the window is in the background
  useEffect(() => {
    const sync = () => setFocused(document.hasFocus() && document.visibilityState === 'visible');
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  // keep the panel on screen when the window is resized
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const tool = open ?? 'calc';
  const w = PANEL_W[tool];
  // the card's real height (it changes with the tool and the calculator history), for centring and clamping
  const [cardH, setCardH] = useState(480);
  useEffect(() => {
    const el = panel.current?.querySelector('.dock-card');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCardH((el as HTMLElement).offsetHeight || 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = Math.min(cardH, vp.h - 2 * MARGIN);
  // first time: beside the handle, vertically centred, clear of the top bar
  const pos = clampPos(saved.x ?? vp.w - w - 56, saved.y ?? Math.max(112, Math.round((vp.h - h) / 2)), w, h, vp.w, vp.h);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = clampPos(e.clientX - d.dx, e.clientY - d.dy, w, h, vp.w, vp.h);
    setSaved((cur) => ({ ...cur, x: p.x, y: p.y }));
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    writeSaved({ ...saved });
  };

  if (!showCalc) return null;
  return (
    <>
      <div className="dock-handle no-print" role="toolbar" aria-label={t('dock.label')} aria-orientation="vertical" data-testid="dock">
        <Button variant="ghost" size="icon" className={open === 'calc' ? 'on' : ''} aria-pressed={open === 'calc'} title={t('dock.calcTip')} aria-label={t('dock.calc')} aria-keyshortcuts="Alt+C" onClick={() => toggle('calc')} data-testid="dock-calc"><IconCalc size={20} /></Button>
        {showGames && <Button variant="ghost" size="icon" className={open === 'games' ? 'on' : ''} aria-pressed={open === 'games'} title={t('dock.gamesTip')} aria-label={t('dock.games')} aria-keyshortcuts="Alt+G" onClick={() => toggle('games')} data-testid="dock-games"><IconGame size={20} /></Button>}
      </div>
      <div
        ref={panel}
        className="dock-panel no-print"
        data-open={open ? 'true' : 'false'}
        role="dialog"
        aria-modal="false"
        aria-label={open === 'games' ? t('dock.games') : t('dock.calc')}
        aria-hidden={!open}
        style={{ width: w, transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
        data-testid="dock-panel"
      >
        <div className="dock-card">
          <div className="dock-h" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title={t('dock.move')} data-testid="dock-drag">
            <IconGrip size={16} className="dock-grip" />
            <strong>{open === 'games' ? t('dock.games') : t('dock.calc')}</strong>
            <kbd className="kbd">{open === 'games' ? 'Alt+G' : 'Alt+C'}</kbd>
            <span className="spacer" />
            <Button variant="ghost" size="icon" className="sm" aria-label={t('dock.close')} onClick={close} data-testid="dock-close"><IconClose size={16} /></Button>
          </div>
          <div className="dock-b">
            {/* both tools stay mounted once opened, so a sum or a game survives closing and reopening */}
            {mounted.calc && <div hidden={open !== 'calc'}><DockCalculator /></div>}
            {mounted.games && showGames && <div hidden={open !== 'games'}><Games active={open === 'games' && focused} /></div>}
          </div>
        </div>
      </div>
    </>
  );
}
