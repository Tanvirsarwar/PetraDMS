import { describe, expect, it } from 'vitest';
import { calcKeyOf, evaluate, formatDec, parseDec, pushHistory } from './calcEngine';
import {
  canMove, flipCard, hideMismatch, memoryDone, move2048, new2048, newMemory, newSnake, readBest, recordBest, seeded, slideRow, spawn, step2048,
  stepSnake, turnSnake, type Board, type MemoryState, type SnakeState
} from './gamesLogic';

const val = (s: string) => {
  const r = evaluate(s);
  return r.ok ? r.text : `ERR:${r.error}`;
};

describe('dock calculator engine', () => {
  it('adds, subtracts, multiplies and divides with exact decimals', () => {
    expect(val('0.1+0.2')).toBe('0.3');
    expect(val('0.3-0.1')).toBe('0.2');
    expect(val('1.005*100')).toBe('100.5');
    expect(val('1.1*1.1')).toBe('1.21');
    expect(val('3*0.1')).toBe('0.3');
    expect(val('10/4')).toBe('2.5');
    expect(val('1/3')).toBe('0.3333333333');
    expect(val('2/3')).toBe('0.6666666667');
    expect(val('1/3*3')).toBe('1');
    expect(val('0.07*100')).toBe('7');
    expect(val('19.99*3')).toBe('59.97');
  });
  it('follows precedence and parentheses, and handles unary minus', () => {
    expect(val('2+3*4')).toBe('14');
    expect(val('(2+3)*4')).toBe('20');
    expect(val('-5+2')).toBe('-3');
    expect(val('-(2+3)*-2')).toBe('10');
    expect(val('((1.5))')).toBe('1.5');
    expect(val('8/2/2')).toBe('2');
    expect(val('8-2-2')).toBe('4');
  });
  it('treats percent like a shop calculator', () => {
    expect(val('10%')).toBe('0.1');
    expect(val('200+10%')).toBe('220');
    expect(val('200-10%')).toBe('180');
    expect(val('200*10%')).toBe('20');
    expect(val('1250+15%')).toBe('1437.5');
    expect(val('50%*2')).toBe('1');
  });
  it('accepts × ÷ − symbols, Bangla digits and thousands commas', () => {
    expect(val('৩×৪')).toBe('12');
    expect(val('9÷3')).toBe('3');
    expect(val('9−3')).toBe('6');
    expect(val('1,200+300')).toBe('1500');
  });
  it('reports invalid input instead of throwing', () => {
    expect(val('')).toBe('ERR:empty');
    expect(val('2+')).toBe('ERR:syntax');
    expect(val('(2+3')).toBe('ERR:syntax');
    expect(val('2+3)')).toBe('ERR:syntax');
    expect(val('1..2')).toBe('ERR:syntax');
    expect(val('abc')).toBe('ERR:syntax');
    expect(val('alert(1)')).toBe('ERR:syntax');
    expect(val('5/0')).toBe('ERR:divzero');
    expect(val('5/(2-2)')).toBe('ERR:divzero');
    expect(val('999999999999999*10')).toBe('ERR:overflow');
    expect(val('*3')).toBe('ERR:syntax');
  });
  it('formats and parses decimals', () => {
    expect(formatDec(parseDec('0012.500')!)).toBe('12.5');
    expect(formatDec({ n: -5n, s: 1 })).toBe('-0.5');
    expect(parseDec('.')).toBeNull();
    expect(parseDec('1.2.3')).toBeNull();
  });
  it('maps keys and keeps the last five results', () => {
    expect(calcKeyOf('7')).toBe('7');
    expect(calcKeyOf('৭')).toBe('7');
    expect(calcKeyOf('x')).toBe('*');
    expect(calcKeyOf('Enter')).toBe('=');
    expect(calcKeyOf('Backspace')).toBe('BACK');
    expect(calcKeyOf('a')).toBeNull();
    let h: number[] = [];
    for (let i = 1; i <= 7; i++) h = pushHistory(h, i);
    expect(h).toEqual([7, 6, 5, 4, 3]);
  });
});

describe('2048', () => {
  it('merges each pair once per move, towards the move', () => {
    expect(slideRow([2, 2, 2, 2]).row).toEqual([4, 4, 0, 0]);
    expect(slideRow([2, 2, 4, 0]).row).toEqual([4, 4, 0, 0]);
    expect(slideRow([4, 0, 4, 8]).row).toEqual([8, 8, 0, 0]);
    expect(slideRow([2, 4, 2, 4]).row).toEqual([2, 4, 2, 4]);
    expect(slideRow([0, 0, 2, 2])).toEqual({ row: [4, 0, 0, 0], gained: 4 });
    expect(slideRow([8, 8, 8, 0])).toEqual({ row: [16, 8, 0, 0], gained: 16 });
  });
  it('moves in all four directions and reports whether anything moved', () => {
    const b: Board = [[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0]];
    expect(move2048(b, 'left').board[0]).toEqual([4, 0, 0, 0]);
    expect(move2048(b, 'right').board[0]).toEqual([0, 0, 0, 4]);
    expect(move2048(b, 'up').board.map((r) => r[0])).toEqual([4, 0, 0, 0]);
    expect(move2048(b, 'down').board.map((r) => r[0])).toEqual([0, 0, 0, 4]);
    const stuck: Board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
    expect(move2048(stuck, 'left').moved).toBe(false);
    expect(canMove(stuck)).toBe(false);
  });
  it('spawns a 2 or 4 on an empty cell, scores merges, and ends when no move is left', () => {
    const rng = seeded(7);
    let s = new2048(rng);
    expect(s.board.flat().filter((v) => v > 0)).toHaveLength(2);
    const full: Board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]];
    expect(spawn(full, () => 0).flat().filter((v) => v === 0)).toHaveLength(0);
    s = { board: [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, over: false, won: false };
    s = step2048(s, 'left', seeded(1));
    expect(s.score).toBe(4);
    expect(s.board[0]![0]).toBe(4);
    const nearlyStuck = { board: [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]], score: 0, over: false, won: false };
    const after = step2048(nearlyStuck, 'right', () => 0.99);
    expect(after.score).toBe(8);
    expect(typeof after.over).toBe('boolean');
    const won = step2048({ board: [[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, over: false, won: false }, 'left', seeded(2));
    expect(won.won).toBe(true);
  });
});

