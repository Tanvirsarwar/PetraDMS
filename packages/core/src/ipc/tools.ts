import { z } from 'zod';
import { ch } from './define';
import type { SearchHit } from '../search';

export interface SearchResult {
  hits: SearchHit[];
  /** Time spent on the query itself, in milliseconds. */
  ms: number;
  /** Number of searchable records. */
  size: number;
}

export interface CompactFigures {
  sales: number;
  collected: number;
  invoices: number;
  /** Cash in the drawer: Owner and Manager only. */
  cash: number | null;
}

export const toolChannels = {
  'search:query': ch<SearchResult>()(z.object({ q: z.string().max(100), limit: z.number().int().min(1).max(50).default(20) })),
  'compact:figures': ch<CompactFigures>()(z.undefined()),
  'window:compact': ch()(z.object({ on: z.boolean() }))
};
