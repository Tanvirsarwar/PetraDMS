import { Button, Kbd } from './controls';
import { toast } from './toast';
import { useI18n } from '../i18n';

/** The printable recovery code. `@media print` hides everything else on the page. */
export function RecoverySheet({ code, business, owner }: { code: string; business: string; owner: string }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="print-sheet" data-testid="recovery-sheet">
        <div className="print-title">{t('wiz.printTitle')}</div>
        <div className="print-code num" data-testid="recovery-code">{code}</div>
        <div>{t('wiz.printFor', { name: business })}</div>
        <div>{t('wiz.printOwner', { name: owner })}</div>
        <div className="print-note">{t('wiz.printNote')}</div>
      </div>
      <div className="row wrap no-print" style={{ marginTop: 12 }}>
        <Button variant="dark" onClick={() => window.print()}>{t('act.print')}</Button>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => toast.ok(t('wiz.copied')), () => undefined);
          }}
        >
          {t('wiz.copy')}
        </Button>
        <Kbd>Ctrl+P</Kbd>
      </div>
    </div>
  );
}
