import { describe, expect, it } from 'vitest';
import { manualFor } from './manual';
import { splitManual } from './markdown';

describe('manuals', () => {
  const en = manualFor('en');
  const bn = manualFor('bn');
  it('have the same number of sections in both languages', () => {
    expect(en.sections.length).toBe(15);
    expect(bn.sections.length).toBe(en.sections.length);
  });
  it('have a title, an intro and a body for every section', () => {
    for (const m of [en, bn]) {
      expect(m.title.length).toBeGreaterThan(3);
      expect(m.intro.length).toBeGreaterThan(20);
      for (const s of m.sections) expect(s.body.trim().length).toBeGreaterThan(40);
    }
  });
  it('keep the same keys and shortcuts in both languages', () => {
    const keys = (s: string) => [...s.matchAll(/\b(Ctrl\+Shift\+M|Ctrl\+[A-Z]|F\d)\b/g)].map((m) => m[1]).sort();
    expect(keys(bn.sections.map((s) => s.body).join('\n'))).toEqual(keys(en.sections.map((s) => s.body).join('\n')));
  });
  it('mention nothing that is not in the app', () => {
    const all = (en.sections.map((s) => s.body).join('\n') + bn.sections.map((s) => s.body).join('\n')).toLowerCase();
    for (const bad of ['todo', 'lorem', 'tbd', 'cloud sync', 'http://', 'https://']) expect(all).not.toContain(bad);
  });
  it('splits sections at level-two headings only', () => {
    const r = splitManual('# T\n\nintro\n\n## A\n\nx\n\n### sub\n\n## B\n\ny');
    expect(r.title).toBe('T');
    expect(r.sections.map((s) => s.title)).toEqual(['A', 'B']);
    expect(r.sections[0]?.body).toContain('### sub');
  });
});
