import { formatInt, formatMoney, toBnDigits, type Poisha } from '@petra/core';
import { useUi } from '../store/ui';

import type { Lang } from '../store/ui';
export type { Lang };
export type Dict = Record<string, string>;

function load(lang: Lang): Dict {
  const mods =
    lang === 'bn'
      ? import.meta.glob('./locales/bn/*.json', { eager: true, import: 'default' })
      : import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' });
  return Object.assign({}, ...Object.values(mods)) as Dict;
}

export const dictionaries: Record<Lang, Dict> = { bn: load('bn'), en: load('en') };

export type Params = Record<string, string | number>;

/** Translate a key. Missing keys fall back to English, then to the key itself (a visible bug, caught by the parity test). */
export function translate(lang: Lang, key: string, params?: Params): string {
  const raw = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v === undefined ? `{${k}}` : lang === 'bn' && typeof v === 'number' ? toBnDigits(String(v)) : String(v);
  });
}

export interface I18n {
  lang: Lang;
  t: (key: string, params?: Params) => string;
  /** Digits in the active language. */
  n: (text: string | number) => string;
  money: (poisha: Poisha, opts?: { fixed?: boolean; symbol?: boolean }) => string;
  int: (value: number) => string;
}

export function makeI18n(lang: Lang): I18n {
  const bnDigits = lang === 'bn';
  return {
    lang,
    t: (key, params) => translate(lang, key, params),
    n: (text) => (bnDigits ? toBnDigits(String(text)) : String(text)),
    money: (p, o) => formatMoney(p, { grouping: 'lakh', bnDigits, symbol: o?.symbol ?? true, fixedDecimals: o?.fixed ?? false }),
    int: (v) => formatInt(v, { grouping: 'lakh', bnDigits })
  };
}

const cache: Partial<Record<Lang, I18n>> = {};
export function useI18n(): I18n {
  const lang = useUi((s) => s.lang);
  return (cache[lang] ??= makeI18n(lang));
}
export function useT() {
  return useI18n().t;
}
