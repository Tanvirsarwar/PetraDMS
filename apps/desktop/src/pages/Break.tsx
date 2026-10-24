import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameScore } from '@petra/core';
import { call } from '../api';
import { useI18n } from '../i18n';
import { Button, Card } from '../ui';

const W = 640;
const H = 400;
const COLS = 10;
const ROWS = 5;
const BRICK_H = 18;
const PAD_W = 96;
const PAD_H = 12;
const COLOURS = ['#0F172A', '#14B8A6', '#D4AF37', '#0F766E', '#94A3B8'];

interface State {
  bricks: boolean[];
  px: number;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  score: number;
  lives: number;
  phase: 'ready' | 'play' | 'over' | 'won';
  left: boolean;
  right: boolean;
}

const fresh = (): State => ({ bricks: Array<boolean>(COLS * ROWS).fill(true), px: W / 2 - PAD_W / 2, bx: W / 2, by: H - 40, vx: 3, vy: -3.4, score: 0, lives: 3, phase: 'ready', left: false, right: false });

/**
 * Petra Break, the small bonus game, reached from Help, About. It is a plain breakout on a canvas: arrow keys or the mouse
 * move the bat, Space serves, Esc leaves. The best ten scores live in the shop's own database, nothing leaves the computer.
 */
export function BreakPage({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const g = useRef<State>(fresh());
  const [view, setView] = useState({ score: 0, lives: 3, phase: 'ready' as State['phase'] });
  const [top, setTop] = useState<GameScore[]>([]);
  const submitted = useRef(false);

  const finish = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    try { setTop(await call('game:submit', { score: g.current.score })); } catch { /* the score is a bonus; a failed save is not worth interrupting the game */ }
  }, []);

  useEffect(() => {
    call('game:scores', undefined).then(setTop, () => undefined);
  }, []);

  useEffect(() => {
    const s = g.current;
    const serve = () => {
      if (s.phase === 'ready') s.phase = 'play';
      else if (s.phase === 'over' || s.phase === 'won') {
        Object.assign(s, fresh());
        submitted.current = false;
        setTop((x) => x);
      }
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { s.left = true; e.preventDefault(); }
      else if (e.key === 'ArrowRight') { s.right = true; e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); serve(); }
      else if (e.key === 'Escape') onExit();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') s.left = false;
      else if (e.key === 'ArrowRight') s.right = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = () => {
      if (s.left) s.px -= 7;
      if (s.right) s.px += 7;
      s.px = Math.max(0, Math.min(W - PAD_W, s.px));
      if (s.phase === 'ready') { s.bx = s.px + PAD_W / 2; s.by = H - 40; return; }
      if (s.phase !== 'play') return;
      s.bx += s.vx;
      s.by += s.vy;
      if (s.bx < 6) { s.bx = 6; s.vx = Math.abs(s.vx); }
      if (s.bx > W - 6) { s.bx = W - 6; s.vx = -Math.abs(s.vx); }
      if (s.by < 6) { s.by = 6; s.vy = Math.abs(s.vy); }
      if (s.vy > 0 && s.by > H - 24 - 6 && s.by < H - 24 + PAD_H && s.bx > s.px - 4 && s.bx < s.px + PAD_W + 4) {
        const hit = (s.bx - (s.px + PAD_W / 2)) / (PAD_W / 2);
        const speed = Math.min(7.5, Math.hypot(s.vx, s.vy) * 1.02);
        s.vx = hit * speed * 0.8;
        s.vy = -Math.sqrt(Math.max(1, speed * speed - s.vx * s.vx));
        s.by = H - 24 - 6;
      }
      const bw = W / COLS;
      const col = Math.floor(s.bx / bw);
      const row = Math.floor((s.by - 40) / BRICK_H);
      if (row >= 0 && row < ROWS && col >= 0 && col < COLS && s.bricks[row * COLS + col]) {
        s.bricks[row * COLS + col] = false;
        s.score += (ROWS - row) * 10;
        s.vy = -s.vy;
        if (s.bricks.every((b) => !b)) { s.phase = 'won'; void finish(); }
      }
      if (s.by > H + 10) {
        s.lives -= 1;
        if (s.lives <= 0) { s.phase = 'over'; void finish(); }
        else { s.phase = 'ready'; s.vx = 3; s.vy = -3.4; }
      }
    };
    const draw = () => {
      const c = canvas.current?.getContext('2d');
      if (!c) return;
      c.fillStyle = '#F1F5F9';
      c.fillRect(0, 0, W, H);
      const bw = W / COLS;
      s.bricks.forEach((alive, i) => {
        if (!alive) return;
        c.fillStyle = COLOURS[Math.floor(i / COLS)] as string;
        c.fillRect((i % COLS) * bw + 2, 40 + Math.floor(i / COLS) * BRICK_H + 2, bw - 4, BRICK_H - 4);
      });
      c.fillStyle = '#0F172A';
      c.fillRect(s.px, H - 24, PAD_W, PAD_H);
      c.fillStyle = '#14B8A6';
      c.beginPath();
      c.arc(s.bx, s.by, 6, 0, Math.PI * 2);
      c.fill();
    };
    const frame = (now: number) => {
      acc += Math.min(100, now - last);
      last = now;
      while (acc >= 16.67) { step(); acc -= 16.67; }
      draw();
      setView((v) => (v.score === s.score && v.lives === s.lives && v.phase === s.phase ? v : { score: s.score, lives: s.lives, phase: s.phase }));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [finish, onExit]);

  return (
    <div className="break-page" data-testid="break">
      <Card title="Petra Break" actions={<Button variant="ghost" onClick={onExit} data-testid="break-exit">{t('break.exit')}</Button>}>
        <div className="break-hud">
          <span>{t('break.score')}: <b className="num" data-testid="break-score">{view.score}</b></span>
          <span>{t('break.lives')}: <b className="num" data-testid="break-lives">{view.lives}</b></span>
          <span data-testid="break-phase" className="muted">
            {view.phase === 'ready' ? t('break.ready') : view.phase === 'over' ? t('break.over') : view.phase === 'won' ? t('break.won') : ''}
          </span>
        </div>
        <canvas
          ref={canvas}
          width={W}
          height={H}
          className="break-canvas"
          data-testid="break-canvas"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); g.current.px = Math.max(0, Math.min(W - PAD_W, ((e.clientX - r.left) / r.width) * W - PAD_W / 2)); }}
          onClick={() => { if (g.current.phase === 'ready') g.current.phase = 'play'; }}
          aria-label="Petra Break"
        />
        <p className="muted" style={{ margin: '8px 0 0' }}>{t('break.help')}</p>
      </Card>
      <Card title={t('break.best')}>
        {top.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('break.none')}</p> : (
          <ol className="break-top" data-testid="break-top">
            {top.map((s, i) => <li key={i}><span>{s.player}</span><b className="num">{s.score}</b></li>)}
          </ol>
        )}
      </Card>
    </div>
  );
}
