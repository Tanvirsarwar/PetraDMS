# PetraDMS — Product Architecture Plan v2
## Offline Windows Distribution Management System, built to be sold

> Supersedes v1.0. Rewritten so Claude Code can build the whole product in one autonomous run, checked by machine-verifiable gates, and so the result is something a real FMCG distributor in Bangladesh will pay for.

---

# 0. How to use this plan

1. Put this file and the existing `index.html` prototype in an empty repo.
2. Start Claude Code and paste the prompt from **§19**.
3. Claude works through phases 1–12 (**§16**). A phase is finished only when its gate command exits 0.

**Honest expectations.** One reply cannot hold a 20k-line product, so "one go" means one long autonomous session that can resume from `docs/STATE.md` if its context resets. Plan for: one long run, one or two short fix rounds, then a pilot at 2–3 real shops before the first sale (**§18**).

**The prototype.** `index.html` is the visual reference and the source of demo data (Rahman Store, Marks Milk Powder 500g, ৳ prices). Its layout, tokens and copy are reused. Its code is not ported.

---

# 1. What changed from v1

| Topic | v1 | v2 | Why |
|---|---|---|---|
| Runtime | Tauri 2 + Rust | **Electron + React + TypeScript** | One language, no Rust/MSVC toolchain, printing and PDF built in, Playwright can drive it, and the same packaging pipeline already works for PetraPMS (GitHub Actions `windows-latest` + electron-builder NSIS). Cost: installer around 100 MB. |
| DB access | SQLx | **`node:sqlite` + hand-written SQL** | No native addon, so CI and cross-builds never break on a binary. |
| Build method | "Never build everything at once" | **One autonomous run, 12 gated phases, riskiest part first** | Phase 1 proves a packaged `.exe` before any feature exists. |
| Purchases, Suppliers, Audit, Day closing, Barcode | V1.5 | **V1** | The core flow (purchase → stock → sale → COGS → profit) cannot exist without them. Audit is painful to retrofit. |
| Money, quantity, costing | Not defined | **Integer poisha, integer base units, weighted-average cost** | Prevents rounding drift and unexplainable profit. |
| FMCG essentials | Missing | **Expiry/batch, bonus goods, returns, due aging, collection sheet by area** | These decide whether a distributor adopts it. |
| UI | Static description | **Motion system, Lite mode, Simple/Full mode** | Animated but never slow, easy for untrained staff. |
| Power cuts | Not considered | **Durable DB writes, autosaved drafts, auto-recovery** | Load-shedding is routine. |
| Selling it | Not covered | **Offline licence, trial, read-only expiry, diagnostics export, manual** | A product needs a way to be sold and supported. |
| Calculator shortcut | `Ctrl+Space` | **`F7`** | `Ctrl+Space` can clash with Bangla input tools such as Avro Keyboard. |
| Roles | Admin / Manager / Staff | **Owner / Manager / Staff**, staff cannot see cost or profit | Owners will not adopt it if staff can see margins. |

---

# 2. Positioning

**Customer.** Small and medium FMCG distributors and wholesalers (powder milk, tea, noodles, biscuits, grocery). 1–10 staff, one shop or godown, one PC or laptop, Windows 10, 4 GB RAM, power cuts, often a 1366×768 screen.

**Buyer and user.** The owner buys. Staff with little computer experience operate it daily.

**Promise.** *"Every evening you know your stock, your dues and your real profit, with no internet."*

**Why they pay.**
- It replaces the paper khata and Excel.
- Profit is correct after discounts and bonus goods.
- Dues are listed by area, with aging, ready for collection.
- Expiry alerts prevent dead stock.
- Day closing catches cash mismatches.

---

# 3. Locked decisions (do not revisit during the build)

