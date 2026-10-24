/**
 * Pocket calculator (plan 8.5): + - x / %, memory M+ M- MR MC, history of the last 10 results.
 * A pure reducer so the keyboard, the buttons and the tests all drive the same logic.
 */
export type CalcKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '00'
  | '+' | '-' | '*' | '/' | '%' | '=' | 'C' | 'CE' | 'BACK' | 'NEG' | 'M+' | 'M-' | 'MR' | 'MC';

export interface CalcState {
  /** What the display shows right now. */
  display: string;
  /** Value waiting for the next operand. */
  acc: number | null;
  op: '+' | '-' | '*' | '/' | null;
  /** The next digit starts a new number. */
  fresh: boolean;
  memory: number;
  history: { expr: string; result: number }[];
  error: boolean;
  /** Text of the expression so far, for the small line above the display. */
  expr: string;
}

export const calcInitial: CalcState = { display: '0', acc: null, op: null, fresh: true, memory: 0, history: [], error: false, expr: '' };

const round = (x: number): number => Math.round(x * 1e10) / 1e10;
const fmt = (x: number): string => {
  const r = round(x);
  if (!Number.isFinite(r) || Math.abs(r) >= 1e15) return 'Error';
  return String(r);
};
const sym: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function apply(a: number, op: CalcState['op'], b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function fail(s: CalcState): CalcState {
  return { ...s, display: 'Error', acc: null, op: null, fresh: true, error: true, expr: '' };
}

export function calcPress(s0: CalcState, key: CalcKey): CalcState {
  let s = s0;
  if (s.error && key !== 'C' && key !== 'CE') s = { ...calcInitial, memory: s.memory, history: s.history };
  const cur = Number(s.display);
  if (/^[0-9]$/.test(key) || key === '00' || key === '.') {
    if (s.fresh) {
      const d = key === '.' ? '0.' : key === '00' ? '0' : key;
      return { ...s, display: d, fresh: false, expr: s.op === null && s.acc !== null ? '' : s.expr };
    }
    if (key === '.' && s.display.includes('.')) return s;
    if (s.display.replace('-', '').replace('.', '').length >= 15) return s;
    return { ...s, display: s.display === '0' && key !== '.' ? (key === '00' ? '0' : key) : s.display + key };
  }
  switch (key) {
    case 'C': return { ...calcInitial, memory: s.memory, history: s.history };
    case 'CE': return { ...s, display: '0', fresh: true, error: false };
    case 'BACK': {
      if (s.fresh) return s;
      const d = s.display.length > 1 && !(s.display.length === 2 && s.display.startsWith('-')) ? s.display.slice(0, -1) : '0';
      return { ...s, display: d };
    }
    case 'NEG': return s.display === '0' ? s : { ...s, display: s.display.startsWith('-') ? s.display.slice(1) : `-${s.display}` };
    case '+': case '-': case '*': case '/': {
      if (s.op !== null && !s.fresh && s.acc !== null) {
        const r = apply(s.acc, s.op, cur);
        if (Number.isNaN(r)) return fail(s);
        return { ...s, acc: round(r), op: key, display: fmt(r), fresh: true, expr: `${fmt(r)} ${sym[key]}` };
      }
      const base = s.acc !== null && s.fresh && s.op === null ? s.acc : cur;
      return { ...s, acc: base, op: key, fresh: true, expr: `${fmt(base)} ${sym[key]}` };
    }
    case '%': {
      // 200 + 10% = 220 (percent of the first number), 50 x 10% = 5, a lone 10% = 0.1
      const v = s.acc !== null && (s.op === '+' || s.op === '-') ? (s.acc * cur) / 100 : cur / 100;
      return { ...s, display: fmt(v), fresh: false };
    }
    case '=': {
      if (s.op === null || s.acc === null) return { ...s, fresh: true };
      const r = apply(s.acc, s.op, cur);
      if (Number.isNaN(r)) return fail(s);
      const expr = `${fmt(s.acc)} ${sym[s.op]} ${fmt(cur)}`;
      const result = round(r);
      return { ...s, display: fmt(result), acc: null, op: null, fresh: true, expr: `${expr} =`, history: [{ expr, result }, ...s.history].slice(0, 10) };
    }
    case 'M+': return { ...s, memory: round(s.memory + cur), fresh: true };
    case 'M-': return { ...s, memory: round(s.memory - cur), fresh: true };
    case 'MR': return { ...s, display: fmt(s.memory), fresh: true };
    case 'MC': return { ...s, memory: 0 };
  }
  return s;
}

/** Maps a keyboard key to a calculator key, or null. */
export function calcKeyFromEvent(key: string): CalcKey | null {
  if (/^[0-9]$/.test(key) || key === '.' || key === '+' || key === '-' || key === '%') return key as CalcKey;
  if (key === '*' || key === 'x' || key === 'X') return '*';
  if (key === '/') return '/';
  if (key === 'Enter' || key === '=') return '=';
  if (key === 'Backspace') return 'BACK';
  if (key === 'Delete') return 'CE';
  if (key === 'Escape') return null;
  if (key === 'c' || key === 'C') return 'C';
  return null;
}
