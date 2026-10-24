import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { useI18n } from '../i18n';

export interface TourStep {
  /** CSS selector of the thing to point at; when it is not on screen the step is shown in the middle. */
  target: string | null;
  titleKey: string;
  bodyKey: string;
}

/** The order is the order of a working day: sell, stock, people, money, reports, safety, then where to get help. */
export const TOUR_STEPS: TourStep[] = [
  { target: null, titleKey: 'tour.welcome.t', bodyKey: 'tour.welcome.b' },
  { target: '.nav a[href="#/sales"]', titleKey: 'tour.sell.t', bodyKey: 'tour.sell.b' },
  { target: '.nav a[href="#/products"]', titleKey: 'tour.products.t', bodyKey: 'tour.products.b' },
  { target: '.nav a[href="#/customers"], .nav a[href="#/people"]', titleKey: 'tour.people.t', bodyKey: 'tour.people.b' },
  { target: '.nav a[href="#/reports"]', titleKey: 'tour.reports.t', bodyKey: 'tour.reports.b' },
  { target: '.nav a[href="#/backup"]', titleKey: 'tour.backup.t', bodyKey: 'tour.backup.b' },
  { target: '[data-testid="mode-toggle"]', titleKey: 'tour.mode.t', bodyKey: 'tour.mode.b' },
  { target: '[data-testid="help-open"]', titleKey: 'tour.help.t', bodyKey: 'tour.help.b' }
];

const tourKey = (userId: number) => `petra.tour.${userId}`;

export function tourSeen(userId: number): boolean {
  try {
    return localStorage.getItem(tourKey(userId)) !== null;
  } catch {
    return true;
  }
}
export function markTour(userId: number, value: 'done' | 'skipped'): void {
  try {
    localStorage.setItem(tourKey(userId), value);
  } catch {
    /* ignore */
  }
}

const rectOf = (sel: string | null): DOMRect | null => {
  if (!sel) return null;
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};

/** A guided walk through the menu. Esc or Skip ends it; Left and Right arrows move; it never changes any data. */
export function Tour({ onEnd }: { onEnd: (finished: boolean) => void }) {
  const { t, int } = useI18n();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  const steps = TOUR_STEPS.filter((s) => s.target === null || rectOf(s.target) !== null);
  const step = steps[Math.min(i, steps.length - 1)] as TourStep;
  const last = i >= steps.length - 1;

  const measure = useCallback(() => setRect(rectOf(step.target)), [step.target]);
  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  useEffect(() => next.current?.focus(), [i]);
  // The listener is added once and reads the latest values through refs. Re-adding it on every render would drop a key
  // pressed in the same instant another keydown handler (the launch animation's) caused a re-render.
  const live = useRef({ onEnd, count: steps.length });
  live.current = { onEnd, count: steps.length };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); live.current.onEnd(false); }
      else if (e.key === 'ArrowRight') setI((n) => Math.min(live.current.count - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pad = 6;
  const card: React.CSSProperties = rect
    ? { left: Math.min(window.innerWidth - 340, rect.right + 16), top: Math.max(12, Math.min(window.innerHeight - 220, rect.top - 8)) }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('tour.title')} data-testid="tour">
      {rect ? <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} /> : <div className="tour-dim" />}
      <div className="tour-card" style={card}>
        <div className="tour-count">{t('tour.step', { n: int(Math.min(i, steps.length - 1) + 1), total: int(steps.length) })}</div>
        <h3 data-testid="tour-title">{t(step.titleKey)}</h3>
        <p>{t(step.bodyKey)}</p>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button size="sm" onClick={() => onEnd(false)} data-testid="tour-skip">{t('tour.skip')}</Button>
          {i > 0 && <Button size="sm" onClick={() => setI(i - 1)} data-testid="tour-back">{t('tour.back')}</Button>}
          <Button size="sm" variant="primary" ref={next} onClick={() => (last ? onEnd(true) : setI(i + 1))} data-testid="tour-next">{last ? t('tour.done') : t('tour.next')}</Button>
        </div>
      </div>
    </div>
  );
}
