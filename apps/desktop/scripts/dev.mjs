// Dev runner: starts Vite, builds the Electron bundles, then launches Electron against the dev server.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const server = await createServer({ root: app, configFile: path.join(app, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [path.join(app, 'scripts/build-electron.mjs')], { stdio: 'inherit' });
  p.on('exit', (c) => (c === 0 ? resolve(undefined) : reject(new Error('electron bundle failed'))));
});

const electronPath = require('electron');
const child = spawn(electronPath, [app], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
