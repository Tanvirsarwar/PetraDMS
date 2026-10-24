import { useState } from 'react';
import { BULK_PRODUCT_MAX, type ProductDeleteBlockReason, type ProductsDeletePreview } from '@petra/core';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';
import { Button, Field, Input, Modal, Spinner, toast } from '../../ui';

type Dialog = 'archive' | 'restore' | 'delete' | null;

const REASONS: ProductDeleteBlockReason[] = ['hasSales', 'hasPurchases', 'hasStock', 'hasHistory'];

/**
 * The bar above the product table when rows are ticked, plus its confirmations.
 * Archive/restore ask for a simple confirm; permanent delete first asks the backend what can really be deleted,
 * shows it, and needs DELETE typed (the same pattern as clearing demo data).
 */
export function ProductBulk({ ids, showArchived, onClear, onDone }: { ids: number[]; showArchived: boolean; onClear: () => void; onDone: () => void }) {
  const { t, int } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState('');
  const [preview, setPreview] = useState<ProductsDeletePreview | null>(null);
  const n = ids.length;
  const tooMany = n > BULK_PRODUCT_MAX;

  const close = () => { setDialog(null); setError(null); setWord(''); setPreview(null); };
  const open = (d: Exclude<Dialog, null>) => {
    setError(null);
    setWord('');
    setPreview(null);
    setDialog(d);
    if (d === 'delete') {
      call('catalog:productsDeletePreview', { ids }).then(setPreview, (e: unknown) => setError(errorText(e)));
    }
  };
  const finish = (text: string) => { toast.ok(text); close(); onDone(); };

  const archive = async (archived: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('catalog:productsArchive', { ids, archived });
      const key = archived ? (r.skipped > 0 ? 'prod.bulk.doneArchiveSkip' : 'prod.bulk.doneArchive') : r.skipped > 0 ? 'prod.bulk.doneRestoreSkip' : 'prod.bulk.doneRestore';
      finish(t(key, { changed: int(r.changed), skipped: int(r.skipped) }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('catalog:productsDelete', { ids, confirm: 'DELETE' });
      const key = r.archivedInstead === 0 ? 'prod.bulk.doneDelete' : r.deleted === 0 ? 'prod.bulk.doneDeleteNone' : 'prod.bulk.doneDeleteMixed';
      finish(t(key, { deleted: int(r.deleted), archived: int(r.archivedInstead) }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const blockedBy = (r: ProductDeleteBlockReason) => preview?.blocked.filter((b) => b.reason === r).length ?? 0;
  const cancel = <Button onClick={close}>{t('act.cancel')}</Button>;

  return (
    <>
      {n > 0 && (
        <div className="p-bulkbar" role="toolbar" aria-label={t('prod.bulk.bar')} data-testid="bulk-bar">
          <strong aria-live="polite" data-testid="bulk-count">{t('prod.bulk.selected', { n: int(n) })}</strong>
          <Button disabled={tooMany} onClick={() => open('archive')} data-testid="bulk-archive">{t('act.archive')}</Button>
          {showArchived && <Button disabled={tooMany} onClick={() => open('restore')} data-testid="bulk-restore">{t('act.restore')}</Button>}
          <Button variant="danger" disabled={tooMany} onClick={() => open('delete')} data-testid="bulk-delete">{t('prod.bulk.deletePerm')}</Button>
          <Button onClick={onClear} data-testid="bulk-clear">{t('prod.bulk.clear')}</Button>
          {tooMany && <span className="p-error" role="alert">{t('prod.bulk.tooMany', { max: int(BULK_PRODUCT_MAX) })}</span>}
        </div>
      )}

      <Modal
        open={dialog === 'archive' || dialog === 'restore'}
        title={t(dialog === 'restore' ? 'prod.bulk.restoreTitle' : 'prod.bulk.archiveTitle', { n: int(n) })}
        onClose={close}
        footer={<>{cancel}<Button variant="primary" data-autofocus disabled={busy} onClick={() => void archive(dialog === 'archive')} data-testid="bulk-archive-go">{t(dialog === 'restore' ? 'act.restore' : 'act.archive')}</Button></>}
      >
        <div className="grid" style={{ gap: 10 }}>
          <p style={{ margin: 0 }}>{t(dialog === 'restore' ? 'prod.bulk.restoreBody' : 'prod.bulk.archiveBody')}</p>
          {error && <div className="p-error" role="alert">{error}</div>}
        </div>
      </Modal>

      <Modal
        open={dialog === 'delete'}
        title={t('prod.bulk.deleteTitle', { n: int(n) })}
        onClose={close}
        footer={<>{cancel}<Button variant="danger" disabled={busy || !preview || word.trim().toUpperCase() !== 'DELETE'} onClick={() => void remove()} data-testid="bulk-delete-go">{t('prod.bulk.deletePerm')}</Button></>}
      >
        <div className="grid" style={{ gap: 10 }} data-testid="bulk-delete-body">
          {!preview && !error && <div className="row" style={{ gap: 8 }}><Spinner label={t('prod.bulk.checking')} /><span className="muted">{t('prod.bulk.checking')}</span></div>}
          {preview && (
            <>
              <p style={{ margin: 0 }}><strong>{t('prod.bulk.cannotUndo')}</strong></p>
              {preview.deletable.length > 0 && <p style={{ margin: 0 }} data-testid="bulk-can-delete">{t('prod.bulk.canDelete', { n: int(preview.deletable.length) })}</p>}
              {preview.blocked.length > 0 && (
                <div data-testid="bulk-cannot-delete">
                  <p style={{ margin: '0 0 4px' }}>{t('prod.bulk.cannotDelete', { n: int(preview.blocked.length) })}</p>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {REASONS.filter((r) => blockedBy(r) > 0).map((r) => <li key={r}>{t(`prod.bulk.why.${r}`, { n: int(blockedBy(r)) })}</li>)}
                  </ul>
                </div>
              )}
              {preview.deletable.length === 0 && <p style={{ margin: 0 }}>{t('prod.bulk.nothingToDelete')}</p>}
              <Field label={t('prod.bulk.typeDelete')}>{(a) => <Input id={a.id} data-autofocus value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" data-testid="bulk-delete-confirm" />}</Field>
            </>
          )}
          {error && <div className="p-error" role="alert">{error}</div>}
        </div>
      </Modal>
    </>
  );
}
