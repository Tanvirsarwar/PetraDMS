import path from 'node:path';
import { audit } from '../audit';
import type { Dispatcher } from './dispatcher';
import { auditPage, deleteBackup, diagnosticsZip, dismissRecovery, inspectBackup, listForUi, restoreBackup, runBackup, startFresh } from './safetyApp';
import type { AutoBackup } from './autoBackup';

/** Phase 10: backup, restore, audit log, diagnostics. All Owner only (plan 13.1). */
export function registerSafetyServices(d: Dispatcher, auto?: () => AutoBackup | null): void {
  d.register('backup:list', ({ ctx, host }) => listForUi(ctx, host));
  d.register('backup:create', ({ ctx, host }) => {
    const r = runBackup(ctx, host, 'manual');
    audit(ctx, { action: 'backup.create', entity: 'backup', reason: r.item.name });
    auto?.()?.noteManual();
    return r;
  });
  d.register('backup:pickFile', async ({ host }) => ({ path: await host.pickBackupFile() }));
  d.register('backup:pickFolder', async ({ host }) => ({ path: await host.pickDataDir() }));
  d.register('backup:inspect', ({ input }) => inspectBackup(input.path));
  d.register('backup:restore', async ({ dispatcher, input }) => {
    const r = await restoreBackup(dispatcher, input.path);
    return r;
  });
  d.register('shop:startFresh', ({ dispatcher, input }) => startFresh(dispatcher, { backup: input.backup, deleteOldFiles: input.deleteOldFiles }));
  d.register('backup:delete', ({ ctx, host, input }) => {
    deleteBackup(ctx, host, input.path);
    return null;
  });
  d.register('audit:list', ({ ctx, input }) => auditPage(ctx, input));
  d.register('diag:export', ({ ctx, host }) => {
    const { file } = diagnosticsZip(ctx, host);
    host.reveal(file);
    audit(ctx, { action: 'diagnostics.export', entity: 'diagnostics', reason: path.basename(file) });
    return { path: file };
  });
  d.register('recovery:dismiss', ({ ctx }) => {
    dismissRecovery(ctx);
    return null;
  });
}
