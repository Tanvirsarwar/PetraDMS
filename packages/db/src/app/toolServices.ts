import type { Dispatcher } from './dispatcher';
import { currentBusinessDate } from './coreServices';
import { loadSettings } from '../settings';
import { scalar } from '../sql';
import { periodFigures } from './reportsApp';
import { SearchService } from './searchApp';

/** Phase 9: global search, the small figures shown in compact mode, and the compact window toggle. */
export function registerToolServices(d: Dispatcher): SearchService {
  const search = new SearchService();
  d.register('search:query', ({ ctx, session, input, dispatcher }) => search.query(ctx, dispatcher.writeGen, session!.role, input.q, input.limit));
  d.register('compact:figures', ({ ctx, session }) => {
    const today = currentBusinessDate(ctx, loadSettings(ctx.db));
    const f = periodFigures(ctx, today, today);
    return {
      sales: f.netSales,
      collected: f.collected,
      invoices: f.invoices,
      cash: session!.role === 'staff' ? null : scalar<number>(ctx.db, "SELECT COALESCE(SUM(balance),0) FROM money_accounts WHERE kind = 'cash' AND active = 1")
    };
  });
  d.register('window:compact', async ({ host, input }) => {
    await host.setCompact(input.on);
    return null;
  });
  return search;
}
