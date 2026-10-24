import { PetraError } from './errors';

export interface PackLevel {
  id: number;
  name: string;
  /** How many base units are in one of this level. The base level has factor 1. */
  factor: number;
}

export function toBaseQty(qty: number, factor: number): number {
  if (!Number.isSafeInteger(qty) || !Number.isSafeInteger(factor) || factor < 1) {
    throw new PetraError('INVALID_INPUT', 'quantity and pack factor must be whole numbers');
  }
  const base = qty * factor;
  if (!Number.isSafeInteger(base)) throw new PetraError('INVALID_INPUT', 'quantity out of range');
  return base;
}

export interface StockPart {
  level: PackLevel;
  qty: number;
}

/**
 * Greedy decomposition from the largest level, for example
 * `12 Big Box 7 Small Box 18 Piece`. Negative stock is decomposed on its magnitude
 * and every part carries the negative sign.
 */
export function decomposeStock(baseQty: number, levels: PackLevel[]): StockPart[] {
  if (!Number.isSafeInteger(baseQty)) throw new PetraError('INVALID_INPUT', 'stock must be an integer');
  const sign = baseQty < 0 ? -1 : 1;
  let rest = Math.abs(baseQty);
  const sorted = [...levels].sort((a, b) => b.factor - a.factor);
  const parts: StockPart[] = [];
  for (const level of sorted) {
    if (level.factor < 1) continue;
    const q = Math.floor(rest / level.factor);
    if (q > 0) {
      parts.push({ level, qty: q * sign });
      rest -= q * level.factor;
    }
  }
  return parts;
}

/** "12 Box 5 pcs" (v1.1: parts are separated by a space, as people say it; pass `sep` for another separator). */
export function formatStock(baseQty: number, levels: PackLevel[], zeroLabel?: string, sep = ' '): string {
  const parts = decomposeStock(baseQty, levels);
  if (parts.length === 0) {
    const base = [...levels].sort((a, b) => a.factor - b.factor)[0];
    return zeroLabel ?? `0 ${base?.name ?? ''}`.trim();
  }
  return parts.map((p) => `${p.qty} ${p.level.name}`).join(sep);
}