describe('snake', () => {
  const base = (over: Partial<SnakeState>): SnakeState => ({ w: 8, h: 8, body: [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }], dir: 'right', next: 'right', food: { x: 7, y: 7 }, alive: true, score: 0, ...over });
  it('moves one cell per step and grows when it eats', () => {
    const s = stepSnake(base({}), seeded(1));
    expect(s.body[0]).toEqual({ x: 4, y: 3 });
    expect(s.body).toHaveLength(3);
    const ate = stepSnake(base({ food: { x: 4, y: 3 } }), seeded(1));
    expect(ate.body).toHaveLength(4);
    expect(ate.score).toBe(1);
    expect(ate.body.some((c) => c.x === ate.food.x && c.y === ate.food.y)).toBe(false);
  });
  it('dies on a wall and on its own body, but may enter the cell its tail is leaving', () => {
    expect(stepSnake(base({ body: [{ x: 7, y: 3 }, { x: 6, y: 3 }] }), seeded(1)).alive).toBe(false);
    // a loop: head at (2,2) moving down into (2,3), which is body (not the tail) -> dead
    const loop = base({ body: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }], dir: 'left', next: 'down' });
    expect(stepSnake(loop, seeded(1)).alive).toBe(false);
    // a tight square: the head moves into the tail cell as the tail moves away -> alive
    const square = base({ body: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }], dir: 'left', next: 'down' });
    expect(stepSnake(square, seeded(1)).alive).toBe(true);
  });
  it('ignores a turn straight back and keeps the latest turn', () => {
    let s = base({});
    s = turnSnake(s, 'left');
    expect(s.next).toBe('right');
    s = turnSnake(s, 'up');
    s = turnSnake(s, 'down'); // down is not the reverse of the current direction (right), so it replaces up
    expect(stepSnake(s, seeded(1)).body[0]).toEqual({ x: 3, y: 4 });
    const fresh = newSnake(seeded(3), 16, 16);
    expect(fresh.body).toHaveLength(3);
    expect(fresh.alive).toBe(true);
  });
});

describe('memory match', () => {
  const fixed = (faces: number[]): MemoryState => ({ cards: faces.map((face) => ({ face, matched: false })), open: [], moves: 0, pairs: faces.length / 2 });
  it('deals every face exactly twice', () => {
    const m = newMemory(seeded(5));
    const counts = new Map<number, number>();
    for (const c of m.cards) counts.set(c.face, (counts.get(c.face) ?? 0) + 1);
    expect(m.cards).toHaveLength(16);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });
  it('pairs equal faces, turns back different ones, and counts moves', () => {
    let m = fixed([0, 1, 0, 1]);
    m = flipCard(m, 0);
    m = flipCard(m, 1);
    expect(m.open).toEqual([0, 1]);
    expect(m.moves).toBe(1);
    m = flipCard(m, 2); // the mismatch turns back, then card 2 opens
    expect(m.open).toEqual([2]);
    m = flipCard(m, 0);
    expect(m.cards[0]!.matched && m.cards[2]!.matched).toBe(true);
    expect(m.open).toEqual([]);
    expect(m.moves).toBe(2);
    // a matched or already open card cannot be flipped again
    expect(flipCard(m, 0)).toBe(m);
    m = flipCard(m, 1);
    expect(flipCard(m, 1)).toBe(m);
    m = flipCard(m, 3);
    expect(memoryDone(m)).toBe(true);
    expect(hideMismatch(fixed([0, 0]))).toEqual(fixed([0, 0]));
  });
});

describe('best scores', () => {
  const mem = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  it('keeps the highest score, or the fewest moves for Memory, and ignores zero', () => {
    const s = mem();
    expect(recordBest(s, '2048', 0)).toBeUndefined();
    expect(recordBest(s, '2048', 120)).toBe(120);
    expect(recordBest(s, '2048', 80)).toBe(120);
    expect(recordBest(s, 'memory', 20)).toBe(20);
    expect(recordBest(s, 'memory', 14)).toBe(14);
    expect(recordBest(s, 'memory', 30)).toBe(14);
    expect(readBest(s)).toEqual({ '2048': 120, memory: 14 });
    expect(readBest({ getItem: () => '{bad json' })).toEqual({});
    expect(readBest(null)).toEqual({});
  });
});