| Area | Decision |
|---|---|
| Target OS | Windows 10 1809+ and Windows 11, x64. Windows 7/8 are not supported. |
| Runtime | Electron, latest stable at build time, version pinned. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Single-instance lock. |
| UI | React 19, TypeScript, Vite, Tailwind CSS, React Router, Zustand, zod. |
| Motion | `motion` (Framer Motion) for layout and presence animation, CSS for everything else. |
| Database | `node:sqlite`. `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`. Phase 1 must verify it works inside the packaged app. |
| IPC | Typed contract in `packages/core`. zod validation on both sides. The renderer has no Node access. |
| Money | `INTEGER` poisha (1 ৳ = 100 poisha). Never floats. |
| Quantity | `INTEGER` in the product's base unit. |
| Dates | Timestamps in UTC ISO text. A separate `business_date` (local date) on every posting. |
| IDs | `INTEGER` primary keys plus a `uuid` column on every table, for future sync. |
| Search | In-memory trigram + typo-tolerant index in the main process, rebuilt on write. Does not depend on SQLite FTS. |
| PDF / print | Electron `printToPDF` and `webContents.print` from HTML/CSS templates. |
| Excel export | `exceljs`. CSV built in. |
| Barcode | USB scanners as keyboard input. Labels with `jsbarcode`. |
| Charts | Hand-written SVG components (small, animatable, offline). |
| Fonts | Bundled locally. No CDN. |
| Tests | Vitest, `fast-check` (property tests), Playwright for Electron. |
| Package manager | pnpm. |
| Installer | electron-builder NSIS, per-user install by default (no admin prompt). |
| CI | GitHub Actions. Ubuntu runs tests under xvfb. `windows-latest` builds the installer and smoke-launches it. |
| Minimum screen | 1366×768 must be fully usable. |
| Network | The app makes **zero** network requests. A test asserts this. |

---

# 4. Scope

## 4.1 In V1 (all of it ships in the first build)

- Setup wizard, settings, Owner/Manager/Staff accounts, recovery code
- Products, categories, brands, multi-level packaging, price tiers (retail / wholesale / dealer)
- Suppliers, purchases, supplier ledger and payments, purchase returns
- Stock engine: movements, ledger, adjustments, damage and expiry write-off, opening stock, batches and expiry (FEFO)
- Customers (with area, credit limit, default discount), customer ledger, payments, due aging, collection sheet by area
- Sales POS screen: discount (percent or fixed), bonus goods, partial payment, draft autosave, sales return, void
- Invoice and receipt printing: A4, 80 mm and 58 mm thermal, save as PDF
- Expenses, employees, salary sheet, advances, money accounts (cash, bank, bKash, Nagad), cash book, day closing
- Profit and margin engine
- Dashboard, reports, export to PDF / CSV / XLSX
- Global search, keyboard shortcuts, calculator, compact mode
- Backup, restore, migrations, audit log, diagnostics export
- CSV import (products, customers, opening dues), demo-data mode, onboarding tour
- Bangla and English UI, complete
- Offline licence and trial
- Petra Break mini game (last, optional, off the critical path)

## 4.2 Explicitly out of V1

Multi-user over a network, cloud sync, mobile app, SMS and WhatsApp, NBR/Mushak e-invoicing, salesman/route/van/territory features, double-entry general ledger, online updates, cash-drawer pulse, ESC/POS raw printing. Anything not listed in §4.1 is out. Claude must not add scope.

---

# 5. Domain rules (the heart of the product)

These rules live in `packages/core` as pure TypeScript with no Electron or DB imports, so tests can hammer them directly.

## 5.1 Money
- Stored as integer poisha. Displayed as `৳` with **lakh grouping** (`৳1,00,000`) by default; international grouping is a setting. Bangla digits (`০-৯`) are a setting.
- Each invoice line amount is rounded **once**, half-up.
- Percentage discount is computed on the line subtotal, then rounded.
- An invoice-level discount is split across lines in proportion, and the remainder goes to the last line, so the sum of lines equals the total exactly.
- Optional round-off to the nearest ৳1 is stored in its own `round_off` field.
- Tax (VAT) is optional, off by default, a single percentage per invoice.

## 5.2 Units and packaging
- Every product has one **base unit** (the smallest sellable thing: piece, packet, gram).
- Pack levels are defined as `level_name`, `factor_to_base`. Example: Big Box = 24, Small Box = 12, Piece = 1.
- A sale or purchase line stores: the level used, the quantity at that level, the factor snapshot, and `base_qty`. Later edits to packaging never change old documents.
- Loose goods (rice, sugar) use gram as the base unit and show kg.
- Stock is displayed by greedy decomposition from the largest level, for example `12 Big Box, 7 Small Box, 18 Piece`.

