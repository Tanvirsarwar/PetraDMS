import { useState } from 'react';
import { useI18n } from '../i18n';
import { Tabs } from '../ui';
import { ExpensesTab } from './money/ExpensesTab';
import { CashbookTab } from './money/CashbookTab';
import { DayCloseTab } from './money/DayCloseTab';
import { AccountsTab } from './money/AccountsTab';
import { FundsTab } from './money/FundsTab';

type Tab = 'expenses' | 'cashbook' | 'day' | 'accounts' | 'funds';

/** Expenses, cash book, day closing and money accounts. Full mode opens it as "Expenses", Simple mode as "Money". */
export function MoneyPage({ initial = 'expenses', title }: { initial?: Tab; title: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <div>
      <div className="page-h"><h2>{title}</h2></div>
      <Tabs value={tab} label={title} onChange={setTab} tabs={[
        { value: 'expenses', label: t('nav.expenses') },
        { value: 'cashbook', label: t('money.cashbook') },
        { value: 'day', label: t('money.day') },
        { value: 'accounts', label: t('money.accounts') },
        { value: 'funds', label: t('money.funds') }
      ]} />
      <div style={{ marginTop: 12 }}>
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'cashbook' && <CashbookTab />}
        {tab === 'day' && <DayCloseTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'funds' && <FundsTab />}
      </div>
    </div>
  );
}
