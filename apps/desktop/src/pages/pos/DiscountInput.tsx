import { useEffect, useState } from 'react';
import { Input, Select } from '../../ui';
import { parseMoney, formatMoney } from '@petra/core';

/** Discount as a percentage (stored as basis points) or a fixed taka amount (poisha). */
export function DiscountInput({ kind, value, onChange, label, testId }: { kind: 'pct' | 'fixed' | null; value: number; onChange: (kind: 'pct' | 'fixed' | null, value: number) => void; label: string; testId?: string }) {
  const k = kind ?? 'pct';
  const show = (kk: 'pct' | 'fixed', v: number) => (v === 0 ? '' : kk === 'pct' ? String(v / 100) : formatMoney(v, { symbol: false, grouping: 'intl', bnDigits: false, fixedDecimals: false }).replace(/,/g, ''));
  const [text, setText] = useState(show(k, value));
  // Re-sync when the parent changes the value (draft restore, customer default discount).
  useEffect(() => {
    setText((t) => {
      const cur = parse(k, t);
      return cur === value ? t : show(k, value);
    });
  }, [k, value]);
  function parse(kk: 'pct' | 'fixed', t: string): number {
    if (!t.trim()) return 0;
    if (kk === 'pct') {
      const f = Number(t.replace(',', '.'));
      return Number.isFinite(f) && f >= 0 ? Math.min(10000, Math.round(f * 100)) : 0;
    }
    return parseMoney(t) ?? 0;
  }
  return (
    <div className="disc">
      <Select aria-label={label} value={k} onChange={(e) => { const nk = e.target.value as 'pct' | 'fixed'; onChange(nk, parse(nk, text)); }}>
        <option value="pct">%</option>
        <option value="fixed">৳</option>
      </Select>
      <Input numeric inputMode="decimal" aria-label={label} data-testid={testId} value={text} placeholder="0"
        onChange={(e) => { setText(e.target.value); const v = parse(k, e.target.value); onChange(v === 0 ? null : k, v); }} />
    </div>
  );
}