## 5.3 Stock engine
- `stock_movements` is **append-only**. Columns include: `product_id`, `batch_id`, `business_date`, `kind`, `base_qty` (signed), `value` (signed poisha), `ref_type`, `ref_id`, `user_id`, `note`.
- `products.stock_qty` and `products.stock_value` are caches, updated in the **same transaction** as the movement.
- Negative stock is blocked by default. The Owner can allow it with a warning.
- Kinds: `opening`, `purchase`, `sale`, `bonus`, `sales_return`, `purchase_return`, `damage`, `expired`, `internal_use`, `adjust_in`, `adjust_out`, `void_reversal`.

## 5.4 Costing: weighted average, integer-exact
Track `stock_qty` and `stock_value` per product.
- **In** (purchase): `stock_qty += q`, `stock_value += line_cost`.
- **Out** (sale): `cogs = round(stock_value × q / stock_qty)`. Then `stock_value -= cogs`, `stock_qty -= q`.
- When `stock_qty` reaches 0, `stock_value` is forced to 0 and any remainder goes into that sale's COGS.
- A sales return restores stock at the **original line's COGS**.
- A purchase return removes stock at current average cost. Any price difference is booked to COGS.
- Bonus goods carry price 0 and their cost goes to COGS.
- Damage and expiry write-offs go to a "Stock loss" expense line so net profit stays honest.

## 5.5 Batches and expiry (per-product switch `track_expiry`)
- A purchase line may carry `batch_no` and `expiry_date`.
- Sales consume stock **earliest-expiry-first**. The cashier can override.
- Batches only drive expiry and availability. Cost stays weighted average at product level.
- The dashboard shows "Expiring in 30 / 60 / 90 days" and "Expired in stock".

## 5.6 Ledgers (customers, suppliers, employees)
- One append-only `party_ledger`: `party_kind`, `party_id`, `entry_kind`, `amount` (signed), `ref_type`, `ref_id`, `business_date`.
- `entry_kind` values: `opening`, `sale`, `payment`, `return`, `adjustment`, `salary_due`, `salary_paid`, `advance`, `void_reversal`.
- Balance = sum of entries. The cached balance on the party row is updated in the same transaction.
- Payments apply to the party balance (the khata model). An optional invoice reference can be recorded.
- **Due aging** (0–30, 31–60, 61–90, 90+) is computed by applying payments to the oldest invoices first. This is a report-time calculation and changes no data.
- The invoice footer shows: previous due, this invoice, paid, total due.
- Credit limit: warn or block (setting).

## 5.7 Returns, voids and edits
- A sales return references the original invoice lines and restocks at original COGS. Refund is either a due reduction or a cash-out.
- **Nothing is deleted or overwritten.** A void creates reversal entries and sets `status='void'` with a mandatory reason.
- "Edit invoice" (Owner/Manager, open day only) is one atomic transaction: reverse, repost, same invoice number, `revision` +1. The old revision snapshot goes to the audit log.
- Master data (products, customers) is archived, never deleted, once it has history.

## 5.8 Business date and day closing
- `business_date` is separate from the clock, so a shop open past midnight stays on one business day.
- **Close Day** records opening cash, collections, expenses, expected cash, actual cash and the difference. Postings dated on or before a closed day are rejected. The Owner can reopen with a reason.

## 5.9 Numbering
- Per-document sequences (`INV`, `PUR`, `RCT`, `PAY`, `EXP`) in a counter table, incremented atomically inside the posting transaction. Prefix and zero-padding are settings.

## 5.10 Money accounts and cash book
- Accounts: Cash in hand, Bank, bKash, Nagad, Other (configurable).
- `cash_transactions` records every receipt and payment with account, direction, source and reference.
- Cash book and expected-cash figures come only from this table.

## 5.11 Profit definitions (written down so every report agrees)
```text
Net Sales       = invoice totals − returns − voids, before tax
Gross Profit    = Net Sales − COGS (bonus goods included)
Operating Exp   = expenses + salary (by salary-sheet month) + stock loss
Net Profit      = Gross Profit − Operating Exp
Purchases       = NOT an expense (they become stock value)
Profit basis    = accrual (invoice date). Cash position = cash basis.
```

## 5.12 Salary
- "Generate salary sheet" for a month creates `salary_due` entries per employee. Payments, advances, bonuses and deductions post against the employee ledger.

