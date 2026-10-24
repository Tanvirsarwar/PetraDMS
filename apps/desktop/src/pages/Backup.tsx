import { useState } from 'react';
import { Tabs } from '../ui';
import { useI18n } from '../i18n';
import { BackupsTab } from './backup/BackupsTab';
import { AuditTab } from './backup/AuditTab';
import { SupportTab } from './backup/SupportTab';

type Tab = 'backups' | 'audit' | 'support';

/** Owner only (plan 13.1): backups and restore, the activity log, and the support export. */
export function BackupPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('backups');
  return (
    <div>
      <div className="page-h"><h2>{t('nav.backup')}</h2></div>
      <Tabs value={tab} label={t('nav.backup')} onChange={setTab} tabs={[{ value: 'backups', label: t('bk.tabBackups') }, { value: 'audit', label: t('bk.tabAudit') }, { value: 'support', label: t('bk.tabSupport') }]} />
      <div style={{ marginTop: 12 }}>
        {tab === 'backups' && <BackupsTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'support' && <SupportTab />}
      </div>
    </div>
  );
}
