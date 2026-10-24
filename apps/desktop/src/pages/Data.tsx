import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IMPORT_KINDS, type ImportKind } from '@petra/core';
import { Tabs } from '../ui';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { ImportTab } from './data/ImportTab';
import { ExportTab } from './data/ExportTab';
import { DemoTab } from './data/DemoTab';

type Tab = 'import' | 'export' | 'demo';

/** Import from CSV (Manager and Owner), export everything and demo mode (Owner). Reached from Settings, Products and Customers. */
export function DataPage() {
  const { t } = useI18n();
  const role = useApp((s) => s.status?.session?.role);
  const loc = useLocation();
  const st = loc.state as { kind?: string; tab?: string } | null;
  const asked = st?.kind;
  const initialKind: ImportKind = IMPORT_KINDS.find((k) => k === asked) ?? 'products';
  const [tab, setTab] = useState<Tab>(st?.tab === 'demo' && role === 'owner' ? 'demo' : 'import');
  const tabs: { value: Tab; label: string }[] = [{ value: 'import', label: t('data.tabImport') }];
  if (role === 'owner') tabs.push({ value: 'export', label: t('data.tabExport') }, { value: 'demo', label: t('data.tabDemo') });
  return (
    <div>
      <div className="page-h"><h2>{t('data.title')}</h2></div>
      <Tabs value={tab} label={t('data.title')} onChange={setTab} tabs={tabs} />
      <div style={{ marginTop: 12 }}>
        {tab === 'import' && <ImportTab initialKind={initialKind} />}
        {tab === 'export' && role === 'owner' && <ExportTab />}
        {tab === 'demo' && role === 'owner' && <DemoTab />}
      </div>
    </div>
  );
}