---

# 6. Database outline

Forward-only numbered SQL migrations in `packages/db/migrations`. Table groups and key columns:

```text
Identity      users(role, pin_hash, locked_until) · app_settings · business_profile · license_state · counters
Catalog       categories · brands · products(base_unit, track_expiry, price_retail, price_wholesale, price_dealer,
              min_price, stock_qty, stock_value, reorder_level, status) · product_packs(product_id, name, factor)
              · product_barcodes
Stock         stock_movements · stock_batches(product_id, batch_no, expiry_date, qty_remaining) · stock_adjustments
Parties       customers(area, type, credit_limit, default_discount_bp, balance) · suppliers(balance)
              · party_ledger · areas
Sales         sales(status, revision, subtotal, discount, tax, round_off, total, paid, due, business_date)
              · sale_items(line_kind: normal|bonus, pack_id, factor, qty, base_qty, price, discount, cogs)
              · sale_returns · sale_return_items · sale_drafts
Purchases     purchases · purchase_items(batch_no, expiry_date, cost) · purchase_returns
Money         money_accounts · cash_transactions · payments(party, method, reference) · day_closings
People        employees · salary_sheets · salary_lines
Spend         expense_categories · expenses
Trace         audit_log(user, action, entity, before_json, after_json, reason) · backup_log · app_log
Misc          game_scores
```

Indexes are required on every foreign key, `business_date`, `(party_kind, party_id)`, and `(product_id, business_date)` on movements.

---

# 7. Integrity invariants

`pnpm check:integrity` opens a database and asserts all of these. It exits non-zero on the first failure and prints the offending ids.

| # | Invariant |
|---|---|
| I1 | For every product, the sum of `stock_movements.base_qty` equals `products.stock_qty`. |
| I2 | For `track_expiry` products, the sum of `qty_remaining` equals `stock_qty`. |
| I3 | For every product, the sum of movement `value` equals `stock_value`. |
| I4 | For every party, the sum of ledger entries equals the cached `balance`. |
| I5 | For every sale: `total = sum(lines) − discount + tax + round_off`, and `paid + due = total`. |
| I6 | For every money account, the sum of `cash_transactions` equals its balance. |
| I7 | Every voided document nets to zero across stock, ledger and cash. |
| I8 | No posting exists with `business_date` inside a closed day unless a reopen record exists. |
| I9 | No negative stock unless the setting allows it. |
| I10 | `PRAGMA integrity_check` returns `ok`, and `PRAGMA foreign_key_check` returns nothing. |

**The key test.** A `fast-check` property test generates random sequences of purchase, sale, bonus, return, void, payment, expense and day-close operations. After every sequence, all of I1–I10 must hold. This single test is what makes a one-run build trustworthy.

---

# 8. Easy to handle: UX rules

## 8.1 Two modes
- **Simple mode** (default for Staff): six sidebar entries — Sell, Buy, Stock, People, Money, Reports — with large buttons and fewer fields.
- **Full mode** (default for Owner/Manager): the complete sidebar: Dashboard, Sales, Purchases, Inventory, Products, Customers, Suppliers, Expenses, Employees, Reports, Backup, Settings. The mode can be switched in one click.

## 8.2 Rules every screen follows
1. Plain words: *Paid, Due, Received, Given.* Never debit or credit.
2. Every common task takes at most 3 clicks from the dashboard. Dashboard quick actions: New Sale, New Purchase, Receive Payment, Add Expense, Add Product, Add Customer.
3. Keyboard-first, but every action also has a visible button.
4. No dead buttons. A control either works or is not shown.
5. Errors say what happened and what to do, never raw SQL text. Details go to the log.
6. **Undo toast (6 s)** after save, void and delete-like actions where reversal is safe.
7. Empty screens have one clear next action.
8. Confirm only irreversible or financial actions, and the confirm button repeats the action name ("Void invoice").
9. Font-size setting (Normal / Large / Extra large) and a high-contrast option.
10. Tables: search, sort, filter, date range, pagination or virtual scroll, export, print.

