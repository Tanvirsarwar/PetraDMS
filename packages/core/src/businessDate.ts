function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date of `d` as YYYY-MM-DD. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + days * 86_400_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The business date is separate from the clock: a shop open past midnight stays on one business day.
 * Times before `rolloverHour` (default 4 am) still belong to the previous day, and after a day is
 * closed the next postings go to the day after it.
 */
export function businessDateFor(now: Date, rolloverHour = 4, lastClosed?: string | null): string {
  const shifted = new Date(now.getTime() - rolloverHour * 3_600_000);
  const date = localDate(shifted);
  if (lastClosed && date <= lastClosed) return addDays(lastClosed, 1);
  return date;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** DD/MM/YYYY for display. */
export function formatDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
