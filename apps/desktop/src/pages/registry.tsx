import { BreakPage } from './Break';
import type { ReactElement } from 'react';
import type { Role } from '@petra/core';
import { StyleGuide } from './StyleGuide';
import { SettingsPage } from './Settings';
import { ProductsPage } from './Products';
import { SuppliersPage } from './Suppliers';
import { PurchasesPage } from './Purchases';
import { InventoryPage } from './Inventory';
import { SalesPage } from './Sales';
import { CustomersPage } from './Customers';
import { EmployeesPage } from './Employees';
import { MoneyPage } from './Money';
import { PeoplePage } from './People';
import { DashboardPage } from './Dashboard';
import { ReportsPage } from './Reports';
import { BackupPage } from './Backup';
import { DataPage } from './Data';
import { HelpPage } from './Help';
import { useI18n } from '../i18n';

function ExpensesRoute() {
  const { t } = useI18n();
  return <MoneyPage title={t('nav.expenses')} />;
}

function MoneyRoute() {
  const { t } = useI18n();
  return <MoneyPage title={t('nav.money')} />;
}

/** The help page can start the tour, which lives in the shell; it asks through an event. */
function HelpRoute() {
  return <HelpPage onTour={() => window.dispatchEvent(new Event('petra:tour'))} />;
}

function BreakRoute() {
  return <BreakPage onExit={() => { window.location.hash = '#/help'; }} />;
}

export interface PageDef {
  path: string;
  element: ReactElement;
  /** Appears in the sidebar when true; the style guide is reachable by URL and Ctrl+Shift+G only. */
  nav: boolean;
  /** Lowest role that may open the page (enforced again in the main process for every call). */
  minRole: Role;
}

/** Each phase adds its pages here; the sidebar shows an entry only when its page exists. */
export const PAGES: PageDef[] = [
  { path: '/', element: <DashboardPage />, nav: true, minRole: 'manager' },
  { path: '/sales', element: <SalesPage />, nav: true, minRole: 'staff' },
  { path: '/customers', element: <CustomersPage />, nav: true, minRole: 'staff' },
  { path: '/purchases', element: <PurchasesPage />, nav: true, minRole: 'manager' },
  { path: '/inventory', element: <InventoryPage />, nav: true, minRole: 'staff' },
  { path: '/products', element: <ProductsPage />, nav: true, minRole: 'staff' },
  { path: '/suppliers', element: <SuppliersPage />, nav: true, minRole: 'manager' },
  { path: '/expenses', element: <ExpensesRoute />, nav: true, minRole: 'manager' },
  { path: '/employees', element: <EmployeesPage />, nav: true, minRole: 'manager' },
  { path: '/people', element: <PeoplePage />, nav: true, minRole: 'staff' },
  { path: '/money', element: <MoneyRoute />, nav: true, minRole: 'manager' },
  { path: '/reports', element: <ReportsPage />, nav: true, minRole: 'staff' },
  { path: '/backup', element: <BackupPage />, nav: true, minRole: 'owner' },
  { path: '/settings', element: <SettingsPage />, nav: true, minRole: 'owner' },
  { path: '/data', element: <DataPage />, nav: false, minRole: 'manager' },
  { path: '/break', element: <BreakRoute />, nav: false, minRole: 'staff' },
  { path: '/help', element: <HelpRoute />, nav: false, minRole: 'staff' },
  { path: '/style-guide', element: <StyleGuide />, nav: false, minRole: 'staff' }
];

const RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

export function pagesFor(role: Role): PageDef[] {
  return PAGES.filter((p) => RANK[role] >= RANK[p.minRole]);
}

export function registeredPaths(role: Role): ReadonlySet<string> {
  return new Set(pagesFor(role).filter((p) => p.nav).map((p) => p.path));
}
