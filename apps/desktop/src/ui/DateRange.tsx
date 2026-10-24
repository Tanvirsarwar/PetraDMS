import { addDays } from '@petra/core';
import { DateInput } from './inputs';
import { Segmented } from './controls';
import { useI18n } from '../i18n';

export interface Range {
  from: string;
  to: string;
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function lastMonth(date: string): Range {
  const first = monthStart(date);
  const to = addDays(first, -1);
  return { from: monthStart(to), to };
}

/** Date range with quick presets (plan 8.2 rule 10). */
export function DateRange({ value, onChange, today }: { value: Range; onChange: (r: Range) => void; today: string }) {
  const { t } = useI18n();
  const preset =
    value.from === today && value.to === today ? 'today'
    : value.from === addDays(today, -1) && value.to === addDays(today, -1) ? 'yesterday'
    : value.from === monthStart(today) && value.to === today ? 'month'
    : value.from === lastMonth(today).from && value.to === lastMonth(today).to ? 'last'
    : 'custom';
  return (
    <div className="row wrap">
      <Segmented
        label={t('word.date')}
        value={preset as 'today' | 'yesterday' | 'month' | 'last' | 'custom'}
        onChange={(v) => {
          if (v === 'today') onChange({ from: today, to: today });
          else if (v === 'yesterday') onChange({ from: addDays(today, -1), to: addDays(today, -1) });
          else if (v === 'month') onChange({ from: monthStart(today), to: today });
          else if (v === 'last') onChange(lastMonth(today));
        }}
        options={[
          { value: 'today', label: t('word.today') },
          { value: 'yesterday', label: t('word.yesterday') },
          { value: 'month', label: t('word.thisMonth') },
          { value: 'last', label: t('word.lastMonth') },
          ...(preset === 'custom' ? [{ value: 'custom' as const, label: '…' }] : [])
        ]}
      />
      <div style={{ width: 130 }}><DateInput aria-describedby={undefined} value={value.from} onChange={(v) => v && onChange({ ...value, from: v })} /></div>
      <span>–</span>
      <div style={{ width: 130 }}><DateInput value={value.to} onChange={(v) => v && onChange({ ...value, to: v })} /></div>
    </div>
  );
}
