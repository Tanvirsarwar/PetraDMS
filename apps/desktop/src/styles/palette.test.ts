import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Reads the colour tokens straight from tokens.css so the test cannot drift from what ships. */
const css = readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
const root = css.slice(css.indexOf(':root'), css.indexOf('/* spacing'));
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(root);
  if (!m) throw new Error(`token --${name} not found as a 6-digit hex`);
  return m[1]!.toUpperCase();
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('brand palette', () => {
  it('uses the agreed colours', () => {
    expect(token('brand')).toBe('#0F172A'); // Deep Navy, primary
    expect(token('accent')).toBe('#14B8A6'); // Teal, accent
    expect(token('gold')).toBe('#D4AF37'); // Gold, accent
    expect(token('cream')).toBe('#F1F5F9'); // Light Gray, background
  });

  it('keeps red for danger only, apart from the brand', () => {
    expect(token('red')).not.toBe(token('brand'));
    expect(token('red')).not.toBe(token('accent'));
  });

  // [foreground, background, minimum]: 4.5 for text (WCAG AA), 3 for borders and focus rings.
  const AA: [string, string, number][] = [
    ['ink', 'cream', 4.5], ['ink-2', 'cream', 4.5], ['ink-2', 'paper', 4.5],
    ['muted', 'paper', 4.5], ['muted', 'cream', 4.5], ['muted', 'cream-2', 4.5],
    ['paper', 'brand', 4.5], // white text on a primary button
    ['paper', 'accent-dark', 4.5], // white text on a switch or step that is on
    ['brand', 'accent', 4.5], ['brand', 'gold', 4.5], ['brand', 'accent-tint', 4.5], // navy text on teal, gold, selected rows
    ['accent-dark', 'paper', 4.5], ['accent-dark', 'accent-tint', 4.5], ['accent-dark', 'cream', 4.5], // teal used as text
    ['red', 'paper', 4.5], ['red', 'cream', 4.5], ['paper', 'red', 4.5], // danger text and solid badge
    ['cream', 'black', 4.5], ['cream-3', 'black', 4.5], // sidebar
    ['ok', 'paper', 4.5], ['warn', 'warn-tint', 4.5],
    ['line-strong', 'paper', 3], ['line-strong', 'cream', 3], ['focus', 'paper', 3], ['focus', 'cream', 3]
  ];
  for (const [fg, bg, min] of AA) {
    it(`--${fg} on --${bg} is at least ${min}:1`, () => {
      expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
    });
  }

  it('documents why raw teal or gold is never used as text on white', () => {
    expect(ratio(token('accent'), token('paper'))).toBeLessThan(3);
    expect(ratio(token('gold'), token('paper'))).toBeLessThan(3);
  });
});
