# PetraDMS

PetraDMS is an offline distribution management program for Windows, made for FMCG shops and wholesalers in Bangladesh. It does sales and invoicing (with printing and PDF), purchases, stock with expiry, customer and supplier dues, expenses, salaries, cash and day closing, reports, backup and restore. It works in Bangla and English, needs no internet and sends nothing anywhere. Data lives in one SQLite file on the shop's own computer.

| | |
|---|---|
| Desktop shell | Electron 44, React 19, TypeScript, Vite, Tailwind |
| Data | `node:sqlite` (WAL, `synchronous=FULL`, foreign keys on), money in whole poisha, quantity in base units |
| Packages | `packages/core` (pure domain rules), `packages/db` (schema, posting engine, services), `apps/desktop` (Electron main, preload, React), `tools` |
| Installer | electron-builder, NSIS, Windows 10/11 x64, per-user install |

The full design is in [`docs/PetraDMS_Product_Architecture_Plan_v2.md`](docs/PetraDMS_Product_Architecture_Plan_v2.md). Build progress is in [`docs/STATE.md`](docs/STATE.md) and the reasons behind each choice in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Get the Windows installer (no tools needed)

1. Open the repository on GitHub, **Actions**, **Windows Release**, **Run workflow**.
2. When the run is green, open it and download the artifact **PetraDMS-Windows-x64** (a ZIP). Inside are `PetraDMS-Setup-<version>.exe`, `SHA256SUMS.txt`, `VERSION.txt` and `RELEASE-NOTES.md`.
3. Every push to `main` also builds the same artifact (Actions, **CI**). For a public download page, publish a release with `git tag vX.Y.Z && git push origin vX.Y.Z`; the installer then appears on the **Releases** page.

Full steps, what the pipeline checks, and code signing: [`docs/RELEASING.md`](docs/RELEASING.md). Installing and first use: [`docs/INSTALL.md`](docs/INSTALL.md). The installer is not code-signed, so Windows SmartScreen shows a warning the first time: choose **More info**, then **Run anyway**.

## Build and run it yourself

You need Node.js 22 and pnpm 10 (`corepack enable`). Windows, macOS or Linux all work for development; the installer itself is built on Windows.

```bash
pnpm install
pnpm dev                 # the app with live reload (Vite + Electron)
pnpm typecheck           # TypeScript, all packages
pnpm lint                # ESLint
pnpm test:unit           # Vitest: rules, posting engine, services, performance targets
pnpm check:integrity     # self-test of the ledger integrity checker
pnpm test:e2e            # builds, then Playwright drives the real Electron app
pnpm verify              # all of the above
pnpm dist:win            # Windows only: builds apps/desktop/release/PetraDMS-Setup-<version>.exe
pnpm dist:dir            # any OS: the unpacked app, same configuration, no installer
pnpm verify:release      # verify + build the package + install, first run, upgrade, offline and uninstall checks
pnpm seed:perf           # a big sample shop in ./.perf-data (10,000 products, 5,000 customers)
```

On Linux the end-to-end tests need a display: `xvfb-run -a pnpm exec playwright test`.

### What `pnpm verify:release` proves

After the whole test suite it builds the package and then checks the packaged app, not the dev build: the package contents; a fresh start (WAL, every table, integrity check, empty shop); the committed version-1 database opens with every row intact; the app makes no network request and an outside `fetch` or XHR is blocked. On Windows it also installs silently, installs again over the top (upgrade), and uninstalls, and checks that the shop's data folder survives both.

## Release (GitHub Release with the installer)

Set the version in `apps/desktop/package.json`, add its section to `CHANGELOG.md`, commit, then:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

The **Windows Release** workflow runs the tests, builds and verifies the installer, uploads the artifact `PetraDMS-Windows-x64` and creates the GitHub Release. The tag must equal the version in `apps/desktop/package.json` or the workflow stops. **Run workflow** on that workflow builds the installer without publishing a release. Code signing: add the secrets `WINDOWS_CSC_LINK` and `WINDOWS_CSC_PASSWORD` (see `docs/RELEASING.md`).

