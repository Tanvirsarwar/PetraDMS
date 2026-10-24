# PetraDMS 1.2.0 - handoff notes (Saleable build)

## How to get the .exe from GitHub (no tools needed)

```bash
git init -b main
git add .
git commit -m "PetraDMS 1.2.0"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

1. GitHub, **Actions**: the **CI** run starts by itself on the push. When it is green, open it and download the artifact **PetraDMS-Windows-x64** (the installer, checksum, notes).
2. Or **Actions, Windows Release, Run workflow** (same result, on demand).
3. A public download page: `git tag v1.2.0 && git push origin v1.2.0` (the tag must equal the version, 1.2.0; the CHANGELOG section exists).
4. If the full pipeline fails on a Windows-only step, **Actions, Windows Installer (quick, no tests), Run workflow** builds the .exe alone (artifact **PetraDMS-Windows-x64-quick**). Install and try it by hand before giving it to a customer.

Do not upload the folder through the GitHub web page: it drops the hidden `.github` folder. Use `git push`.

## What was audited

- Typecheck, lint, 344 unit tests, ledger integrity self-test (I1-I13), build, packaged-app check on Linux (fresh start, v1 database, offline, first run, upgrade): all pass.
- Money is whole poisha everywhere; rounding is half-up in one place per document; discounts, VAT and freight are split so parts add up to the poisha; box + pieces always convert to base pieces exactly. Only displays use floats.
- Double posting: expenses and payments were already protected. Sale, purchase, sale return, purchase return and stock adjustment were NOT (a double click on Return or on a stock adjustment gave back / wrote off twice). Fixed in 1.2.0 on both sides (request id in the database layer, and an in-flight guard on each screen). Tests: `packages/db/src/idempotency.documents.test.ts`, `e2e/double-post-documents.spec.ts`.

## Things to know before selling

- The installer is **not code-signed**: Windows SmartScreen warns on first run (More info, Run anyway). A certificate fixes it (`docs/RELEASING.md`).
- The Windows-only install / uninstall checks could not be run here (Linux); they run for the first time in GitHub Actions.
- Licensing was removed in this line (no trial, no key). Anyone with the .exe can use it.
- **Funds (DSR) is stage 2 only**: the owner can create a fund on the Money page, but the expense form has no fund picker yet, so a fund cannot be used until the next stage.
