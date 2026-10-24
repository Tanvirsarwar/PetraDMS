// Builds the performance dataset of plan section 14 as a real PetraDMS data folder you can open in the app:
//   pnpm seed:perf                      -> ./.perf-data  (10,000 products, 5,000 customers, 6,000 sales over 90 days)
//   pnpm seed:perf --out D:\perf --movements 1000000
// Then start the app with PETRA_DATA_DIR pointing at that folder; sign in as "owner" with PIN 4321.
import fs from 'node:fs';
import path from 'node:path';
import { PERF_FULL, bulkMovements, seedPerf } from '../../packages/db/src/perfSeed';
import { makeApp, ok, setupInput } from '../../packages/db/src/testApp';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

const out = path.resolve(arg('out', '.perf-data'));
const movements = Number(arg('movements', '0'));
const endDate = new Date().toISOString().slice(0, 10);
if (fs.existsSync(path.join(out, 'data', 'petra.db'))) {
  console.error(`${out} already holds a database. Choose another --out or delete it first.`);
  process.exit(1);
}
const t0 = performance.now();
const app = makeApp(undefined, { dataDir: out });
await ok(app.d, 'setup:complete', { ...setupInput, owner: { ...setupInput.owner, username: 'owner', displayName: 'Owner' } });
const ctx = app.d.ctx();
const made = seedPerf(ctx, { ...PERF_FULL, endDate });
console.log(`seeded ${made.products.length} products, ${made.customers.length} customers, ${made.suppliers.length} suppliers`);
if (movements > 0) {
  bulkMovements(ctx, movements, endDate, PERF_FULL.days);
  console.log(`added ${movements} synthetic stock movements (this folder is for timing only; integrity checks will not pass)`);
}
app.close();
console.log(`done in ${Math.round((performance.now() - t0) / 1000)} s -> ${out}`);
