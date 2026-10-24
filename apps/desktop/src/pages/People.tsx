import { useState } from 'react';
import { useI18n } from '../i18n';
import { useApp } from '../store/app';
import { Tabs } from '../ui';
import { CustomersPage } from './Customers';
import { SuppliersPage } from './Suppliers';
import { EmployeesPage } from './Employees';

type Tab = 'customers' | 'suppliers' | 'employees';

/** Simple mode "People": customers for everyone, suppliers and employees for Manager and above. */
export function PeoplePage() {
  const { t } = useI18n();
  const role = useApp((s) => s.status?.session?.role ?? 'staff');
  const [tab, setTab] = useState<Tab>('customers');
  const tabs: { value: Tab; label: string }[] = [{ value: 'customers', label: t('nav.customers') }];
  if (role !== 'staff') tabs.push({ value: 'suppliers', label: t('nav.suppliers') }, { value: 'employees', label: t('nav.employees') });
  return (
    <div>
      <div className="page-h"><h2>{t('nav.people')}</h2></div>
      <Tabs value={tab} label={t('nav.people')} onChange={setTab} tabs={tabs} />
      <div style={{ marginTop: 12 }}>
        {tab === 'customers' && <CustomersPage embedded />}
        {tab === 'suppliers' && <SuppliersPage />}
        {tab === 'employees' && <EmployeesPage embedded />}
      </div>
    </div>
  );
}
