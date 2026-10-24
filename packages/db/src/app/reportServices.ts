import fs from 'node:fs';
import path from 'node:path';
import type { Dispatcher } from './dispatcher';
import { currentBusinessDate } from './coreServices';
import { loadSettings } from '../settings';
import { dashboard, runReport } from './reportsApp';
import { reportCsv, reportXlsx } from './exportFiles';

/** Phase 8: dashboard, reports and their CSV / XLSX export (PDF and printing go through `print:run`). */
export function registerReportServices(d: Dispatcher): void {
  d.register('report:run', ({ ctx, session, input }) => runReport(ctx, session!.role, currentBusinessDate(ctx, loadSettings(ctx.db)), input));
  d.register('dash:get', ({ ctx }) => dashboard(ctx, currentBusinessDate(ctx, loadSettings(ctx.db))));
  d.register('report:export', ({ ctx, session, input, host }) => {
    const today = currentBusinessDate(ctx, loadSettings(ctx.db));
    const res = runReport(ctx, session!.role, today, input.params);
    const stem = `${input.params.id}-${input.params.to ?? today}`.replace(/[^\w.-]+/g, '_');
    const file = path.join(host.dataDir, 'exports', `${stem}.${input.format}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (input.format === 'csv') fs.writeFileSync(file, reportCsv(res, input.headers, input.dict));
    else fs.writeFileSync(file, reportXlsx(res, input.title, input.headers, input.dict));
    host.reveal(file);
    return { path: file };
  });
}
