// Bundles the Electron main + preload into dist-electron/ as CommonJS.
// Everything except `electron` and Node built-ins (including node:sqlite) is bundled,
// so the installer ships no node_modules and no native addons.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(root, '..');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  external: ['electron'],
  logLevel: 'info',
  legalComments: 'none'
};

await build({ ...common, entryPoints: [path.join(app, 'electron/main.ts')], outfile: path.join(app, 'dist-electron/main.cjs') });
await build({ ...common, entryPoints: [path.join(app, 'electron/preload.ts')], outfile: path.join(app, 'dist-electron/preload.cjs') });

// Fonts the main process embeds into printed pages and PDFs.
const require = createRequire(import.meta.url);
const fontsOut = path.join(app, 'dist-electron/fonts');
// start clean so a font that is no longer used is never shipped
fs.rmSync(fontsOut, { recursive: true, force: true });
fs.mkdirSync(fontsOut, { recursive: true });
const pick = (pkg, files) => {
  const dir = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files');
  for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(fontsOut, f));
};
pick('@fontsource/nunito', ['nunito-latin-400-normal.woff2', 'nunito-latin-600-normal.woff2']);
pick('@fontsource/tiro-bangla', ['tiro-bangla-bengali-400-normal.woff2']);
pick('@fontsource/noto-serif-bengali', ['noto-serif-bengali-bengali-400-normal.woff2']);
pick('@fontsource/jetbrains-mono', ['jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-500-normal.woff2']);
