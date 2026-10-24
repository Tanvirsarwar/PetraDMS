import type { ComponentType } from 'react';
import { IconBackup, IconDashboard, IconMoney, IconPeople, IconProducts, IconPurchase, IconReports, IconSales, IconSettings, IconStock } from '../ui/icons';

export interface NavItem {
  id: string;
  path: string;
  labelKey: string;
  Icon: ComponentType<{ size?: number }>;
}

/** Full mode: the twelve entries from plan 8.1. Entries appear only once their page is registered. */
export const FULL_NAV: NavItem[] = [
  { id: 'dashboard', path: '/', labelKey: 'nav.dashboard', Icon: IconDashboard },
  { id: 'sales', path: '/sales', labelKey: 'nav.sales', Icon: IconSales },
  { id: 'purchases', path: '/purchases', labelKey: 'nav.purchases', Icon: IconPurchase },
  { id: 'inventory', path: '/inventory', labelKey: 'nav.inventory', Icon: IconStock },
  { id: 'products', path: '/products', labelKey: 'nav.products', Icon: IconProducts },
  { id: 'customers', path: '/customers', labelKey: 'nav.customers', Icon: IconPeople },
  { id: 'suppliers', path: '/suppliers', labelKey: 'nav.suppliers', Icon: IconPurchase },
  { id: 'expenses', path: '/expenses', labelKey: 'nav.expenses', Icon: IconMoney },
  { id: 'employees', path: '/employees', labelKey: 'nav.employees', Icon: IconPeople },
  { id: 'reports', path: '/reports', labelKey: 'nav.reports', Icon: IconReports },
  { id: 'backup', path: '/backup', labelKey: 'nav.backup', Icon: IconBackup },
  { id: 'settings', path: '/settings', labelKey: 'nav.settings', Icon: IconSettings }
];

/** Simple mode: six large entries from plan 8.1. */
export const SIMPLE_NAV: NavItem[] = [
  { id: 'sell', path: '/sales', labelKey: 'nav.sell', Icon: IconSales },
  { id: 'buy', path: '/purchases', labelKey: 'nav.buy', Icon: IconPurchase },
  { id: 'stock', path: '/inventory', labelKey: 'nav.stock', Icon: IconStock },
  { id: 'people', path: '/people', labelKey: 'nav.people', Icon: IconPeople },
  { id: 'money', path: '/money', labelKey: 'nav.money', Icon: IconMoney },
  { id: 'reports', path: '/reports', labelKey: 'nav.reports', Icon: IconReports }
];

export function visibleNav(mode: 'simple' | 'full', registered: ReadonlySet<string>): NavItem[] {
  return (mode === 'simple' ? SIMPLE_NAV : FULL_NAV).filter((n) => registered.has(n.path));
}
