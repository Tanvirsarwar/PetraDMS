import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { useI18n } from '../i18n';
import { Button, Segmented } from '../ui';
import {
  flipCard, hideMismatch, memoryDone, new2048, newMemory, newSnake, readBest, recordBest, snakeDelay, step2048, stepSnake, turnSnake,
  type Dir, type GameId, type MemoryState, type SnakeState, type State2048
} from './gamesLogic';

const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };

/** A key the game uses is handled here and stops: it never reaches the page behind (no scrolling, no shortcuts). */
function gameKey(e: RKeyboardEvent, fn: (e: RKeyboardEvent) => boolean) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if (fn(e)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function useBest(game: GameId): [number | undefined, (v: number) => void] {
  const [best, setBest] = useState<number | undefined>(() => readBest(store())[game]);
  return [best, (v: number) => setBest(recordBest(store(), game, v))];
}

function Hud({ items }: { items: { label: string; value: number | undefined; testId?: string }[] }) {
  const { int } = useI18n();
  return (
    <div className="game-hud">
      {items.map((x) => <div key={x.label}><span>{x.label}</span><strong data-testid={x.testId}>{x.value === undefined ? '–' : int(x.value)}</strong></div>)}
    </div>
  );
}

/* ---------- 2048 ---------- */
function Game2048({ active }: { active: boolean }) {
  const { t, int } = useI18n();
  const [s, setS] = useState<State2048>(() => new2048(Math.random));
  const [best, saveBest] = useBest('2048');
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const play = (d: Dir) => {
    if (!active) return;
    setS((cur) => {
      const next = step2048(cur, d, Math.random);
      if (next.over && !cur.over) saveBest(next.score);
      return next;
    });
  };
  const restart = () => {
    if (s.score > 0) saveBest(s.score);
    setS(new2048(Math.random));
  };
  const onUp = (e: RPointerEvent) => {
    const a = swipe.current;
    swipe.current = null;
    if (!a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  };
  return (
    <div className="game" tabIndex={0} data-testid="game-2048" onKeyDown={(e) => gameKey(e, (k) => { const d = KEY_DIR[k.key]; if (!d) return false; play(d); return true; })}>
      <Hud items={[{ label: t('game.score'), value: s.score, testId: 'g2048-score' }, { label: t('game.best'), value: best }]} />
      <div className="g2048" onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={onUp} data-testid="g2048-board">
        {s.board.flat().map((v, i) => <div key={i} className={`g2048-cell${v ? ` v${Math.min(v, 4096)}` : ''}`} data-v={v}>{v ? int(v) : ''}</div>)}
        {s.over && <div className="game-over"><strong>{t('game.over')}</strong><Button size="sm" variant="primary" onClick={restart}>{t('game.new')}</Button></div>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="p-hint" style={{ flex: 1 }}>{s.won ? t('game.won') : t('game.help2048')}</span>
        <Button size="sm" onClick={restart} data-testid="g2048-new">{t('game.new')}</Button>
      </div>
    </div>
  );
}

/* ---------- Snake ---------- */
const CELL = 17;
function Snake({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [s, setS] = useState<SnakeState>(() => newSnake(Math.random));
  const [running, setRunning] = useState(false);
  const [best, saveBest] = useBest('snake');
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = running && active && s.alive;

  // pause the moment the panel closes or the window loses focus
  useEffect(() => {
    if (!active) setRunning(false);
  }, [active]);
  useEffect(() => {
    if (!live) return;
    const id = window.setTimeout(() => {
      setS((cur) => {
        const next = stepSnake(cur, Math.random);
        if (!next.alive && cur.alive) saveBest(next.score);
        return next;
      });
    }, snakeDelay(s.score));
    return () => window.clearTimeout(id);
  }, [live, s]);
  useEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (!c) return;
    const css = getComputedStyle(document.documentElement);
    const red = css.getPropertyValue('--red').trim() || '#C8202F';
    const ink = css.getPropertyValue('--black').trim() || '#0F172A';
    c.fillStyle = css.getPropertyValue('--cream').trim() || '#F1F5F9';
    c.fillRect(0, 0, s.w * CELL, s.h * CELL);
    c.fillStyle = 'rgba(0,0,0,.035)';
    for (let y = 0; y < s.h; y++) for (let x = (y % 2); x < s.w; x += 2) c.fillRect(x * CELL, y * CELL, CELL, CELL);
    c.fillStyle = red;
    c.beginPath();
    c.arc(s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    c.fill();
    s.body.forEach((p, i) => {
      c.fillStyle = i === 0 ? ink : '#334155';
      c.beginPath();
      c.roundRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2, 4);
      c.fill();
    });
  }, [s]);
  const restart = () => {
    setS(newSnake(Math.random));
    setRunning(true);
  };
  const onKey = (e: RKeyboardEvent) => gameKey(e, (k) => {
    if (!active) return false;
    if (k.key === ' ') {
      if (!s.alive) restart();
      else setRunning((r) => !r);
      return true;
    }
    const d = KEY_DIR[k.key];
    if (!d) return false;
    if (!s.alive) return true;
    setS((cur) => turnSnake(cur, d));
    setRunning(true);
    return true;
  });
  return (
    <div className="game" tabIndex={0} data-testid="game-snake" onKeyDown={onKey}>
      <Hud items={[{ label: t('game.score'), value: s.score, testId: 'snake-score' }, { label: t('game.best'), value: best }]} />
      <div className="snake-wrap" onClick={() => { if (!s.alive) restart(); else setRunning((r) => !r); }}>
        <canvas ref={canvas} width={s.w * CELL} height={s.h * CELL} className="snake-canvas" aria-label={t('game.snake')} />
        {!live && (
          <div className="game-over" data-testid="snake-paused">
            <strong>{s.alive ? t('game.paused') : t('game.over')}</strong>
            <span>{s.alive ? t('game.resume') : ''}</span>
            {!s.alive && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); restart(); }}>{t('game.new')}</Button>}
          </div>
        )}
      </div>
      <div className="p-hint" style={{ marginTop: 8 }}>{t('game.helpSnake')}</div>
    </div>
  );
}

