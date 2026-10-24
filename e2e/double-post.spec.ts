import { test, expect } from '@playwright/test';
import { launch, completeSetup, inv, navTo } from './helpers';

test('money events post once: double-clicked expense form, a retried request id, and a retried payment', async () => {
  const { app, page, consoleErrors } = await launch();
  await completeSetup(page, { lang: 'en' });
  const today = (await inv<{ businessDate: string }>(page, 'app:status')).businessDate;

  // the form: a fast double click and a double Enter reach the server as one request
  await navTo(page, 'Expenses');
  await page.getByTestId('add-expense').click();
  await page.getByTestId('exp-amount').fill('1500');
  await page.getByTestId('exp-payee').fill('Shop rent');
  await page.getByTestId('exp-save').dblclick();
  await expect(page.getByRole('row').filter({ hasText: 'Shop rent' })).toHaveCount(1);

  // the channel: the same request id twice returns the first expense
  const cat = (await inv<{ id: number }[]>(page, 'exp:categories', { includeArchived: false }))[0]!;
  const body = { categoryId: cat.id, amount: 20000, date: today, payee: 'Tea', note: '', requestId: 'e2e-request-0001' };
  const a = await inv<{ id: number; docNo: string }>(page, 'exp:save', body);
  const b = await inv<{ id: number; docNo: string }>(page, 'exp:save', body);
  expect(b).toEqual(a);

  // a customer receipt retried the same way
  const cust = await inv<{ id: number }>(page, 'customer:save', { name: 'Karim', phone: '', type: 'retail', creditLimit: 0, openingBalance: 500000, openingDate: today });
  const pay = { partyKind: 'customer', partyId: cust.id, amount: 100000, date: today, requestId: 'e2e-request-0002' };
  const p1 = await inv<{ id: number }>(page, 'payment:save', pay);
  const p2 = await inv<{ id: number }>(page, 'payment:save', pay);
  expect(p2).toEqual(p1);

  const list = await inv<{ rows: { id: number }[]; total: number }>(page, 'exp:list', { includeVoid: true });
  expect(list.rows).toHaveLength(2);
  expect(list.total).toBe(150000 + 20000);
  const ledger = await inv<{ party: { balance: number } }>(page, 'party:ledger', { kind: 'customer', id: cust.id });
  expect(ledger.party.balance).toBe(400000);
  expect(consoleErrors).toEqual([]);
  await app.close();
});
