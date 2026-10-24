import { describe, expect, it } from 'vitest';
import { headerState, pruneSelection, selectRange, toggleAll, toggleKey } from './selection';

const keys = [1, 2, 3, 4, 5, 6];

describe('table selection helpers', () => {
  it('toggles one key without changing the input set', () => {
    const a = new Set<number>([2]);
    expect([...toggleKey(a, 3)].sort()).toEqual([2, 3]);
    expect([...toggleKey(a, 2)]).toEqual([]);
    expect([...a]).toEqual([2]);
  });

  it('shift-click selects the whole range in either direction, in the order shown', () => {
    expect([...selectRange(new Set(), keys, 2, 5)].sort()).toEqual([2, 3, 4, 5]);
    expect([...selectRange(new Set(), keys, 5, 2)].sort()).toEqual([2, 3, 4, 5]);
    // order shown can differ from id order (sorted view)
    expect([...selectRange(new Set(), [9, 1, 7, 3], 9, 7)].sort()).toEqual([1, 7, 9]);
  });

  it('shift-click on a selected row unselects the range', () => {
    const start = new Set<number>([1, 2, 3, 4]);
    expect([...selectRange(start, keys, 1, 3)]).toEqual([4]);
  });

  it('shift-click without a usable anchor is a plain toggle', () => {
    expect([...selectRange(new Set(), keys, null, 4)]).toEqual([4]);
    expect([...selectRange(new Set(), keys, 99, 4)]).toEqual([4]);
    expect([...selectRange(new Set(), keys, 2, 99)]).toEqual([99]);
  });

  it('header state covers none / some / all of the whole list, and an empty list is none', () => {
    expect(headerState(new Set(), keys)).toBe('none');
    expect(headerState(new Set([1]), keys)).toBe('some');
    expect(headerState(new Set(keys), keys)).toBe('all');
    expect(headerState(new Set([99]), keys)).toBe('none'); // keys outside the list do not count
    expect(headerState(new Set([1]), [])).toBe('none');
  });

  it('select-all takes every row of the list, not just a page; a second click clears them and keeps outside keys', () => {
    const all = toggleAll(new Set([99]), keys);
    expect([...all].sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5, 6, 99]);
    expect([...toggleAll(all, keys)]).toEqual([99]);
    expect(headerState(toggleAll(new Set([2]), keys), keys)).toBe('all'); // partial -> all
  });

  it('prune drops rows that left the list and returns the same set when nothing changed', () => {
    const s = new Set<number>([1, 2, 9]);
    expect([...pruneSelection(s, [1, 2, 3])].sort()).toEqual([1, 2]);
    const same = new Set<number>([1, 2]);
    expect(pruneSelection(same, [1, 2, 3])).toBe(same);
    const empty = new Set<number>();
    expect(pruneSelection(empty, [])).toBe(empty);
  });
});
