# Changelog

All notable changes to PetraDMS. The newest version is first. The installer's release notes are taken from the section
for its version, so every release needs a section here.

## [1.2.2] - 2026-10-25

### Added
- **Set a box straight from a purchase.** Each purchase row's unit list has **+ Set box…**: type how many pieces are in one box (and, if you like, the box retail and wholesale price). The box is saved on the product, the row switches to boxes, and a cost already typed per piece becomes the cost of one box. A product with no default unit yet gets this box as its default for selling and buying. Rows added with **Add many products** have the same choice. Managers and the owner only; no database migration.

## [1.2.1] - 2026-10-25

Easier box + pieces, a way to start fresh, panels that fit every screen, a categories and brands list, and adding a customer from the sale screen. No database migration: every product, stock figure, invoice, due and payment opens unchanged.

### Added
- **Add a customer from the sale screen.** A visible **+ Add customer** button next to the customer button opens a short form (name, phone, address, area, price type). The customer is saved and put on the sale at once; the cart and typed prices are kept, untouched lines are re-priced for the customer's type. Staff can add retail customers only; a manager or the owner can also choose wholesale or dealer.
- **Categories and brands tab** on the Products page (managers and the owner): every category and brand with how many products use it, add, rename, archive and restore.
- **Start fresh (Backup page, Owner only).** Deletes the whole shop and opens the first-time setup, as on a new computer. The owner chooses first: **make a backup before deleting** (the default; it is listed as "Before starting fresh" and can be restored), or **delete without a backup**, optionally also clearing the old backups, exports and saved invoices on this computer. DELETE must be typed. The second backup folder of the old shop is forgotten, so damage recovery can never bring the old shop back into the new one. Files in that second folder itself (a USB drive, say) are not touched.
- **Simpler box setup in the product editor.** A **Sold by the box** switch with **pcs in 1 box**, box retail and box wholesale price right on the form, and `1 Box = 12 pcs` shown as you type. A box added this way also becomes the default unit for selling and buying (changeable below). Dozens, cartons, dealer prices and box barcodes are under **More packs**.
- **Total pieces beside every box quantity.** The sale line at the counter shows `= 29 pcs` under the box and piece fields; the invoice drawer and the printed invoice (A4 and thermal) show `2 Box + 5 pcs (29 pcs total)`. In the invoice drawer a box line and its loose pieces are now one row, as at the counter and on the printout.
- **Stock adjustments in boxes and pieces.** For a product with a box, the adjustment form has a Boxes field (and a pack choice when there are several) beside Pieces, with the total shown before saving. Products without a box are unchanged.
- The product editor shows `1 Box = 12 pcs` under each pack size, and the size column reads "pcs in one pack".

### Fixed
- **Panels and dialogs fit the window.** Footer buttons (Print, Save as PDF, Return, Edit, Void and others) wrap onto a second line instead of being cut off on the left, and the invoice, purchase, customer, supplier, salary sheet and activity log panels are wider. A layout audit (`PETRA_LAYOUT_AUDIT=1 pnpm exec playwright test e2e/layout-audit.spec.ts`) opens every page, tab, row panel and add panel, the sale cart, the customer form, the return dialog and the product editor, in Bangla and English, at 1280x720 (a 1920x1080 screen at 150% Windows scaling) and 1920x1080, and fails if anything is cut off, off-screen, or makes a panel scroll sideways. It is opt-in, so it never blocks the Windows build.
- **The product panel cut off the pack size on the right.** The panel was 520 px wide and the 7-column pack table ran past its edge, so the "pcs in pack" field could not be reached. The product panel is now up to 900 px wide, and the pack table scrolls inside it on a small screen.

### Changed
- **A pack's size is locked once a sale or purchase has used it** (new message `PACK_SIZE_LOCKED`). Changing 12 to 24 on a used box would have made an edit of an old invoice, and the company's last box cost, read old boxes at the new size. Prices and names can still change; a new box size is added as a new pack (for example "Box 24"). Sizes can still be corrected freely before first use.

## [1.2.0] - 2026-10-14

Bulk product actions, DSR funds, a new colour palette and sign-in screen, licensing removed, and protection against posting any document twice.

### Changed (sign-in screen and branding)
- New PETRA midnight-glass sign-in: navy flowing-ribbon backdrop (inline SVG/CSS, offline), frosted centred panel, the official PETRA logo (bundled locally), cyan-to-turquoise primary button. All sign-in behaviour is unchanged (user choice, PIN keypad and keyboard, password, lockout, owner recovery, language switch).
- The product footer now shows two lines, `PetraDMS` and `Made by Petra`, with no version. The real version stays in package.json, the installer, About and Support.

### Fixed (double posting, stage 3)
- **A double click, a double Enter or a retry can no longer post a sale, a purchase, a return or a stock adjustment twice.** Until now only expenses and payments had this protection. The sale (Save), purchase (Save / F9 / Ctrl+S), sale return, purchase return and stock adjustment screens now send a request id that stays the same until the document is saved, and the database posts at most once per id: sending it again returns the first record and moves no stock, due or cash. The screens also ignore a second click while the first save is still running. This matters most for returns and adjustments, where a second click used to give back or write off the goods twice. No database migration (the table from 0003 is reused).

