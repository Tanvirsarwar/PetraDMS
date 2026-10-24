/** Row-selection helpers for the shared Table. Pure functions, no React, so they are easy to test. */

export type RowKey = string | number;
export type Selection = ReadonlySet<RowKey>;
export type HeaderState = 'none' | 'some' | 'all';

/** Flip one row. */
export function toggleKey(selected: Selection, key: RowKey): Set<RowKey> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Shift-click: every row between the anchor and the clicked row (inclusive, in the order shown) becomes selected
 * or unselected, whichever the clicked row is going to become. Without a usable anchor it is a plain toggle.
 */
export function selectRange(selected: Selection, ordered: readonly RowKey[], anchor: RowKey | null, target: RowKey): Set<RowKey> {
  const to = ordered.indexOf(target);
  const from = anchor === null ? -1 : ordered.indexOf(anchor);
  if (to < 0 || from < 0) return toggleKey(selected, target);
  const select = !selected.has(target);
  const next = new Set(selected);
  const [lo, hi] = from < to ? [from, to] : [to, from];
  for (let i = lo; i <= hi; i++) {
    const k = ordered[i] as RowKey;
    if (select) next.add(k);
    else next.delete(k);
  }
  return next;
}

/** State of the header checkbox against ALL rows of the list (not just the visible page). */
export function headerState(selected: Selection, keys: readonly RowKey[]): HeaderState {
  if (keys.length === 0) return 'none';
  let n = 0;
  for (const k of keys) if (selected.has(k)) n++;
  return n === 0 ? 'none' : n === keys.length ? 'all' : 'some';
}

/** Header click: select every row of the list, unless they are all selected already, then clear them. Other selections are kept. */
export function toggleAll(selected: Selection, keys: readonly RowKey[]): Set<RowKey> {
  const next = new Set(selected);
  if (headerState(selected, keys) === 'all') for (const k of keys) next.delete(k);
  else for (const k of keys) next.add(k);
  return next;
}

/** Drops keys that are no longer in the list (a filter changed, rows were archived or deleted). Returns the same set when nothing changed. */
export function pruneSelection(selected: Selection, keys: readonly RowKey[]): Selection {
  if (selected.size === 0) return selected;
  const live = new Set(keys);
  let drop = false;
  for (const k of selected) if (!live.has(k)) { drop = true; break; }
  if (!drop) return selected;
  const next = new Set<RowKey>();
  for (const k of selected) if (live.has(k)) next.add(k);
  return next;
}
