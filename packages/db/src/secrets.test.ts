import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The vendor signing key and any code-signing certificate must never be in the repository. */
describe('no secrets in the repository', () => {
  const tracked = (() => {
    try {
      return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch {
      return null; // not a git checkout (a source ZIP): nothing to scan
    }
  })();

  it('tracks no key or certificate files', () => {
    if (!tracked) return;
    const bad = tracked.filter((f) => /\.(pem|key|pfx|p12|cer|crt|jks|keystore)$/i.test(f) || /(^|\/)(private|secrets?)\b.*\.(json|txt|env)$/i.test(f) || /(^|\/)\.env(\.|$)/.test(f));
    expect(bad).toEqual([]);
  });

  it('contains no private key text or credential-looking tokens', () => {
    if (!tracked) return;
    const hits: string[] = [];
    for (const f of tracked) {
      if (/\.(png|ico|ttf|woff2?|db|zip|pdf|petrabak|lock|yaml)$/i.test(f) || f.endsWith('pnpm-lock.yaml') || f === 'packages/db/src/secrets.test.ts') continue;
      let text: string;
      try {
        text = fs.readFileSync(path.join(root, f), 'utf8');
      } catch {
        continue;
      }
      if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text)) hits.push(`${f}: private key block`);
      if (/\bghp_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9]{32,}\b/.test(text)) hits.push(`${f}: token`);
    }
    expect(hits).toEqual([]);
  });
});
