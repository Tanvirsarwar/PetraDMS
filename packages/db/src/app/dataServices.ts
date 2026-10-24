import fs from 'node:fs';
import { PetraError } from '@petra/core';
import { all, scalar } from '../sql';
import { audit } from '../audit';
import { getRaw, loadSettings, setRaw } from '../settings';
import { tx } from '../ctx';
import { seedDemo } from '../demo';
import type { Dispatcher } from './dispatcher';
import { currentBusinessDate } from './coreServices';
import { exportEverything } from './exportAll';
import { previewImport, rejectsFile, runImport, templateFile } from './importApp';
import { restoreBackup, runBackup } from './safetyApp';

export const isDemo = (db: Parameters<typeof getRaw>[0]): boolean => getRaw(db, 'demo_mode') === '1';

/** Phase 11: CSV import, export everything, demo mode. */
export function registerDataServices(d: Dispatcher): void {
  d.register('import:template', ({ ctx, host, input }) => templateFile(ctx, host, input.kind));
  d.register('import:preview', ({ ctx, input }) => previewImport(ctx, input.kind, input.text, input.mapping));
  d.register('import:run', ({ ctx, input }) => runImport(ctx, currentBusinessDate(ctx, loadSettings(ctx.db)), input));
  d.register('import:rejects', ({ ctx, host, input }) => rejectsFile(ctx, host, input));
  const top = (db: Parameters<typeof all>[0]) => all<{ player: string; score: number; at: string }>(db, 'SELECT player, score, at FROM game_scores ORDER BY score DESC, id ASC LIMIT 10');
  d.register('game:scores', ({ ctx }) => top(ctx.db));
  d.register('game:submit', ({ ctx, session, input }) => {
    if (input.score > 0) ctx.db.prepare('INSERT INTO game_scores(player, score, at) VALUES (?, ?, ?)').run(session?.displayName ?? 'Player', input.score, ctx.now());
    return top(ctx.db);
  });
  d.register('export:all', ({ ctx, host }) => exportEverything(ctx, host));

  d.register('demo:load', ({ ctx, host }) => {
    const empty = ['products', 'customers', 'suppliers', 'sales', 'purchases'].every((t) => scalar<number>(ctx.db, `SELECT COUNT(*) FROM ${t}`) === 0);
    if (!empty || isDemo(ctx.db)) throw new PetraError('DEMO_UNAVAILABLE', 'demo data can only be loaded into an empty shop');
    // The restore point is a normal safety backup of the empty shop; clearing the demo restores it.
    const point = runBackup(ctx, host, 'pre-restore').item;
    tx(ctx, () => {
      seedDemo(ctx, currentBusinessDate(ctx, loadSettings(ctx.db)));
      setRaw(ctx, 'demo_mode', '1');
      setRaw(ctx, 'demo_restore_point', point.path);
      audit(ctx, { action: 'demo.load', entity: 'demo', reason: point.name });
    });
    return null;
  });
  d.register('demo:clear', async ({ ctx, dispatcher }) => {
    if (!isDemo(ctx.db)) throw new PetraError('DEMO_UNAVAILABLE', 'demo mode is not on');
    const point = getRaw(ctx.db, 'demo_restore_point') ?? '';
    if (!point || !fs.existsSync(point)) throw new PetraError('BACKUP_INVALID', 'the copy of the shop from before the demo is missing', { reason: 'demoPoint' });
    await restoreBackup(dispatcher, point);
    return { cleared: true as const };
  });
}
