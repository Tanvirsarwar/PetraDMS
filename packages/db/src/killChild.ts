/**
 * Child process for the kill-during-write test (`safety.test.ts`). It opens a real database file with the app's
 * pragmas and posts sales, payments and expenses as fast as it can, printing the number of each committed
 * transaction. The parent kills it with SIGKILL at a random moment.
 */
import { makeCtx } from './ctx';
import { openDatabase } from './index';
import { postSale } from './sales';
import { postPayment } from './money';
import { postExpense } from './money';
import { all } from './sql';

const file = process.argv[2] as string;
const db = openDatabase(file);
const owner = (all<{ id: number }>(db, "SELECT id FROM users WHERE role = 'owner' LIMIT 1")[0] as { id: number }).id;
let t = Date.parse('2026-10-01T05:00:00.000Z');
const ctx = makeCtx(db, owner, () => new Date((t += 1)).toISOString());
const products = all<{ id: number }>(db, 'SELECT id FROM products ORDER BY id').map((p) => p.id);
const customers = all<{ id: number }>(db, 'SELECT id FROM customers ORDER BY id').map((c) => c.id);
const cat = (all<{ id: number }>(db, 'SELECT id FROM expense_categories LIMIT 1')[0] as { id: number }).id;
const today = '2026-10-01';

for (let n = 1; ; n++) {
  const p = products[n % products.length] as number;
  const c = customers[n % customers.length] as number;
  postSale(ctx, { customerId: c, date: today, lines: [{ productId: p, qty: 1 + (n % 3) }, { productId: products[(n + 1) % products.length] as number, qty: 1 }], paid: (n % 4) * 1000, approvedBy: owner });
  if (n % 3 === 0) postPayment(ctx, { partyKind: 'customer', partyId: c, amount: 500, date: today });
  if (n % 5 === 0) postExpense(ctx, { categoryId: cat, amount: 100, date: today, payee: 'x', note: '' });
  process.stdout.write(`${n}\n`);
}
