import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductFooter } from './TraderBrand';
import { useApp } from '../store/app';
import { makeI18n } from '../i18n';
import { VENDOR } from '@petra/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..');
const root = path.resolve(src, '../../..');
const text = (html: string) => html.replace(/<[^>]+>/g, '|').split('|').map((s) => s.trim()).filter(Boolean);

describe('product footer: PetraDMS, Made by Petra, never a version', () => {
  // (server-side rendering reads the store's initial state, so the rendered language is the app default, Bangla;
  //  the English wording is checked on the translation itself and in e2e/login-glass.spec.ts on the real screen)
  beforeEach(() => {
    useApp.setState({ status: null });
  });

  it('shows exactly two lines, and does not need the app status to do so', () => {
    expect(useApp.getState().status).toBeNull();
    expect(text(renderToStaticMarkup(createElement(ProductFooter)))).toEqual(['PetraDMS', 'প্রস্তুতকারক: Petra']);
  });

  it('shows no version even when the status carries one', () => {
    useApp.setState({ status: { appVersion: '1.2.0' } as never });
    const lines = text(renderToStaticMarkup(createElement(ProductFooter)));
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).not.toMatch(/v\s*\d|\d+\.\d+|[·০-৯0-9]/);
  });

  it('reads exactly "Made by Petra" in English and keeps the Bangla wording in Bangla', () => {
    expect(makeI18n('en').t('brand.madeBy', { company: VENDOR.companyName })).toBe('Made by Petra');
    expect(makeI18n('bn').t('brand.madeBy', { company: VENDOR.companyName })).toBe('প্রস্তুতকারক: Petra');
    expect(VENDOR.productName).toBe('PetraDMS');
  });
});

describe('PETRA logo asset', () => {
  const logo = path.join(src, 'assets/brand/petra-logo.png');
  const original = path.join(root, 'docs/brand/petra-logo-original.png');
  const size = (f: string) => {
    const b = fs.readFileSync(f);
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25], bytes: b.length };
  };

  it('is a local PNG, small enough to ship, with the original kept beside the docs', () => {
    const l = size(logo);
    expect(l.bytes).toBeLessThan(200_000);
    expect(l.w).toBeGreaterThanOrEqual(1000);
    expect(l.colorType).toBe(6); // RGBA: the transparent corners of the supplied logo are kept
    expect(fs.existsSync(original)).toBe(true);
  });

  it('keeps the original proportions (only the empty transparent margin was trimmed, then scaled)', () => {
    const l = size(logo);
    const o = size(original);
    // the supplied file is 4575 x 2250 with its picture at 3935 x 1699 inside a transparent margin
    expect(Math.abs(l.w / l.h - 3935 / 1699)).toBeLessThan(0.01);
    expect(o.w).toBe(4575);
    expect(o.h).toBe(2250);
  });

  it('is used by the sign-in page from the local assets folder, never from a URL', () => {
    const login = fs.readFileSync(path.join(src, 'pages/Login.tsx'), 'utf8');
    expect(login).toMatch(/from '\.\.\/assets\/brand\/petra-logo\.png'/);
    expect(login).not.toMatch(/https?:\/\//);
    const css = fs.readFileSync(path.join(src, 'styles/login.css'), 'utf8');
    expect(css).not.toMatch(/url\(\s*['"]?https?:/);
    expect(css).not.toMatch(/@import\s+url/);
  });
});

describe('no version number is attached to the product name anywhere the user can read it', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json|css)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk(src);
  files.push(path.join(root, 'apps/desktop/index.html'), path.join(root, 'docs/USER-MANUAL.en.md'), path.join(root, 'docs/USER-MANUAL.bn.md'));

  it('has no "PetraDMS v1.2", "PetraDMS · v1.2" or "PetraDMS - 1.2" in screens, translations, the manual or the page title', () => {
    const bad = /Petra\s?DMS\s*(?:[·\-–—|]\s*)?v?\s*\d+\.\d+/i;
    const hits = files.filter((f) => bad.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });

  it('builds the window title from the product name alone', () => {
    const shell = fs.readFileSync(path.join(src, 'shell/Shell.tsx'), 'utf8');
    expect(shell).toContain('document.title = trader ? `${trader} · ${VENDOR.productName}` : VENDOR.productName;');
    expect(fs.readFileSync(path.join(root, 'apps/desktop/index.html'), 'utf8')).toContain('<title>PetraDMS</title>');
  });
});

// ----- contrast of the sign-in panel (WCAG): essential text >= 4.5:1 against the worst case the glass can sit on -----
const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const over = (fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] => fg.map((c, i) => Math.round(c * alpha + (bg[i] as number) * (1 - alpha))) as [number, number, number];

describe('sign-in panel contrast', () => {
  const css = fs.readFileSync(path.join(src, 'styles/login.css'), 'utf8');
  const v = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))![1]!;
  // the panel is the navy glass at about 66 % over the brightest thing behind it: the electric-blue ribbon
  const panel = over(hex('#10224A'), 0.66, hex('#2563EB'));

  it.each([['lg-text'], ['lg-muted']])('%s is at least 4.5:1 on the lightest the panel can look', (name) => {
    expect(ratio(hex(v(name)), panel)).toBeGreaterThanOrEqual(4.5);
  });
  it('the label, ghost-button and error-message colours are readable on the panel', () => {
    for (const c of ['#C5D7EF', '#BBE3F5']) expect(ratio(hex(c), panel)).toBeGreaterThanOrEqual(4.5);
    const errBg = over(hex('#B91C1C'), 0.22, panel);
    expect(ratio(hex('#FFE1E1'), errBg)).toBeGreaterThanOrEqual(4.5);
  });
  it('the primary button text (navy) is at least 4.5:1 on both ends of its cyan-to-turquoise gradient', () => {
    expect(ratio(hex(v('lg-navy')), hex(v('lg-cyan')))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(v('lg-navy')), hex(v('lg-teal')))).toBeGreaterThanOrEqual(4.5);
  });
});
