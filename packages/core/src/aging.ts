export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface AgingDebit {
  ref: string;
  /** Business date, YYYY-MM-DD. */
  date: string;
  amount: number;
}

export interface AgingResult {
  buckets: Record<AgingBucket, number>;
  /** Credit left over after every debit was cleared (customer paid in advance). */
  advance: number;
  total: number;
  open: { ref: string; date: string; remaining: number; ageDays: number; bucket: AgingBucket }[];
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '90+';
}

/**
 * Due aging for the khata model. Payments and returns are pooled and applied to the oldest
 * debits first. This is a report-time calculation and changes no stored data.
 */
export function computeDueAging(debits: AgingDebit[], creditsTotal: number, asOf: string): AgingResult {
  const sorted = [...debits].filter((d) => d.amount > 0).sort((a, b) => (a.date === b.date ? a.ref.localeCompare(b.ref) : a.date.localeCompare(b.date)));
  let credit = creditsTotal;
  const buckets: Record<AgingBucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const open: AgingResult['open'] = [];
  for (const d of sorted) {
    const used = Math.min(credit, d.amount);
    credit -= used;
    const remaining = d.amount - used;
    if (remaining > 0) {
      const ageDays = Math.max(0, daysBetween(d.date, asOf));
      const bucket = bucketFor(ageDays);
      buckets[bucket] += remaining;
      open.push({ ref: d.ref, date: d.date, remaining, ageDays, bucket });
    }
  }
  const total = buckets['0-30'] + buckets['31-60'] + buckets['61-90'] + buckets['90+'];
  return { buckets, advance: credit, total, open };
}