## 8.3 The sale screen (the screen staff live in)
```text
┌ Customer [search ▾]  Area  Due ৳2,450 ─────────────────────── Invoice INV-000103 ┐
│ Product search (F4)  [ type or scan barcode ]          │  CART                    │
│ ┌ recent / favourite products grid ───────────────┐    │  Marks Milk 500g         │
│ │ [Marks 500g] [Sylon Tea] [Noodles 12pk] ...     │    │  10 Box  × ৳520  ৳5,200  │
│ └─────────────────────────────────────────────────┘    │  Sylon Tea  5 × ৳450     │
│ Pack: [Big Box ▾]  Qty [  ]  Price [ ]  Disc [ % ▾ ]   │  + Bonus: Biscuit 2 pcs  │
│                                                        │  Subtotal  Discount      │
│                                                        │  TOTAL        ৳7,077.50  │
│                                                        │  Paid [____] Due ৳2,077  │
│                                                        │  [F8 Pay]  [F9 Save+Print]│
└────────────────────────────────────────────────────────────────────────────────┘
```
- The cart is autosaved to `sale_drafts` on every change, so a power cut loses nothing.
- Barcode scan adds the product. Stock and last price show beside each line.
- Selling below minimum price or over the credit limit asks for Manager approval, per setting.

## 8.4 Shortcut map (final)

| Key | Action |
|---|---|
| `Ctrl+K` | Global search |
| `F2` | New sale |
| `F3` | Choose customer |
| `F4` | Product search (sale screen) |
| `F5` | Receive payment |
| `F7` | Calculator |
| `F8` | Payment panel |
| `F9` | Save and print |
| `Ctrl+S` | Save |
| `Ctrl+P` | Print |
| `Ctrl+Shift+M` | Toggle compact mode |
| `Esc` | Close dialog or cancel |

A cheat-sheet opens with `?`.

## 8.5 Calculator and compact mode
- Calculator: `+ − × ÷ %`, `M+ M− MR MC`, history of the last 10 results, pastes into the focused field.
- Compact mode: the window animates down to a small always-on-top panel with Calculator, Quick Sale, Quick Payment, Today's Sales and Today's Cash. Standard window controls stay untouched.

---

# 9. Visual and motion system

## 9.1 Identity
Red, black and creamy white. JetBrains Mono for Latin letters and digits. Premium, compact, business-focused, slightly playful. Take exact hex values and component styling from the prototype `index.html`. If a value is missing, use these fallbacks: red `#C8202F`, black `#121212`, cream `#F6F1E7`.

Avoid: a blue ERP look, gradient washes, pure white everywhere, green-heavy dashboards, toy-like rounding, and one identical rounded card repeated for everything.

Define all tokens as CSS variables (colour, spacing, radius, type scale, motion).

## 9.2 Motion principle
**Motion answers an action or marks one memorable moment. It is never wallpaper.**
- One orchestrated moment: the app launch sequence.
- Everything else is a response to something the user did.
- No fade-and-slide on every section, no hover animation on every card.

```css
:root {
  --ease-out:    cubic-bezier(.2, .8, .2, 1);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --dur-press: 90ms;   /* buttons */
  --dur-quick: 160ms;  /* hover, toggles, tabs */
  --dur-base:  240ms;  /* modal, drawer, page */
  --dur-slow:  420ms;  /* count-up, chart draw */
}
```

## 9.3 Animation catalogue

| Moment | Motion | Duration |
|---|---|---|
| App launch (once per start) | Sidebar slides in, dashboard KPI cards cascade 40 ms apart, logo mark draws | ~600 ms total, skippable by any key |
| Page change | Opacity cross-fade only | 160 ms |
| Add item to cart | Row grows in, subtotal digits roll like an odometer | 240 ms |
| Save sale | Check-mark draws, an invoice **PAID / DUE** stamp lands, toast with Undo | 420 ms |
| Dashboard numbers | Count up on first load, roll on change | 420 ms |
| Charts | Line or bar draws in once per mount | 420 ms |
| Modal / drawer | Spring in, scrim fades | 240 ms |
| Button press | Scale to 0.97 | 90 ms |
| Invalid input | Short horizontal shake plus inline message | 240 ms |
| Low or expired stock | One pulse when the alert first appears, then static | 420 ms |
| Loading over 200 ms | Skeleton shimmer | loops |
| Compact mode | Window resizes with eased bounds, content cross-fades | 240 ms |
| Empty states | Subtle idle loop, CSS only | loops |

