# Installing PetraDMS

For Windows 10 and 11, 64-bit. No internet is needed after the file is downloaded.

## Install

1. Download `PetraDMS-Setup-<version>.exe` (from the GitHub **Releases** page, or from the **PetraDMS-Windows-x64** artifact of a **Windows Release** or **CI** run on the **Actions** page; unzip the artifact first).
2. Optional check: open PowerShell and run `Get-FileHash .\PetraDMS-Setup-<version>.exe -Algorithm SHA256`. The value must equal the one in `SHA256SUMS.txt`.
3. Double-click the installer. It installs for your Windows user only and does not ask for administrator rights. You can choose the folder.
4. **Windows protected your PC** (SmartScreen) appears because the installer is not code-signed. Click **More info**, then **Run anyway**.
5. Finish. A Desktop and Start-menu shortcut named PetraDMS are made.

## First run

1. Choose Bangla or English.
2. Enter the business name and phone.
3. Create the Owner account with a PIN (4 to 6 digits) or a password.
4. Keep the suggested data folder, or pick another (a second internal disk is a good choice, never a USB stick).
5. Choose Simple (6 menu items) or Full (12). You can change it later.
6. **Print or write down the recovery code and keep it away from the computer.** It is the only way back in if the PIN is forgotten.
7. Press Finish. A short tour is offered. To look around with sample data first, open Settings, then Data, then Demo.

## Where things are

- Data: the folder chosen in step 4, `data\petra.db`. Backups, invoices (PDF) and exports are next to it. See **Backup** inside the app.
- Updating: run the newer installer over the old one. Data is kept, and a safety backup is made before any database upgrade.
- Removing: Windows Settings, Apps, PetraDMS. The data folder is never deleted by the uninstaller, and it tells you where your data stayed.

## Moving to another computer

Back up (Backup page, copy the `.petrabak` file), install PetraDMS on the new computer, and use **Backup, Restore** on a fresh install.

## If something goes wrong

Open **Backup, Support, Export diagnostics** and send the ZIP (it contains no customer or price data). If the database file is damaged, PetraDMS restores the newest good backup by itself at the next start and says so.
