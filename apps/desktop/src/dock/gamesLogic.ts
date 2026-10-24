/**
 * Game rules for the dock's three small games (v1.1.1). Pure functions with an injected random source, so the
 * same rules drive the screen and the tests. No timers, no DOM.
 */

export type Rng = () => number;
export type Dir = 'up' | 'down' | 'left' | 'right';

/* ===================== 2048 ===================== */

export type Board = number[][]; // 0 = empty
export const SIZE_2048 = 4;
export const WIN_TILE = 2048;

export function emptyBoard(size = SIZE_2048): Board {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

/**
 * Slides one row towards index 0 and merges equal neighbours once per move: [2,2,2,2] → [4,4,0,0],
 * [2,2,4,0] → [4,4,0,0] (the new 4 does not merge again), [4,0,4,8] → [8,8,0,0].
 */
export function slideRow(row: number[]): { row: number[]; gained: number } {
  const tiles = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    const v = tiles[i]!;
    if (i + 1 < tiles.length && tiles[i + 1] === v) {
      out.push(v * 2);
      gained += v * 2;
      i++;
    } else out.push(v);
  }
  while (out.length < row.length) out.push(0);
  return { row: out, gained };
}

const transpose = (b: Board): Board => b[0]!.map((_, c) => b.map((r) => r[c]!));
const reverseRows = (b: Board): Board => b.map((r) => [...r].reverse());

export function move2048(board: Board, dir: Dir): { board: Board; moved: boolean; gained: number } {
  // turn every direction into "left", slide, and turn back
  let b = board.map((r) => [...r]);
  if (dir === 'right') b = reverseRows(b);
  else if (dir === 'up') b = transpose(b);
  else if (dir === 'down') b = reverseRows(transpose(b));
  let gained = 0;
  b = b.map((r) => {
    const s = slideRow(r);
    gained += s.gained;
    return s.row;
  });
  if (dir === 'right') b = reverseRows(b);
  else if (dir === 'up') b = transpose(b);
  else if (dir === 'down') b = transpose(reverseRows(b));
  const moved = b.some((r, i) => r.some((v, j) => v !== board[i]![j]));
  return { board: b, moved, gained };
}

/** Puts a 2 (90 %) or a 4 (10 %) on a random empty cell. A full board is returned as it is. */
export function spawn(board: Board, rng: Rng): Board {
  const empty: [number, number][] = [];
  board.forEach((r, i) => r.forEach((v, j) => { if (v === 0) empty.push([i, j]); }));
  if (empty.length === 0) return board;
  const [i, j] = empty[Math.min(empty.length - 1, Math.floor(rng() * empty.length))]!;
  const b = board.map((r) => [...r]);
  b[i]![j] = rng() < 0.9 ? 2 : 4;
  return b;
}

export function canMove(board: Board): boolean {
  return (['left', 'right', 'up', 'down'] as const).some((d) => move2048(board, d).moved);
}
export const hasWon = (board: Board): boolean => board.some((r) => r.some((v) => v >= WIN_TILE));

export interface State2048 { board: Board; score: number; over: boolean; won: boolean }
export function new2048(rng: Rng): State2048 {
  return { board: spawn(spawn(emptyBoard(), rng), rng), score: 0, over: false, won: false };
}
export function step2048(s: State2048, dir: Dir, rng: Rng): State2048 {
  if (s.over) return s;
  const m = move2048(s.board, dir);
  if (!m.moved) return s;
  const board = spawn(m.board, rng);
  return { board, score: s.score + m.gained, over: !canMove(board), won: s.won || hasWon(board) };
}

/* ===================== Snake ===================== */

export interface Cell { x: number; y: number }
export interface SnakeState {
  w: number;
  h: number;
  /** head first */
  body: Cell[];
  dir: Dir;
  /** the turn asked for since the last step; applied on the next step */
  next: Dir;
  food: Cell;
  alive: boolean;
  score: number;
}
const DELTA: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const same = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

export function placeFood(w: number, h: number, body: Cell[], rng: Rng): Cell {
  const free: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!body.some((c) => c.x === x && c.y === y)) free.push({ x, y });
  if (free.length === 0) return { x: -1, y: -1 };
  return free[Math.min(free.length - 1, Math.floor(rng() * free.length))]!;
}

