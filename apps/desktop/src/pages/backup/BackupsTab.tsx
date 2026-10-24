import { useEffect, useState } from 'react';
import type { BackupInfo, Settings } from '@petra/core';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, Switch, Table, toast, useQuery } from '../../ui';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { useApp } from '../../store/app';

const KIND_KEY: Record<BackupInfo['kind'], string> = { manual: 'bk.kindManual', auto: 'bk.kindAuto', close: 'bk.kindClose', 'pre-migrate': 'bk.kindMigrate', 'pre-restore': 'bk.kindRestore', 'pre-reset': 'bk.kindReset' };

export function sizeText(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function BackupsTab() {
  const { t, n, int } = useI18n();
  const list = useQuery('backup:list', undefined);
  const settings = useApp((s) => s.status?.settings);
  const refresh = useApp((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [restoreFor, setRestoreFor] = useState<BackupInfo | null>(null);
  const [deleteFor, setDeleteFor] = useState<BackupInfo | null>(null);
  const [freshOpen, setFreshOpen] = useState(false);
  const [interval, setIntervalText] = useState(String(settings?.backupIntervalMinutes ?? 30));
  useEffect(() => setIntervalText(String(settings?.backupIntervalMinutes ?? 30)), [settings?.backupIntervalMinutes]);
  const when = (iso: string) => n(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);

  const save = async (patch: Partial<Settings>) => {
    try {
      await call('settings:save', patch);
      await refresh();
      list.reload();
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  const backupNow = async () => {
    setBusy(true);
    try {
      const r = await call('backup:create');
      toast.ok(t('bk.done'));
      if (r.warning) toast.error(t('bk.secondWarn'));
      list.reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const chooseSecond = async () => {
    const r = await call('backup:pickFolder');
    if (r.path) await save({ secondBackupDir: r.path });
  };
  const restoreFromFile = async () => {
    try {
      const r = await call('backup:pickFile');
      if (!r.path) return;
      setRestoreFor(await call('backup:inspect', { path: r.path }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const d = list.data;
  const last = d?.last ?? null;
  const ageH = last ? (Date.now() - Date.parse(last.createdAt)) / 3_600_000 : null;
  const stale = ageH === null || ageH > 48;

  return (
    <div className="grid" style={{ gap: 12 }}>
      <Card
        title={t('bk.status')}
        actions={<><Button onClick={() => void restoreFromFile()} data-testid="backup-from-file">{t('bk.restoreFile')}</Button><Button variant="primary" disabled={busy} onClick={() => void backupNow()} data-testid="backup-now">{t('bk.now')}</Button></>}
      >
        <p data-testid="backup-last" className={stale ? 'p-error' : ''} style={{ margin: 0, fontWeight: 'var(--fw-strong)' }}>
          {last ? t('bk.last', { when: when(last.createdAt) }) : t('bk.none')}
        </p>
        {stale && <p className="muted" style={{ marginBottom: 0 }}>{t('bk.staleHint')}</p>}
        <p className="muted" style={{ marginBottom: 0 }}>{t('bk.where', { dir: d?.dir ?? '' })}</p>
      </Card>

      <Card title={t('bk.settings')}>
        <div className="grid" style={{ gap: 12 }}>
          <div className="row"><Switch checked={settings?.backupAuto ?? true} onChange={(v) => void save({ backupAuto: v })} label={t('bk.auto')} /></div>
          <div className="row">
            <Field label={t('bk.every')} hint={t('bk.everyHint')}>
              {(a) => <Input id={a.id} inputMode="numeric" style={{ width: 110 }} value={interval} disabled={!(settings?.backupAuto ?? true)} onChange={(e) => setIntervalText(e.target.value.replace(/\D/g, ''))} onBlur={() => { const v = Math.min(1440, Math.max(5, Number(interval) || 30)); setIntervalText(String(v)); if (v !== settings?.backupIntervalMinutes) void save({ backupIntervalMinutes: v }); }} data-testid="backup-interval" />}
            </Field>
          </div>
          <div className="row"><Switch checked={settings?.backupOnClose ?? true} onChange={(v) => void save({ backupOnClose: v })} label={t('bk.onClose')} /></div>
          <Field label={t('bk.second')} hint={t('bk.secondHint')}>
            {() => (
              <div className="row wrap">
                <span className="num" data-testid="backup-second" style={{ textAlign: 'left', minWidth: 240 }}>{d?.dir2 || t('bk.secondNone')}</span>
                {d?.dir2 && <Badge tone={d.dir2Ok ? 'ok' : 'red'}>{d.dir2Ok ? t('bk.reachable') : t('bk.unreachable')}</Badge>}
                <Button size="sm" onClick={() => void chooseSecond()} data-testid="backup-pick-second">{t('bk.choose')}</Button>
                {d?.dir2 && <Button size="sm" variant="ghost" onClick={() => void save({ secondBackupDir: '' })}>{t('bk.remove')}</Button>}
              </div>
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('bk.list')} flat>
        {list.error && <div className="p-error" role="alert">{list.error}</div>}
        {d && d.items.length === 0 ? <EmptyState title={t('bk.empty')} body={t('bk.emptyBody')} /> : (
          <Table
            rows={d?.items ?? []}
            rowKey={(b) => b.path}
            pageSize={15}
            columns={[
              { key: 'at', header: t('word.date'), render: (b: BackupInfo) => <span data-testid="backup-row">{when(b.createdAt)}</span>, sortValue: (b) => b.createdAt },
              { key: 'kind', header: t('bk.type'), render: (b) => <Badge tone={b.kind === 'manual' ? 'dark' : 'default'}>{t(KIND_KEY[b.kind])}</Badge> },
              { key: 'what', header: t('bk.contains'), render: (b) => (b.ok ? t('bk.counts', { products: int(b.counts.products), customers: int(b.counts.customers), sales: int(b.counts.sales) }) : <Badge tone="red">{t('bk.damaged')}</Badge>) },
              { key: 'size', header: t('bk.size'), right: true, render: (b) => n(sizeText(b.bytes)), sortValue: (b) => b.bytes },
              { key: 'where', header: t('bk.location'), render: (b) => (b.where === 'second' ? t('bk.locSecond') : t('bk.locMain')) },
              {
                key: 'act', header: '', right: true,
                render: (b) => (
                  <span className="row" style={{ justifyContent: 'flex-end' }}>
                    {b.ok && <Button size="sm" onClick={() => setRestoreFor(b)} data-testid="backup-restore">{t('bk.restore')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setDeleteFor(b)} data-testid="backup-delete">{t('act.delete')}</Button>
                  </span>
                )
              }
            ]}
          />
        )}
      </Card>

      <Card title={t('bk.freshTitle')}>
        <div className="row wrap" style={{ gap: 12, justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0, flex: '1 1 320px' }}>{t('bk.freshBody')}</p>
          <Button variant="danger" onClick={() => setFreshOpen(true)} data-testid="fresh-open">{t('bk.freshOpen')}</Button>
        </div>
      </Card>

      <StartFreshModal open={freshOpen} onClose={() => setFreshOpen(false)} onDone={() => { setFreshOpen(false); void refresh(); }} />
      <RestoreModal backup={restoreFor} when={when} onClose={() => setRestoreFor(null)} onDone={() => { setRestoreFor(null); void refresh(); }} />
      <Modal
        open={deleteFor !== null}
        title={t('bk.deleteTitle')}
        onClose={() => setDeleteFor(null)}
        footer={<><Button onClick={() => setDeleteFor(null)}>{t('act.cancel')}</Button><Button variant="danger" data-autofocus data-testid="backup-delete-go" onClick={() => { const f = deleteFor; setDeleteFor(null); if (f) void call('backup:delete', { path: f.path }).then(() => list.reload(), (e: unknown) => toast.error(errorText(e))); }}>{t('act.delete')}</Button></>}
      >
        {t('bk.deleteBody')}
      </Modal>
    </div>
  );
}

/** Restore asks for the word RESTORE, because it replaces everything entered since the backup. A safety copy is taken first. */
function RestoreModal({ backup, when, onClose, onDone }: { backup: BackupInfo | null; when: (iso: string) => string; onClose: () => void; onDone: () => void }) {
  const { t, int } = useI18n();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setWord('');
    setError(null);
  }, [backup?.path]);
  const go = async () => {
    if (!backup) return;
    setBusy(true);
    setError(null);
    try {
      await call('backup:restore', { path: backup.path, confirm: 'RESTORE' });
      toast.ok(t('bk.restored'));
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={backup !== null}
      title={t('bk.restoreTitle')}
      onClose={onClose}
      footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button variant="danger" disabled={busy || word.trim().toUpperCase() !== 'RESTORE'} onClick={() => void go()} data-testid="restore-go">{t('bk.restoreGo')}</Button></>}
    >
      {backup && (
        <div className="grid" style={{ gap: 10 }}>
          <p style={{ margin: 0 }} data-testid="restore-summary">{t('bk.restoreSummary', { when: when(backup.createdAt), business: backup.business || '-', products: int(backup.counts.products), customers: int(backup.counts.customers), sales: int(backup.counts.sales) })}</p>
          <p className="p-error" style={{ margin: 0 }}>{t('bk.restoreWarn', { when: when(backup.createdAt) })}</p>
          <p className="muted" style={{ margin: 0 }}>{t('bk.restoreSafety')}</p>
          <Field label={t('bk.typeRestore')}>{(a) => <Input id={a.id} data-autofocus value={word} onChange={(e) => setWord(e.target.value)} data-testid="restore-confirm" autoComplete="off" />}</Field>
          {error && <div className="p-error" role="alert" data-testid="restore-error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

/**
 * Start fresh: deletes the whole shop and opens the setup wizard. The owner chooses whether a backup is kept first
 * (recommended, the default); without one they may also clear the old backups, exports and saved invoices.
 */
function StartFreshModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [backup, setBackup] = useState(true);
  const [wipeFiles, setWipeFiles] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setBackup(true); setWipeFiles(false); setWord(''); setError(null);
  }, [open]);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('shop:startFresh', { confirm: 'DELETE', backup, deleteOldFiles: !backup && wipeFiles });
      toast.ok(r.backup ? t('bk.freshDoneBackup', { name: r.backup.name }) : t('bk.freshDone'));
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={t('bk.freshTitle')}
      onClose={onClose}
      footer={<><Button onClick={onClose}>{t('act.cancel')}</Button><Button variant="danger" disabled={busy || word.trim().toUpperCase() !== 'DELETE'} onClick={() => void go()} data-testid="fresh-go">{t('bk.freshGo')}</Button></>}
    >
      <div className="grid" style={{ gap: 12 }}>
        <p className="p-error" style={{ margin: 0 }}>{t('bk.freshWarn')}</p>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          <legend className="p-label" style={{ marginBottom: 6 }}>{t('bk.freshAsk')}</legend>
          <label className="p-check"><input type="radio" name="fresh-backup" checked={backup} onChange={() => { setBackup(true); setWipeFiles(false); }} data-testid="fresh-backup-yes" /> {t('bk.freshYes')}</label>
          <label className="p-check"><input type="radio" name="fresh-backup" checked={!backup} onChange={() => setBackup(false)} data-testid="fresh-backup-no" /> {t('bk.freshNo')}</label>
        </fieldset>
        {backup
          ? <p className="muted" style={{ margin: 0 }}>{t('bk.freshYesHelp')}</p>
          : <Checkbox label={t('bk.freshWipe')} checked={wipeFiles} onChange={(e) => setWipeFiles(e.target.checked)} data-testid="fresh-wipe" />}
        {!backup && <p className="p-error" style={{ margin: 0 }}>{wipeFiles ? t('bk.freshNoUndoAll') : t('bk.freshNoUndo')}</p>}
        <Field label={t('bk.typeDelete')}>{(a) => <Input id={a.id} data-autofocus value={word} onChange={(e) => setWord(e.target.value)} data-testid="fresh-confirm" autoComplete="off" />}</Field>
        {error && <div className="p-error" role="alert" data-testid="fresh-error">{error}</div>}
        {busy && <p className="muted" style={{ margin: 0 }}>{t('bk.freshBusy')}</p>}
      </div>
    </Modal>
  );
}
