import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES } from '@petra/core';

const root = join(dirname(fileURLToPath(import.meta.url)), 'locales');
const load = (lang: string): Record<string, string> =>
  Object.assign({}, ...readdirSync(join(root, lang)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, lang, f), 'utf8')) as Record<string, string>));
const en = load('en');
const bn = load('bn');

// Words that mean a raw exception or database message leaked into plain-language copy.
const TECHNICAL = /\b(sql|sqlite|exception|stack ?trace|undefined|null|NaN|errno|ENOENT|EACCES|constraint failed|syntax error|object Object)\b/i;

describe('error messages', () => {
  for (const code of ERROR_CODES) {
    it(`${code} has plain English and Bangla text`, () => {
      for (const [lang, dict] of [['en', en], ['bn', bn]] as const) {
        const text = dict[`err.${code}`];
        expect(text, `${lang} err.${code}`).toBeTruthy();
        expect(text, `${lang} err.${code} is technical`).not.toMatch(TECHNICAL);
        expect(text!.length, `${lang} err.${code} too short`).toBeGreaterThan(10);
      }
      expect(en[`err.${code}`], 'English error ends like a sentence').toMatch(/[.!]$/);
      expect(bn[`err.${code}`], 'Bangla error ends like a sentence').toMatch(/[।.!]$/);
    });
  }
  it('has no err.* key for a code that does not exist', () => {
    const known = new Set<string>(ERROR_CODES);
    const stray = Object.keys(en).filter((k) => /^err\.[A-Z_]+$/.test(k) && !known.has(k.slice(4)));
    expect(stray).toEqual([]);
  });
});

describe('screen copy', () => {
  const ALL: Array<[string, Record<string, string>]> = [['en', en], ['bn', bn]];
  it('contains no leftover placeholder text', () => {
    const bad: string[] = [];
    for (const [lang, dict] of ALL) for (const [k, v] of Object.entries(dict)) if (/\b(TODO|FIXME|TBD|lorem ipsum|placeholder text|coming soon|xxx)\b/i.test(v)) bad.push(`${lang}:${k}`);
    expect(bad).toEqual([]);
  });
  it('never shows accountant jargon to a shopkeeper', () => {
    const bad: string[] = [];
    for (const [lang, dict] of ALL) for (const [k, v] of Object.entries(dict)) if (/\b(debit|credit note|journal entry|ledger entry)\b/i.test(v)) bad.push(`${lang}:${k}`);
    expect(bad).toEqual([]);
  });
  it('has no value that is just a key name or a JSON accident', () => {
    const bad: string[] = [];
    for (const [lang, dict] of ALL) for (const [k, v] of Object.entries(dict)) if (v === k || /^\[object|^undefined$|^null$/.test(v)) bad.push(`${lang}:${k}`);
    expect(bad).toEqual([]);
  });
  it('Bangla text is mostly Bangla (not an untranslated English copy)', () => {
    const same: string[] = [];
    for (const [k, v] of Object.entries(bn)) {
      const e = en[k];
      if (e && e === v && /[A-Za-z]{4,}/.test(v) && v.split(' ').length > 3) same.push(k);
    }
    expect(same).toEqual([]);
  });
});

describe('product and maker names', () => {
  // PetraDMS is the product (one word); Petra is the company. No screen says "Powered by" or "Petra DMS",
  // and the Bangla copy never transliterates either name.
  const repo = join(root, '..', '..', '..', '..', '..');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (['node_modules', 'dist', 'dist-electron', 'release', 'test-results', 'playwright-report', '.git'].includes(d.name)) return [];
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.(tsx?|json|css|html|md)$/.test(d.name) && !d.name.endsWith('copy.test.ts') ? [p] : [];
  });
  it('every locale string uses the right names', () => {
    for (const [lang, dict] of [['en', en], ['bn', bn]] as const) {
      for (const [k, v] of Object.entries(dict)) {
        expect(v, `${lang} ${k}`).not.toMatch(/Powered by|Petra DMS|পেট্রা/i);
      }
    }
    expect(en['brand.madeBy']).toBe('Made by {company}');
    expect(bn['brand.madeBy']).toBe('প্রস্তুতকারক: {company}');
  });
  it('no source file, template or current doc shows "Powered by" or "Petra DMS"', () => {
    const dirs = ['apps/desktop/src', 'apps/desktop/electron', 'packages/core/src', 'packages/db/src', 'e2e'].map((d) => join(repo, d));
    const files = [...dirs.flatMap(walk), join(repo, 'docs', 'USER-MANUAL.en.md'), join(repo, 'docs', 'USER-MANUAL.bn.md'), join(repo, 'README.md')];
    const bad = files.filter((f) => /Powered by|Petra DMS/.test(readFileSync(f, 'utf8').replace(/not\.toContainText\('(Powered by|Petra DMS)'\)/g, '')));
    expect(bad).toEqual([]);
  });
});