## 9.4 Performance guard (old PCs are the real target)
- Animate only `transform`, `opacity` and `clip-path`. Never animate `filter`, `backdrop-filter`, `box-shadow` or layout properties in lists.
- Settings: **Animations: Full / Reduced / Off.** The OS "reduce motion" flag is respected automatically.
- **Lite mode:** during the launch sequence the app measures frame time. If the average is above ~24 ms it switches to Reduced and shows a one-time note. Lite mode also disables the launch sequence and count-ups.
- Frame budget: 60 fps on a 4 GB dual-core machine for the sale screen, with 5,000 products loaded.

---

# 10. Language and fonts

- Full **Bangla and English** UI. Every string goes through `t()`. Dictionaries are `bn.json` and `en.json`. A test fails if any key exists in one and not the other. The language is chosen in the setup wizard and switchable at any time.
- Fonts bundled as `woff2`: **JetBrains Mono** for Latin and digits; **Noto Sans Bengali** (or Hind Siliguri) for Bangla via `unicode-range: U+0980–09FF`. True monospace Bangla does not exist, so numbers always use tabular figures and columns align on numbers.
- Products and customers have `name` plus optional `name_bn`. Search matches both.
- Phone validation for Bangladesh (`01XXXXXXXXX`). Dates `DD/MM/YYYY`.
- Invoices print in the language chosen per business, with an option for bilingual headings.

---

# 11. Printing, reports, import and export

## 11.1 Print templates
- A4 invoice, 80 mm receipt, 58 mm receipt, payment receipt, customer statement, supplier statement, every report.
- Chosen per document type in Settings; the printer is remembered; "Print silently" is a setting.
- Every print has "Save as PDF". Bangla fonts are embedded in the PDF.

## 11.2 Reports (all with date range, filters, Print / PDF / CSV / XLSX)
Daily summary · Sales (by product, customer, area, date) · Purchases · **Due aging** · **Collection sheet by area** · Customer statement · Supplier payable · Stock valuation · Low stock / reorder · **Expiring stock** · Stock ledger · Profit by product and by customer · Cash book · Day closing · Expenses · Salary.

Each report's totals must equal an independent SQL oracle in the tests.

## 11.3 Import and export
- **CSV import** for products, customers and opening dues, with a preview, column mapping, per-row errors and a dry-run. A downloadable template file is included.
- **Export everything**: a ZIP of CSVs plus a database copy, so the customer is never locked in.
- **Demo mode**: loads Bangladeshi FMCG sample data (taken from the prototype) into a separate database, with a visible banner. One click clears it.

---

# 12. Data safety

## 12.1 Storage
- Default: `%LOCALAPPDATA%\PetraDMS`. The setup wizard recommends a non-system drive (for example `D:\PetraData`), because Windows reinstalls wipe `C:`.
- Layout: `data/petra.db`, `backups/`, `exports/`, `invoices/`, `logs/`.

## 12.2 Power-cut and crash safety
WAL with `synchronous=FULL`. Every posting is one transaction. Drafts autosave. On the next start, the app runs `PRAGMA integrity_check`; if it fails, it offers to restore the newest good backup automatically.

## 12.3 Backups
- Automatic: on close, and every N minutes while there are changes.
- Created with `VACUUM INTO`, then verified with `PRAGMA integrity_check` on the copy, with a manifest (app version, schema version, SHA-256).
- Retention: 14 daily, 8 weekly, 12 monthly.
- A second backup folder can be set to a USB drive or a **Google Drive / OneDrive / Dropbox synced folder**. That gives cloud backup without building any cloud.
- Restore: validate → safety backup of the current DB → swap while the app is closed → restart. Restore is tested in CI.

## 12.4 Migrations and upgrades
Forward-only numbered SQL, run in a transaction after an automatic pre-migration backup, tracked in `schema_version`. The app refuses to open a database from a newer version. An upgrade is: run the new installer; the data migrates itself.

---

# 13. Security, roles and licensing

## 13.1 Roles

