# Building and releasing the Windows installer

Everything runs in GitHub Actions. You do not need a Windows computer, Node.js or any tool installed to get an installer.

## Get an installer (manual run)

1. Open the repository on GitHub, **Actions**.
2. In the left list choose **Windows Release**.
3. Press **Run workflow**, keep branch `main`, press the green **Run workflow** button.
4. Wait for the run to finish (about 20 to 30 minutes). Every step must be green.
5. Open the finished run, scroll to **Artifacts**, and download **PetraDMS-Windows-x64**. Unzip it. It contains:
   - `PetraDMS-Setup-<version>.exe`, the installer
   - `SHA256SUMS.txt`, the checksum of the installer
   - `VERSION.txt`, version, commit, build time, signature state
   - `RELEASE-NOTES.md`, the notes for this version

The **CI** workflow (runs on every push to `main` and on pull requests) builds the same artifact, so the latest CI run also has one.

## Safety net: a quick installer without the tests

If **Windows Release** fails on something unrelated to the program itself (for example a flaky Windows test), choose **Windows Installer (quick, no tests)** in the same **Actions** list and press **Run workflow**. It only builds `PetraDMS-Setup-<version>.exe` (artifact **PetraDMS-Windows-x64-quick**, with a checksum, about 10 minutes). It runs no tests and no install check, so install it on a Windows computer and try a sale, a purchase and a backup by hand before it goes to a customer. Use the full **Windows Release** for anything you hand over whenever it is green.

## Publish a release (public download page)

1. Set the new version in `apps/desktop/package.json` (for example `1.0.1`).
2. Add a section `## [1.0.1] - YYYY-MM-DD` at the top of `CHANGELOG.md`. Its text becomes the release notes.
3. Commit and push to `main`, and wait for CI to turn green.
4. Tag and push the tag:
   ```bash
   git tag v1.0.1 && git push origin v1.0.1
   ```
5. The **Windows Release** workflow starts by itself. It stops immediately if the tag does not equal the version in `apps/desktop/package.json`, or if `CHANGELOG.md` has no section for it. When it finishes, the installer, checksum and notes are on the repository's **Releases** page.

## What the pipeline checks before it produces an installer

**Checks** (Ubuntu): typecheck, lint, unit tests, ledger integrity self-test, build, and the end-to-end tests that drive the real Electron app. **Checks** also run the end-to-end tests on Windows.

**Windows build** then:

1. builds the NSIS installer for Windows x64 (electron-builder);
2. checks the package: application archive, database migrations, icon, installer size, no development files;
3. installs it silently and checks the program's metadata (product PetraDMS, publisher Petra, version), the Start Menu and Desktop shortcuts, and that the install is per-user (no administrator rights, no machine-wide registration);
4. starts the installed program: a fresh shop opens (SQLite in WAL mode, every table, integrity check, empty), and the released version-1 database opens with every row;
5. confirms the program makes no network request and that an outside `fetch` fails;
6. first run in the default data folder (`%LOCALAPPDATA%\PetraDMS`): the shop is created there and nothing is written inside the install folder; sets up a shop, enters a customer, supplier, product, purchase, sale and expense, closes and reopens it;
7. builds a second, newer version and installs it over the first: every record, the stock and the settings are still there;
8. uninstalls silently: the program is removed, the shop's data folder is not;
9. records the signature state, and uploads the artifact.

The same script runs on your own computer with `pnpm verify:package`. On Linux and macOS the installer itself cannot be built, so it checks the unpacked program from the same configuration (steps 2, 4, 5, 6 and 7); the Windows-only steps run in GitHub.

## Where customer data lives

| What | Where |
|---|---|
| The shop's database, backups, invoices, exports | `%LOCALAPPDATA%\PetraDMS` (usually `C:\Users\<name>\AppData\Local\PetraDMS`), or the folder the owner chose in the setup wizard |
| The program | `%LOCALAPPDATA%\Programs\PetraDMS` (or the folder chosen in the installer) |

The two are separate. Installing a newer version or uninstalling only touches the program; the uninstaller tells the person their data was kept. Nothing is ever written to the program folder.

## Code signing (not configured)

The installer is **not code-signed**, because no certificate has been bought. Windows SmartScreen therefore shows "Windows protected your PC" the first time someone runs it; they choose **More info**, then **Run anyway**. This is normal for unsigned installers and does not mean the file is unsafe; the checksum in `SHA256SUMS.txt` lets anyone confirm the download is intact.

To remove the warning over time, buy a code-signing certificate (an OV or EV certificate from a certificate authority) and add two **repository secrets** (Settings, Secrets and variables, Actions):

| Secret | Content |
|---|---|
| `WINDOWS_CSC_LINK` | the `.pfx` certificate file, base64-encoded (`[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))`) |
| `WINDOWS_CSC_PASSWORD` | the certificate's password |

Nothing else changes. With the secrets present the workflow signs the installer and the program, and then **fails unless the signature is valid**. Without them it builds an unsigned installer and says so in `VERSION.txt`. The certificate and its password are never in the repository.

## If a run fails

Open the failed run. The failing job shows an annotation with the last lines of the log (Windows build) or the failing test and its error (end-to-end tests). The Playwright report is uploaded as an artifact on failure. Fix, push, and run again; nothing from a failed run is published.