## Start a new GitHub repository from the ZIP

The ZIP holds the project root directly (`package.json`, `apps/`, `packages/`, `.github/` and so on), with no extra folder
around it. It has no `node_modules`, builds, databases of a real shop, or secrets.

**1. Create the repository.** On GitHub: **+**, **New repository**, a name (for example `PetraDMS`), Private or Public,
and leave **Add a README**, **.gitignore** and **license** all unticked (the project has its own). **Create repository.**

**2. Push the code with git** (do not upload through the web page: it skips the hidden `.github` folder, which holds the
build workflows, and it stops at 100 files). You need [Git](https://git-scm.com/download/win) installed.

```bash
# unzip PetraDMS.zip into an empty folder, open a terminal in that folder, then:
git init -b main
git add .
git commit -m "PetraDMS 1.2.3"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Windows check before `git add`: the folder must show `package.json` and `.github` at its top (turn on **View, Hidden items**
in Explorer to see `.github`).

**3. Configure GitHub Actions.**
- **Settings, Actions, General, Actions permissions:** "Allow all actions and reusable workflows" (the default). The
  workflows use only GitHub's own actions plus `pnpm/action-setup`.
- **Settings, Actions, General, Workflow permissions:** the default ("Read repository contents") is enough to build the
  `.exe`. To publish a GitHub Release from a version tag, choose "Read and write permissions".
- **Secrets: none are required.** `GITHUB_TOKEN` is provided automatically. Optional, only for a code-signed installer
  (Settings, Secrets and variables, Actions, New repository secret):
  - `WINDOWS_CSC_LINK`: your `.pfx` code-signing certificate, base64-encoded (`certutil -encode cert.pfx cert.b64`, then
    paste the text between the BEGIN and END lines).
  - `WINDOWS_CSC_PASSWORD`: the certificate's password.

  Without them the installer is unsigned and Windows SmartScreen warns once (More info, Run anyway).
- No environment variables need setting; the workflows set their own. Node.js 22 and pnpm 10.28.0 (from
  `packageManager` in `package.json`) are installed by the workflow.

**4. Run the workflow.** The push in step 2 already starts **CI** (Actions tab). To build on demand: **Actions**,
**Windows Release**, **Run workflow**, branch `main`, **Run workflow**. It runs typecheck, lint, unit, integrity and
end-to-end tests on Ubuntu and Windows, then builds the NSIS installer on `windows-latest` with
`pnpm verify:package` (`electron-builder --win nsis --x64`), installs it, starts it, upgrades and uninstalls it.
The full run takes a while (tens of minutes). **Windows Installer (quick, no tests)** builds only the `.exe`, much
faster; test that one by hand before giving it to a customer.

**5. Download the `.exe`.** Open the green run, scroll to **Artifacts**, download **PetraDMS-Windows-x64** (from CI or
Windows Release) or **PetraDMS-Windows-x64-quick**. Unzip it: inside are `PetraDMS-Setup-1.2.3.exe`, `SHA256SUMS.txt`,
`VERSION.txt` and `RELEASE-NOTES.md`. Artifacts are kept for 30 days.

**Optional, public download page:** with "Read and write permissions" set, run `git tag v1.2.3 && git push origin v1.2.3`.
The tag must equal the version in `apps/desktop/package.json`, and `CHANGELOG.md` must have a `## [1.2.3]` section
(it does). The installer then appears under **Releases**.

## Repository map

```text
apps/desktop/    electron/ (main, preload, services)   src/ (React screens, i18n, styles)   build/ (icons)   electron-builder.yml
packages/core/   money, units, costing, invoice, aging, importer, IPC contract (zod)
packages/db/     migrations/, posting engine, integrity checker, services, fixtures/ (released-schema databases)
tools/           seed/, check-integrity/, icons/, verify-release.ts
e2e/             Playwright tests that drive the real app
docs/            plan, state, decisions, user manuals (English and Bangla), install guide
.github/workflows/  ci.yml, release-windows.yml
```