export function newSnake(rng: Rng, w = 16, h = 16): SnakeState {
  const cy = Math.floor(h / 2);
  const body = [{ x: 4, y: cy }, { x: 3, y: cy }, { x: 2, y: cy }];
  return { w, h, body, dir: 'right', next: 'right', food: placeFood(w, h, body, rng), alive: true, score: 0 };
}

/** A turn back on itself is ignored (it would be instant death); the last turn asked before a step wins. */
export function turnSnake(s: SnakeState, d: Dir): SnakeState {
  if (!s.alive || d === OPPOSITE[s.dir]) return s;
  return { ...s, next: d };
}

/** One tick: move, eat, or die on a wall or on itself. The tail cell is free to enter when not growing. */
export function stepSnake(s: SnakeState, rng: Rng): SnakeState {
  if (!s.alive) return s;
  const dir = s.next;
  const head = s.body[0]!;
  const nh = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
  if (nh.x < 0 || nh.y < 0 || nh.x >= s.w || nh.y >= s.h) return { ...s, dir, alive: false };
  const eats = same(nh, s.food);
  const rest = eats ? s.body : s.body.slice(0, -1);
  if (rest.some((c) => same(c, nh))) return { ...s, dir, alive: false };
  const body = [nh, ...rest];
  return eats
    ? { ...s, body, dir, score: s.score + 1, food: placeFood(s.w, s.h, body, rng) }
    : { ...s, body, dir };
}
/** Ticks get a little faster as the snake grows: 150 ms down to 70 ms. */
export const snakeDelay = (score: number): number => Math.max(70, 150 - score * 4);

/* ===================== Memory match ===================== */

export interface MemCard { face: number; matched: boolean }
export interface MemoryState {
  cards: MemCard[];
  /** indexes of face-up, unmatched cards (0, 1 or 2) */
  open: number[];
  moves: number;
  pairs: number;
}

export function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function newMemory(rng: Rng, pairs = 8): MemoryState {
  const faces = Array.from({ length: pairs }, (_, i) => i);
  return { cards: shuffle([...faces, ...faces], rng).map((face) => ({ face, matched: false })), open: [], moves: 0, pairs };
}

/**
 * Turns card `i` face up. Two equal faces stay matched; two different faces stay up until the next flip
 * (or `hideMismatch`), which turns them back first. Flipping a matched or already open card does nothing.
 */
export function flipCard(s: MemoryState, i: number): MemoryState {
  const c = s.cards[i];
  if (!c || c.matched || s.open.includes(i)) return s;
  const base = s.open.length === 2 ? hideMismatch(s) : s;
  const open = [...base.open, i];
  if (open.length < 2) return { ...base, open };
  const [a, b] = open as [number, number];
  const moves = base.moves + 1;
  if (base.cards[a]!.face === base.cards[b]!.face) {
    const cards = base.cards.map((x, k) => (k === a || k === b ? { ...x, matched: true } : x));
    return { ...base, cards, open: [], moves };
  }
  return { ...base, open, moves };
}
export function hideMismatch(s: MemoryState): MemoryState {
  return s.open.length === 2 ? { ...s, open: [] } : s;
}
export const memoryDone = (s: MemoryState): boolean => s.cards.every((c) => c.matched);

/** A small seeded generator (mulberry32) for tests and for a fresh game from Math.random. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===================== Best scores (this computer only) ===================== */

export type GameId = '2048' | 'snake' | 'memory';
const BEST_KEY = 'petra.dock.best.v1';
/** 2048 and Snake keep the highest score; Memory keeps the fewest moves. */
export const lowerIsBetter = (g: GameId): boolean => g === 'memory';

export function readBest(store: Pick<Storage, 'getItem'> | null): Partial<Record<GameId, number>> {
  try {
    const raw = store?.getItem(BEST_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: Partial<Record<GameId, number>> = {};
    for (const g of ['2048', 'snake', 'memory'] as const) if (typeof v[g] === 'number' && Number.isFinite(v[g])) out[g] = v[g];
    return out;
  } catch {
    return {};
  }
}
/** Records a finished game's result; returns the (possibly new) best. A zero score is never a record. */
export function recordBest(store: Pick<Storage, 'getItem' | 'setItem'> | null, g: GameId, value: number): number | undefined {
  const best = readBest(store);
  const cur = best[g];
  if (value <= 0) return cur;
  const better = cur === undefined || (lowerIsBetter(g) ? value < cur : value > cur);
  if (!better) return cur;
  best[g] = value;
  try {
    store?.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* storage unavailable: the record lasts for this session only */
  }
  return value;
}
