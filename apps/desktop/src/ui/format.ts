import { formatBoxPcs, formatStock, type ProductDto } from '@petra/core';
import { useI18n, type I18n } from '../i18n';

/** Stock as packs, for example "12 Box 5 pcs" (Bangla pack names and digits in Bangla). */
export function stockText(i: I18n, p: Pick<ProductDto, 'packs' | 'baseUnit'>, baseQty: number): string {
  const levels = p.packs.length > 0 ? p.packs : [{ id: 0, name: p.baseUnit, nameBn: '', factor: 1 }];
  return i.n(formatStock(baseQty, levels.map((k) => ({ id: k.id, name: packLabel(i, k), factor: k.factor }))));
}

/**
 * A quantity in boxes and pieces with the piece count beside it, for example "2 Box + 5 pcs (29 pcs total)".
 * A quantity in pieces alone is just "29 pcs".
 */
export function boxPcsText(i: I18n, baseQty: number, factor: number, boxName: string, baseUnit: string): string {
  return i.n(formatBoxPcs(baseQty, factor, { boxName, pcsName: baseUnit }, { total: (pcs) => i.t('qty.total', { qty: pcs }) }));
}

/** A pack's name in the active language (the Bangla name when there is one). */
export function packLabel(i: Pick<I18n, 'lang'>, k: { name: string; nameBn?: string }): string {
  return i.lang === 'bn' && k.nameBn ? k.nameBn : k.name;
}

export function useDisplayDate(): (iso: string) => string {
  const { n } = useI18n();
  return (iso) => (iso ? n(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`) : '');
}

/** Localised product name: Bangla when the UI is Bangla and a Bangla name exists. */
export function productName(lang: 'bn' | 'en', p: { name: string; nameBn: string }): string {
  return lang === 'bn' && p.nameBn ? p.nameBn : p.name;
}