### Added
- **Bulk actions on the Products page.** Managers and the owner can tick many products (or all products in the current search and category, with the header box; Shift-click ticks a range) and then **Archive**, **Restore** or **Delete permanently** them in one go, up to 2,000 at a time. Everything is one transaction, all or nothing, with one audit entry per action. The shared table gained optional row selection; other pages are unchanged.
- **Permanent delete, with safeguards.** Only a product that nothing refers to can be deleted (no sales, purchases, returns, stock or opening stock, batches or adjustments); its packs, barcodes and company links go with it and its SKU and barcodes become free again. A product with history is archived instead, and the confirmation shows beforehand how many can and cannot be deleted, and why. DELETE must be typed.
- No database migration and no change to the single-product Archive button.

### Added (DSR, stage 2)
- **Funds.** A new **Funds** tab on the Money page lets the Owner add a fund such as DSR. A fund is a label on cash movements, not a second ledger: the money stays in the accounts and is counted once. An expense can be classified to a fund (`fundId` on `exp:save`; the picker on the expense form comes with the DSR expense stage), a void reverses inside the same fund, and a movement can never change fund afterwards (a database trigger). The cash book shows a Fund column once a movement has one. Existing movements are untouched (no fund). Migration 0004 is additive.
- **Integrity check I13:** a reversal sits in the same fund as the row it reverses, and only expenses may carry a fund.

### Fixed
- **Side panels (Add product, Add customer, Add supplier and the other editors) now start their text on the left.** The panel's outer layer carries the class `right` (it sits on the right edge), and a global rule `.right { text-align: right }` leaked into every label, hint and paragraph inside. The panel now sets `text-align: start`.
- **Panels and dialogs now open above the top bar and the calculator/games handle.** They were drawn inside the page, so the top bar (Help, language, account) showed on top of the panel's title row. Modal and Drawer are now rendered on the page body.
- **A double click or a retry can no longer post an expense or a payment twice.** Expense, customer receipt, supplier payment and employee salary/advance forms now send a request id that stays the same until the form is saved; sending it again returns the first record and posts nothing new. The employee pay form was also missing its "busy" guard against double clicks. Voids were already applied once; the database now refuses a second reversal of any stock, ledger or cash row. Migration 0003 is additive (a small table and three indexes).

### Changed
- **New colour palette across the whole app.** Deep Navy `#0F172A` is the primary colour (buttons, sidebar, headings), Teal `#14B8A6` marks what you can use or have selected (tabs, switches, selected rows, charts, focus), Gold `#D4AF37` is the highlight (current menu item, stat cards, demo banner, logo), and Light Gray `#F1F5F9` is the page background. Cards and fields are white. Red now means danger only: errors, delete, and money that is owed.
- Invoices, receipts and printed reports follow the palette (navy text and table header, teal rule under the shop name). The app icon, window background and the games in the dock use it too.
- **Animated 3D sign-in screen.** The PIN/password screen now has a moving 3D backdrop: a perspective grid running toward you, slowly turning glass cubes in teal and gold, and soft glows. The mouse tilts the scene slightly. It follows the Animations setting (Reduced and Off keep a still picture), is thinner on a slow GPU (Lite) and is hidden in High contrast mode.
- Text on teal or gold is always navy, and teal used as text is a darker teal, because white on teal is only 2.5:1. A new test (`palette.test.ts`) keeps every text and border pair at WCAG AA.

### Removed
- Licensing. There is no trial, licence key, machine code or read-only lock any more, and the Licence tab and banner are gone. Settings now has a **Security** tab that holds Change PIN/password.
- The vendor tool `pnpm keygen` and `docs/LICENSING.md`.
- No database migration. Existing data opens unchanged; an old shop that was read-only because its trial ended is writable again.

## [1.1.1] - 2026-10-08

A look-and-feel release: lighter type, a softer 3D design, the right names, and a utility dock. No change to how sales, purchases, stock or money are recorded, and no database change.

### Names
- The footer now reads "PetraDMS · v1.1.1" with "Made by Petra" under it (Bangla: "প্রস্তুতকারক: Petra"). PetraDMS is the product, Petra the company. The shop's own name and logo stay at the top.

### Type
- English in Nunito, Bangla in Tiro Bangla, figures in JetBrains Mono; no heavy bold anywhere, and Bangla is never drawn in a fake bold.
- Bangla text is a little larger with more line spacing, so small table and input text stays readable. Printed invoices and PDFs use the same fonts.
- Three unused fonts were removed: the app's font files are 60 % smaller.