| Capability | Owner | Manager | Staff |
|---|---|---|---|
| Sell, receive payment, product lookup | ✓ | ✓ | ✓ |
| See cost price and profit | ✓ | ✓ | ✗ |
| Edit price or discount beyond limit | ✓ | ✓ | approval needed |
| Purchases, stock adjustment | ✓ | ✓ | ✗ |
| Void / edit invoice | ✓ | ✓ (open day) | ✗ |
| Reports | ✓ | ✓ | today only |
| Backup, restore, settings, users, reopen day | ✓ | ✗ | ✗ |

## 13.2 Sign-in
PIN (4–6 digits) or password, hashed with scrypt. Lockout after 5 wrong attempts. Optional idle auto-lock. At setup a **recovery code** is generated and printed. There is no cloud reset.

## 13.3 Licensing (offline)
- An Ed25519-signed licence file contains: customer, edition, machine fingerprint hash, issue date and optional expiry. The public key is embedded in the app; the private key lives only in the vendor `keygen` tool, outside this repo. Reuse the approach used in PetraPMS.
- **30-day trial** from first run. Clock-rollback detection uses a stored `last_seen_max` timestamp.
- When the trial or licence expires, the app becomes **read-only**: view, print, export and back up still work, new postings do not. Customers are never locked out of their own data.
- Licence transfer to a new PC is done by the vendor re-issuing a key.
- Realistic goal: stop casual copying, not defeat a determined cracker.

## 13.4 Privacy
The app collects nothing and sends nothing. The About screen states this. "Export diagnostics" creates a ZIP of logs and version info, with no business data, for support.

---

# 14. Performance targets

| Measure | Target |
|---|---|
| Cold start to usable | under 4 s on a 4 GB dual-core |
| Save sale | under 150 ms |
| Search keystroke to results | under 50 ms with 10,000 products and 5,000 customers |
| Report over 1M stock movements | under 2 s |
| Idle RAM | under 350 MB |

`pnpm seed:perf` generates that dataset. The numbers are asserted in the Phase 12 gate.

---

# 15. Repository structure

```text
petra-dms/
├── apps/desktop/
│   ├── electron/        main, preload, ipc, services (backup, print, license, search)
│   └── src/             renderer: app shell, features/, components/, i18n/, styles/
├── packages/
│   ├── core/            money, units, costing, posting engine, invariants (pure TS)
│   └── db/              node:sqlite adapter, migrations/, repositories
├── tools/               keygen/, seed/, check-integrity/
├── e2e/                 Playwright specs
├── docs/                STATE.md, DECISIONS.md, USER-MANUAL.bn.md, USER-MANUAL.en.md
├── .github/workflows/   ci.yml, release-windows.yml
└── README.md
```

---

# 16. Build plan: 12 gated phases

Rules for the whole run:
- Do the phases in order. A phase is done only when its gate exits 0.
- Commit at the end of every phase. After each phase, update `docs/STATE.md` (current phase, what is done, what is next, commands to resume).
- Record every non-obvious decision in `docs/DECISIONS.md`.
- No stubs, no `TODO` in shipped screens, no placeholder buttons.
- If a gate fails, fix it before moving on. Never weaken a test to pass it.

| # | Phase | Gate (must exit 0) |
|---|---|---|
| 1 | **Pipeline spike**: Electron + Vite + React shell, `node:sqlite` WAL opened inside the *packaged* app, CI builds the NSIS installer on `windows-latest`, Playwright launches the app. | CI green and installer artifact produced; `pnpm verify` runs |
| 2 | **Core and DB**: money, units, costing, posting engine, migrations, integrity checker, property tests. No UI. | `pnpm test:core` (including 1,000 random scenarios) and `pnpm check:integrity` |
| 3 | **Design system and shell**: tokens, components, sidebar/topbar, Simple/Full mode, i18n, motion system, Lite mode, window controls, style-guide route. | Playwright renders every component in bn and en at 1366×768 with no console errors |
| 4 | **First run, settings, auth, licensing, trial** | e2e fresh install; licence tests (valid, tampered, expired, wrong machine, clock rollback) |
| 5 | **Catalog and inbound**: products, packaging, categories, suppliers, purchases, stock, batches and expiry, adjustments. | e2e plus invariants I1–I3 |
| 6 | **Customers and sales**: customers, POS screen, discount, bonus, payments, returns, void, drafts, invoice print and PDF. | e2e golden-invoice test; property test with 10,000 operations passes I1–I10 |
| 7 | **Money side**: expenses, employees and salary, money accounts, cash book, day closing. | e2e plus I6 and I8 |
| 8 | **Dashboard and reports**: widgets, all reports, PDF/CSV/XLSX export, aging, collection sheet. | Every report total equals its SQL oracle |
| 9 | **Search and speed tools**: global search, shortcuts, calculator, compact mode, barcode input. | Search under 50 ms on the perf seed |
| 10 | **Safety**: backup, restore, migrations from a fixture DB, audit log, diagnostics, auto-recovery. | Kill-during-write test, restore test, old-DB migration test |
| 11 | **Onboarding**: CSV import, demo mode, tour, help, About, Bangla and English manuals. | e2e import with bad rows; i18n key parity |
| 12 | **Hardening and release**: perf targets, keyboard-only pass, error copy review, no-network test, installer, Petra Break (last, optional), final QA. | `pnpm verify:release` passes (§17) |

