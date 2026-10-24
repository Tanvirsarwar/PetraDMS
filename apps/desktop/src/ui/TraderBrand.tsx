import { VENDOR } from '@petra/core';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';

/** The shop's name in the active language (Bangla name when the UI is Bangla and one is set). */
export function useTraderName(): string {
  const { lang } = useI18n();
  const p = useApp((s) => s.status?.profile);
  if (!p) return '';
  return lang === 'bn' && p.nameBn ? p.nameBn : p.name || p.nameBn;
}

/** First letter of the name, for the monogram (a Bangla name gives its first grapheme, with its vowel sign). */
export function monogramOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)][0]?.segment : trimmed[0];
  return (seg ?? trimmed[0] ?? '?').toUpperCase();
}

/**
 * The trader's brand: their logo, or a monogram of the first letter, and their name (two lines at most, the full
 * name in the tooltip). This is what the app shows at the top; the product and its maker sit quietly at the bottom.
 */
export function TraderBrand({ name, sub, testId }: { name?: string; sub?: string; testId?: string }) {
  const trader = useTraderName();
  const logo = useApp((s) => s.status?.logo ?? null);
  const shown = name ?? trader;
  return (
    <div className="trader" data-testid={testId ?? 'trader-brand'} title={shown}>
      {logo ? <img className="trader-logo" src={logo} alt="" data-testid="trader-logo" /> : <span className="trader-mono" aria-hidden="true" data-testid="trader-mono">{monogramOf(shown)}</span>}
      <div style={{ minWidth: 0 }}>
        <div className="trader-name" data-testid="trader-name">{shown}</div>
        {sub && <div className="trader-sub">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * The product and its maker, small and quiet: "PetraDMS" with "Made by Petra" under it. No version number: the
 * version belongs in Help > About and in the support file, not in the product's name.
 */
export function ProductFooter() {
  const { t } = useI18n();
  return (
    <div className="powered" data-testid="product-footer">
      <div className="powered-product" data-testid="footer-product"><strong>{VENDOR.productName}</strong></div>
      <div className="powered-maker" data-testid="made-by">{t('brand.madeBy', { company: VENDOR.companyName })}</div>
    </div>
  );
}
