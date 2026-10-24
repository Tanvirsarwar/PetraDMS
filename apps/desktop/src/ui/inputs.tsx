import { useEffect, useState, type KeyboardEventHandler, type Ref } from 'react';
import { formatDate, fromBnDigits, isIsoDate, parseMoney, toBnDigits, type Poisha } from '@petra/core';
import { Input } from './controls';
import { useI18n } from '../i18n';

interface BaseProps {
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/** Amounts above ten billion taka are refused as typing mistakes; they would also overflow invoice arithmetic. */
const MAX_POISHA = 1_000_000_000_000;
const parseCapped = (s: string): Poisha | null => {
  const p = parseMoney(s);
  return p !== null && p > MAX_POISHA ? null : p;
};

/** Money entry in taka; reports integer poisha, or null while the text is not a valid amount. */
export function MoneyInput({ value, onChange, inputRef, ...rest }: BaseProps & { value: Poisha | null; onChange: (p: Poisha | null) => void }) {
  const { lang } = useI18n();
  const show = (p: Poisha | null) => (p === null ? '' : lang === 'bn' ? toBnDigits((p / 100).toFixed(p % 100 === 0 ? 0 : 2)) : (p / 100).toFixed(p % 100 === 0 ? 0 : 2));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    if (parseCapped(text) !== value) setText(show(value));
  }, [value, lang]);
  return (
    <Input
      {...rest}
      ref={inputRef}
      numeric
      inputMode="decimal"
      value={text}
      invalid={rest.invalid || (text !== '' && parseCapped(text) === null)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? null : parseCapped(e.target.value));
      }}
    />
  );
}

/** Whole-number quantity entry. */
export function QtyInput({ value, onChange, inputRef, ...rest }: BaseProps & { value: number | null; onChange: (n: number | null) => void }) {
  const { lang } = useI18n();
  const show = (n: number | null) => (n === null ? '' : lang === 'bn' ? toBnDigits(String(n)) : String(n));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const cur = /^\d{1,9}$/.test(fromBnDigits(text)) ? Number(fromBnDigits(text)) : null;
    if (cur !== value) setText(show(value));
  }, [value, lang]);
  return (
    <Input
      {...rest}
      ref={inputRef}
      numeric
      inputMode="numeric"
      value={text}
      invalid={rest.invalid || (text !== '' && !/^\d{1,9}$/.test(fromBnDigits(text)))}
      onChange={(e) => {
        setText(e.target.value);
        const d = fromBnDigits(e.target.value.trim());
        onChange(d === '' ? null : /^\d{1,9}$/.test(d) ? Number(d) : null);
      }}
    />
  );
}

export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(fromBnDigits(text.trim()));
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** Date entry as DD/MM/YYYY; value is an ISO date string. */
export function DateInput({ value, onChange, inputRef, ...rest }: BaseProps & { value: string | null; onChange: (iso: string | null) => void }) {
  const { lang } = useI18n();
  const show = (iso: string | null) => (iso && isIsoDate(iso) ? (lang === 'bn' ? toBnDigits(formatDate(iso)) : formatDate(iso)) : '');
  const [text, setText] = useState(show(value));
  useEffect(() => {
    if (parseDisplayDate(text) !== value) setText(show(value));
  }, [value, lang]);
  return (
    <Input
      {...rest}
      ref={inputRef}
      numeric
      placeholder={lang === 'bn' ? 'দিন/মাস/বছর' : 'DD/MM/YYYY'}
      value={text}
      invalid={rest.invalid || (text !== '' && parseDisplayDate(text) === null)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseDisplayDate(e.target.value));
      }}
    />
  );
}