---

# 17. Definition of Done

`pnpm verify` runs: typecheck, lint, unit, property, integrity, e2e, build.
`pnpm verify:release` adds: installer build, a fresh-install smoke launch, an upgrade-over-old-DB test, and the no-network assertion.

V1 is done only when:

```text
✓ verify:release passes in CI on windows-latest
✓ Fresh install works with no internet
✓ Upgrade over a previous DB keeps all data
✓ Every integrity invariant I1–I10 holds after the 10,000-operation property test
✓ Sale, purchase, return, void, payment, expense, salary, day close all work end to end
✓ Invoice prints on A4, 80 mm and 58 mm, and saves as PDF with Bangla text
✓ Backup, restore and auto-recovery work
✓ Staff cannot see cost or profit anywhere (UI, reports, print, search)
✓ Trial, licence and read-only expiry behave as specified
✓ Performance targets in §14 are met on the seed dataset
✓ Every screen is usable at 1366×768, by keyboard, in Bangla and English
✓ No console errors, no dead buttons, no TODO text in the UI
```

---

# 18. Sales readiness (outside the code)

- **Pilot first.** Install at 2–3 real distributors for 2 weeks with their real data. Fix what staff trip over before selling.
- **Code signing.** An unsigned installer triggers Windows SmartScreen and some antivirus warnings, which hurts sales. Buy a code-signing certificate before the first public sale. Until then, give customers a one-page "More info → Run anyway" guide.
- **Offer.** Editions and prices are a business decision to test with the pilot shops. Suggested structure: one-PC licence with a yearly support and update plan.
- **Paper and legal.** EULA, a short privacy statement ("nothing leaves your PC"), and a support contact inside the app.
- **Training.** Bangla manual plus a 10-minute screen-recorded walkthrough for the owner and another for staff.
- **Support loop.** Customers send the diagnostics ZIP; you issue fixes as a new installer that migrates data automatically.

---

# 19. Prompt to give Claude Code

```text
You are building PetraDMS, an offline-first Windows distribution management product that will be sold to FMCG distributors in Bangladesh.

Read first, in this order: PetraDMS_Product_Architecture_Plan_v2.md (this plan, authoritative) and index.html (visual reference and demo data only; do not port its code).

Rules:
1. Follow §3 "Locked decisions" exactly. Do not substitute technologies.
2. Build phases 1 to 12 from §16 in order. A phase is complete only when its gate command exits 0. Never weaken a test to make it pass.
3. Commit at the end of each phase. After each phase update docs/STATE.md (current phase, done, next, resume commands) so the run can continue after a context reset. Log non-obvious decisions in docs/DECISIONS.md.
4. Implement the domain rules in §5 in packages/core as pure TypeScript, and the invariants in §7 as tools/check-integrity. Money is integer poisha. Quantity is integer base units. Costing is weighted average, integer-exact.
5. No stubs, no TODO text, no placeholder buttons in shipped screens. Do not add scope beyond §4.1.
6. UI must follow §8, §9 and §10: red / black / creamy white, JetBrains Mono, Bangla and English, Simple and Full mode, the motion catalogue with Lite mode, 1366x768 minimum.
7. The app must make zero network requests.
8. When finished, run pnpm verify:release, then report: what was built, test results, known gaps, and the exact commands to run and package the app.

Start with Phase 1. Do not ask questions unless blocked; record assumptions in docs/DECISIONS.md.
```