/* ---------- Memory ---------- */
const SHAPES = [
  <circle key="0" cx="12" cy="12" r="7" />,
  <rect key="1" x="5" y="5" width="14" height="14" rx="2" />,
  <path key="2" d="M12 4l8 15H4z" />,
  <path key="3" d="M12 3l9 9-9 9-9-9z" />,
  <path key="4" d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />,
  <path key="5" d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" />,
  <path key="6" d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />,
  <path key="7" d="M6 4h12l-3 8 3 8H6l3-8z" />
];
const SHAPE_COLORS = ['#14B8A6', '#0F172A', '#D4AF37', '#0F766E', '#14B8A6', '#334155', '#D4AF37', '#0F766E'];

function Memory({ active }: { active: boolean }) {
  const { t, int } = useI18n();
  const [s, setS] = useState<MemoryState>(() => newMemory(Math.random));
  const [best, saveBest] = useBest('memory');
  const [focus, setFocus] = useState(0);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const done = memoryDone(s);
  // two different cards stay up for a moment, then turn back (only while playing)
  useEffect(() => {
    if (s.open.length !== 2 || !active) return;
    const id = window.setTimeout(() => setS((cur) => hideMismatch(cur)), 750);
    return () => window.clearTimeout(id);
  }, [s.open, active]);
  const flip = (i: number) => {
    if (!active) return;
    setS((cur) => {
      const next = flipCard(cur, i);
      if (memoryDone(next) && !memoryDone(cur)) saveBest(next.moves);
      return next;
    });
  };
  const onKey = (e: RKeyboardEvent) => gameKey(e, (k) => {
    const d = KEY_DIR[k.key];
    if (!d) return false;
    const x = focus % 4;
    const y = Math.floor(focus / 4);
    const nx = d === 'left' ? Math.max(0, x - 1) : d === 'right' ? Math.min(3, x + 1) : x;
    const ny = d === 'up' ? Math.max(0, y - 1) : d === 'down' ? Math.min(3, y + 1) : y;
    const ni = ny * 4 + nx;
    setFocus(ni);
    cells.current[ni]?.focus();
    return true;
  });
  return (
    <div className="game" data-testid="game-memory" onKeyDown={onKey}>
      <Hud items={[{ label: t('game.moves'), value: s.moves, testId: 'memory-moves' }, { label: t('game.best'), value: best }]} />
      <div className="gmem">
        {s.cards.map((c, i) => {
          const up = c.matched || s.open.includes(i);
          return (
            <button
              key={i}
              ref={(el) => { cells.current[i] = el; }}
              type="button"
              tabIndex={i === focus ? 0 : -1}
              className={`gmem-card${up ? ' up' : ''}${c.matched ? ' matched' : ''}`}
              aria-label={up ? `${t('game.card', { n: int(i + 1) })}: ${c.face + 1}` : t('game.card', { n: int(i + 1) })}
              aria-pressed={up}
              onFocus={() => setFocus(i)}
              onClick={() => flip(i)}
              data-testid={`memory-card-${i}`}
              data-face={up ? c.face : undefined}
            >
              <span className="gmem-inner">
                <span className="gmem-back" aria-hidden="true" />
                <span className="gmem-front" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill={SHAPE_COLORS[c.face % SHAPE_COLORS.length]} stroke="none">{SHAPES[c.face % SHAPES.length]}</svg>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="p-hint" style={{ flex: 1 }} data-testid="memory-status">{done ? t('game.done') : t('game.helpMemory')}</span>
        <Button size="sm" onClick={() => setS(newMemory(Math.random))} data-testid="memory-new">{t('game.new')}</Button>
      </div>
    </div>
  );
}

const GAME_KEY = 'petra.dock.game.v1';
/** The games panel: three small games, each paused whenever `active` is false (panel closed, window in the background). */
export function Games({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [game, setGame] = useState<GameId>(() => {
    try {
      const v = window.localStorage.getItem(GAME_KEY);
      return v === 'snake' || v === 'memory' ? v : '2048';
    } catch {
      return '2048';
    }
  });
  const choose = (g: GameId) => {
    setGame(g);
    try {
      window.localStorage.setItem(GAME_KEY, g);
    } catch {
      /* not remembered */
    }
  };
  return (
    <div className="games" data-testid="dock-games-panel">
      <Segmented label={t('dock.games')} value={game} onChange={choose} options={[{ value: '2048', label: t('game.2048') }, { value: 'snake', label: t('game.snake') }, { value: 'memory', label: t('game.memory') }]} />
      <div className="games-body">
        {game === '2048' && <Game2048 active={active} />}
        {game === 'snake' && <Snake active={active} />}
        {game === 'memory' && <Memory active={active} />}
      </div>
    </div>
  );
}