### Look
- Rounded cards with soft layered shadows, gentle entry and hover lift; smoother dialogs, tabs, switches, tables and toasts.
- One clear button hierarchy on every screen: a raised red primary action, neutral secondary, red-outline danger, and quiet tertiary buttons.
- The dashboard's quick actions are equal tiles, with New sale as the one primary action.
- Animations Full, Reduced (fades only) and Off (none) are respected everywhere, as is the Windows "reduce motion" setting; a slow PC gets flatter shadows.

### Utility dock
- A slim bar on the right edge of every screen with a **Calculator** (Alt+C) and **Games** (Alt+G).
- The calculator handles whole sums with brackets and %, uses exact decimals (0.1 + 0.2 = 0.3), keeps the last five results and copies the answer. It never types into a field by itself.
- 2048, Snake and Memory for a short break. They pause on their own and work offline.
- The panel can be dragged, remembers where it was, stays under dialogs, is never printed, and never takes the keyboard from the field you are typing in.
- The Owner can hide the games or the whole dock in Settings, Language and look.

### Quality
- Unit tests for the calculator (decimals, brackets, percent, bad input) and the game rules, plus end-to-end tests for the dock in both languages, the settings and roles, Animations Off, and font and weight checks on every screen.

## [1.1.0] - 2026-10-08

Built for FMCG distributors who buy by the company invoice and sell by the box and the piece.

### Companies and their products
- Each supplier (company) has a **Products** tab: link products one by one or a whole brand, with the usual pack and last cost per box remembered. A product bought from a company is linked automatically.

### Bulk purchase entry
- A new purchase opens every product of the chosen company in a grid, in boxes and pieces, with the last cost filled in; "Only rows with a quantity" narrows it to the invoice.
- Keyboard first: Enter moves along a row and on to the next, the arrow keys move up and down, Ctrl+S saves.
- **Add many products** at once, and **Paste from Excel** with column matching and per-row problems.
- Company invoice number, invoice date and pay-by date; a warning (and a reason) before the same company invoice is entered twice.
- Line discount (percent or amount), bill discount, freight and optional VAT shared over the lines by value; free boxes and pieces at no cost.
- Unsaved purchases are kept as a draft; after saving, a selling-price update with margins and a printable goods received note (GRN).

### Box + pcs everywhere
- Products have their default sale and purchase units, box prices and a box barcode; **Add box** in the product editor.
- At the counter a line can be boxes plus pieces, each with its own price; type `2b5` for 2 boxes and 5 pieces; scanning a box barcode adds a box.
- Returns, stock ("12 Box 5 pcs"), reports, exports and printed invoices show boxes and pieces.
- CSV import: box size, box prices, units, supplying company and opening stock in boxes and pieces for products; a new **Company invoices** import.

### Look and branding
- The shop's name at the top of every screen and printout, "Powered by Petra DMS" and the version at the bottom, and an optional logo on invoices.
- New bundled fonts (Plus Jakarta Sans, Hind Siliguri, Fraunces, Noto Serif Bengali, JetBrains Mono), also embedded in PDFs; no font is downloaded.

### Data safety
- Database migration 2 runs after the automatic pre-migration backup; a version 1.0 database upgrades with every figure unchanged.
- Two new integrity checks (I11 box + pcs quantities and free lines, I12 company links and default units), and the purchase total check now includes VAT and freight.
- A purchase that already has returns cannot be voided until its returns are voided.

### Quality
- 257 unit tests (including property tests for the new purchase paths) and 43 end-to-end tests.
- A 60-line company invoice saves in about 13 ms (95th percentile); a 500-product grid opens in about half a second and stays smooth at 1366x768.

## [1.0.0] - 2026-10-07

First commercial release: PetraDMS, an offline distribution management system for FMCG shops and wholesalers in Bangladesh.

### What it does
- Sales and invoicing (keyboard-first POS, discounts, bonus lines, price tiers, returns, voids, A4/thermal/PDF printing)
- Purchases, suppliers, stock with batches and expiry, adjustments
- Customer and supplier dues and payments, expenses, employees and salary, cash and bank accounts, day closing
- Dashboard and 17 reports with print, PDF, CSV and Excel export
- Bangla and English, Simple and Full mode, search (Ctrl+K), calculator, barcode scanner and label printing
- Backup and restore (automatic, second folder, recovery from a damaged file), CSV import, export everything, demo mode
- Offline licence: 30-day trial, then a signed licence file tied to the computer (see docs/LICENSING.md)

### Windows installer
- Per-user install, no administrator rights; Start Menu and Desktop shortcuts; uninstall never deletes business data
- Business data is kept outside the program folder (`%LOCALAPPDATA%\PetraDMS` unless the owner chooses another folder),
  so installing a newer version keeps every record, setting and the licence state
- The installer is not code-signed, so Windows SmartScreen may warn on first run (More info, Run anyway)

### Quality
- 200+ unit tests, 33 end-to-end tests driving the real app, performance asserted on 10,000 products and 1,000,000 stock movements
- The release pipeline installs the packaged app, runs it offline, upgrades it over a previous version and uninstalls it
