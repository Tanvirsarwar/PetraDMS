# PetraDMS user manual

PetraDMS runs your distribution business on one Windows PC, with no internet. This manual explains each task in plain steps. Press **?** anywhere in the app to see the keyboard shortcuts.

## 1. Getting started

The first time you open PetraDMS a short wizard asks for the language, your business name and phone, the Owner's name and a PIN or password, and where to keep the data.

- Pick the language you read best. You can switch between বাংলা and English at any time from the top bar.
- Choose a PIN of at least 4 digits, or a password. Anyone can use either. A password is safer if the PC is shared.
- At the end the app shows a **recovery code**. Write it on paper and keep it safe. It is the only way to get back in if the Owner forgets the PIN. Tick the box to confirm you have kept it.
- Keep the data folder on the drive the wizard recommends, not on a USB stick.

Your business name is shown at the top of every screen and on every printout; the bottom of the menu shows the product name, PetraDMS, with its version, and "Made by Petra" under it. The Owner can add a shop **logo** in **Settings** (a PNG, JPEG or WebP picture under 256 KB); it then appears on invoices and receipts.

## 2. Signing in, roles and modes

Each person signs in with their own name and PIN. There are three roles.

- **Owner**: everything, including Settings, Backup and the activity log.
- **Manager**: everything about money and stock, but not Settings, Backup or the activity log.
- **Staff**: selling, customers, stock look-up and small tasks. Staff do not see costs, profit or cash.

If a Staff member needs something a Manager must approve (a price below the minimum, or a customer over the credit limit), a Manager or Owner types their own PIN on the spot.

There are two screen modes. **Simple** shows six big entries: Sell, Buy, Stock, People, Money, Reports. **Full** shows the complete menu. Staff start in Simple and Owner and Manager start in Full. The button at the bottom of the menu switches mode, and the app remembers your choice.

## 3. Selling

Open **Sales** and press **F2** for a new sale. The sale screen is built for speed.

1. Choose the customer with **F3**, or leave it as a walk-in customer. The customer's current due is shown.
2. Find a product with **F4**: type part of the name, the SKU or scan the barcode, then press Enter. Click a favourite product tile to add it.
3. Set the quantity. A product starts in its **Sell in** unit (for example Box). Type boxes in the quantity box and loose pieces in the Pcs box, or type **2b5** to mean 2 boxes and 5 pieces. Each part has its own price, so a box can cost less than 24 single pieces. Scanning a box's own barcode adds a whole box. Prices follow the customer's type: retail, wholesale or dealer.
4. Add a discount (a percentage or a fixed amount) if needed. For a free bonus item, add it as a line with a price of zero.
5. Type the amount paid with **F8**. Anything not paid becomes the customer's due.
6. Press **Ctrl+S** to save, or **F9** to save and print. You can print on A4 or a receipt printer, or save a PDF.

Stock is checked as you add lines. If stock is not enough, the app tells you; it will not let stock go below zero unless the Owner allows it in Settings. Products with an expiry date are taken from the earliest-expiring batch first.

A sale is saved all at once. If something goes wrong, nothing is half-saved.

## 4. Returns, voids and drafts

- **Return**: a Manager or Owner opens the invoice and chooses Return. They pick the items and quantities (in boxes and pieces, for example 1 box and 3 pieces), and say whether the money goes back in cash or reduces the customer's due. You cannot return more than was sold.
- **Void**: a mistaken invoice can be voided by a Manager or Owner, who must give a reason. A void puts back the stock and cancels the due and the payment. The invoice stays on record marked Void.
- **Draft**: if you are interrupted, the sale screen keeps your cart as a draft and offers it again.
- Nothing posted is ever deleted. A correction is always a new entry that reverses the old one, so the records stay trustworthy.
- Once a day is **closed** (section 7) its invoices can no longer be changed.

## 5. Buying and stock

- **Purchases**: press **New purchase** and choose the company. Every product linked to that company is already listed in a grid, in boxes and pieces, with the last cost per box filled in. Type only the rows on the invoice; **Only rows with a quantity** hides the rest. Enter moves along a row (Box, Pcs, Cost, Discount, Free box, Free pcs) and on to the next row; the arrow keys move up and down a column; **Ctrl+S** saves. For products that expire, enter the batch number and expiry date. Anything not paid becomes what you owe the company.
- **Company invoice details**: enter the **Company invoice no.**, the invoice date and the **Pay by** date. If the same invoice number from the same company was already entered, the app warns you and asks for a reason before saving it again. A bill discount, **Freight / extra cost** and (when switched on in Settings) VAT are shared over the paid lines by value, so each product's cost includes its part. **Free box** and **Free pcs** bring goods in at no cost.
- **Adding lines fast**: **Add many products** lets you tick several products at once. **Paste from Excel** takes rows copied from a spreadsheet: match the columns (product, box, pcs, cost per box), fix any row marked as a problem, and add the rest. The purchase is kept as a draft while you work, so nothing is lost if you are interrupted.
- **After saving**: **Update selling prices** shows the new cost of each product with your margin, and you choose which prices to change. **Open and print** prints the goods received note (GRN).
- **Suppliers** has a **Products** tab for each company: **Link products** or **Link whole brand** to choose what the company sells you. A product bought from a company is linked to it automatically.
- **Inventory** shows stock on hand in boxes and pieces (for example "12 Box 5 pcs") and its value, products that are low (below their reorder level), and batches that are near expiry or expired.
- **Adjustments**: use these for damage, expired goods, internal use, a stock count correction or opening stock. Every adjustment needs a reason, except opening stock.
- **Products**: each product has a SKU, names in English and Bangla, a category and brand, a base unit, packs (press **Add box** and type how many pieces are in it; each pack has its own prices and barcode), the units it is sold and bought in (**Sell in**, **Buy in**), three prices, a minimum price, a reorder level and barcodes. Use **Print labels** on the Products page to print shelf and barcode labels.
- **Changing many products at once**: managers and the owner see a tick box beside every product. Tick the products you want, or tick the box in the header to take every product in the current search and category (not only the page you can see). Hold **Shift** while ticking to take a whole range. A bar appears above the list with **Archive**, **Restore** (when archived products are shown), **Delete permanently** and **Clear selection**. A confirmation shows how many products are affected, and when the action is done the selection is cleared.
- **Archive or delete?** Archiving hides a product from selling but keeps all its history, and its SKU and barcodes stay reserved. **Delete permanently** removes a product for good, and is only possible for one that nothing refers to, such as a product imported by mistake: it must have no sales, purchases, returns, stock or opening stock, and no batches or adjustments. Before you confirm, the app shows how many of the selected products can be deleted and how many cannot, and why. You must type **DELETE** to go on. Products that have history are never deleted, they are archived instead, so old invoices and reports stay correct. A deleted product's SKU and barcodes become free, so the same SKU can be imported again. Up to 2,000 products can be changed in one go, and the whole action is all or nothing.
- The cost of stock is a weighted average, so profit reports are correct even when you buy at different prices.

## 6. Customers, suppliers and payments

- **Customers** hold the name, phone, area, type (retail, wholesale or dealer), credit limit and the current due. Open a customer to see the full statement: every sale, payment and return, with the running balance.
- **Receive a payment** with **F5** from anywhere. Choose the customer, the amount and the account (cash, bank, bKash or Nagad). You can apply it to a specific invoice.
- **Suppliers** work the same way for what you owe. Pay a supplier from the supplier's page.
- **Aging** (in Reports) groups customer dues by how old they are: 0 to 30, 31 to 60, 61 to 90 and over 90 days. The **collection sheet** lists who to visit, by area, with how much they owe.
- Set the **credit limit mode** in Settings: off, warn, ask for approval, or block.

## 7. Money: expenses, salary, accounts and day closing

- **Expenses**: record each cost with a category (rent, transport, electricity and so on), the amount and the account it was paid from.
- **Employees and salary**: add employees with a base salary. Each month create the salary sheet, adjust it, then pay. Advances are tracked and taken off the next salary.
- **Accounts**: cash in the drawer, bank, bKash and Nagad. The **cash book** shows every movement in and out of each account. You can move money between accounts.
- **Funds**: the Owner can add a fund such as **DSR** on the **Funds** tab. A fund holds no money of its own. It only labels cash movements, so the money stays in your accounts and is never counted twice. A movement keeps its fund for good: if one is wrong, void it and enter it again. A fund can be hidden, which stops new entries but keeps the old ones. In the cash book a **Fund** column appears once a movement has one.
- **Day closing**: at the end of the day count the cash and enter it. The app shows the expected cash and any difference, then locks that day. Closing the day protects your records from later changes. The business day rolls over at the hour set in Settings (4 am by default), so a late-night sale still belongs to the right day.

## 8. Reports and the dashboard

- The **dashboard** shows today's sales, collection, expenses, cash, dues, low stock and the best-selling products, with quick buttons for the common tasks.
- **Reports** include a summary, sales, purchases, customer aging, the collection sheet, customer statements, supplier dues, stock value, low stock, expiring stock, the stock ledger, profit by product and by customer, the cash book, day closing, expenses and salary. Choose the dates, then **Print**, **PDF**, **CSV** or **Excel**.
- Every report total matches the sum of its rows. If a number looks wrong, open the report for a single day to check it against the invoices.
- Staff see only a few reports (summary, sales, aging, collection, low stock, expiring stock and statements), and never cost, profit or cash.

## 9. Search, shortcuts and speed tools

- **Ctrl+K** opens global search. It finds products, customers, suppliers, invoices and bills as you type. Press Enter to open the result.
- **F7** opens a calculator. Press **Enter** on a result to paste it into the box you were typing in.
- **Ctrl+Shift+M** shrinks the app into a small always-on-top panel with today's figures and quick actions. Press it again to return.
- A **barcode scanner** works anywhere. On the sale screen it adds the product. On other screens it opens search.
- The **utility dock** is the slim bar on the right edge of every screen. Its **Calculator** button (or **Alt+C**) opens a calculator for whole sums with brackets and %, for example 1250 + 15%. Click into it, type the sum and press Enter. It keeps your last five results; **Copy result** puts the answer on the clipboard so you can paste it where you want. It never types into a field by itself. The **Games** button (or **Alt+G**) opens 2048, Snake and Memory for a short break. Games pause on their own when you close the panel or switch to another window.
- Drag the panel by its top bar to move it; the app remembers where it was and whether it was open. Press Esc, the × button or the dock button again to close it. Opening it never takes the keyboard away from the box you are typing in.
- The Owner can hide the games, or the whole dock, in **Settings**, **Language and look**, under **Utility dock**.
- Press **?** for the full list of shortcuts.
- In Settings you can set a larger font size, high contrast, and reduced or no animation. **Reduced** keeps gentle fades but nothing moves; **Off** turns every animation off. On a slow PC the app switches to Reduced on its own and draws flatter shadows.

## 10. Backup and restore

Your data is the business. PetraDMS backs it up for you, but you must keep a copy away from this PC.

1. Open **Backup**. The page tells you when the last backup was made.
2. Backups are automatic: every 30 minutes while you work and when you close the app. Press **Back up now** at any time.
3. In **Automatic backup** set a **second folder** on a USB drive or a synced cloud folder. Every backup is copied there too.
4. The app keeps recent backups for 14 days, then one a week for 8 weeks, then one a month for a year.
5. To **restore**, choose a backup from the list, or **Restore from a file**. Check the summary (date, shop name, counts), type **RESTORE** and confirm. The app first saves a safety copy of the current data, then replaces it and asks you to sign in again.

If the data file is ever damaged, PetraDMS notices at start-up and restores the newest good backup on its own. A banner tells the Owner what happened. The damaged file is kept, not deleted. The Backup page also has the **activity log** (who did what and when) and a **Support** tab that creates a file for the helpline; it contains no business data.

## 11. Bringing in your data (CSV import)

Open **Settings** and choose **Import, export and demo**, or use the **Import from CSV** buttons on the Products and Customers pages.

1. Choose what you are importing: **Products**, **Customers**, **Opening dues** or **Company invoices**.
2. Press **Download the template** to get a sample file with the right columns. Fill it in Excel and save as **CSV UTF-8**, so Bangla letters stay correct.
3. Choose your file. The app matches your column headings to its fields. Check each match and change any that are wrong. A star marks the fields that are required.
4. Read the table. Each row says **OK** or **Problem**, and what the problem is (for example "Price is not a number" or "This SKU already exists").
5. Press **Check only** to see exactly what would happen without saving anything.
6. Press **Import** to bring in the good rows. Rows with problems are skipped and nothing is half-imported.
7. Press **Save the problem rows as CSV** to get just the bad rows with the reason beside each. Fix them and import that file again.

Notes. Products can include the box size, box prices, the Sell in and Buy in units, the company that supplies them (it is created and linked if new), and opening stock in boxes and pieces with a cost per box or per unit (not for products that expire; buy those in with a purchase so the batch and expiry are recorded). Categories, brands and areas are created automatically. Amounts are in taka, with or without commas or the ৳ sign. Phone numbers must be Bangladeshi mobile numbers. Opening dues add to a customer's or supplier's balance, matched by phone first and then by exact name. Company invoices take one row per invoice line (company, invoice number, date, SKU, box, pcs, cost per box); rows with the same company and invoice number become one purchase on credit, and an invoice with a bad row is skipped whole.

## 12. Exporting everything

You are never locked in. Open **Settings**, then **Import, export and demo**, then **Export everything**. The app makes one ZIP file in the exports folder and shows you where. Inside:

- **spreadsheets**: products, customers, suppliers, sales, purchases and the party ledger, in taka, ready for Excel.
- **raw**: every table exactly as stored, one CSV each, with amounts in poisha (100 poisha is 1 taka).
- **database**: a full backup you can restore on any PetraDMS.

Passwords and PINs are never included.

## 13. Demo mode

Demo mode fills an **empty** shop with sample Bangladeshi products, customers, suppliers, sales and payments, so you or your staff can practise. A banner at the top reminds everyone that the data is not real.

- Open **Settings**, then **Import, export and demo**, then **Demo**, and press **Load demo data**. This is only allowed while the shop has no records of its own.
- Before loading, the app saves a copy of your empty shop.
- To finish, press **Clear demo data**, type **DEMO**, and confirm. Everything entered during the demo is removed, the shop returns exactly as it was, and you sign in again. Do not enter real records while demo mode is on.

## 14. Privacy

PetraDMS never connects to the internet. It sends nothing, collects nothing and has no accounts or cloud. Your data is in the data folder on your PC. The **Support** tab creates a file you can send by hand if you need help; it holds versions, settings, counts and logs, and no customer, product, price or user data.

## 15. When something goes wrong

- **A message appears.** Read it: it says what happened and what to do. Nothing technical is hidden from the log.
- **The screen looks stuck.** Close the app and open it again. Your saved records are not affected.
- **You entered something by mistake.** Void or return the document; do not try to edit the past. If the day is closed, ask the Owner.
- **The PC lost power while you worked.** Open the app again. Records are saved safely at each step, so only the entry in progress is lost.
- **Stock or money looks wrong.** Check the stock movements of the product and the customer statement. The numbers always come from these records.
- **You forgot the Owner PIN.** On the sign-in screen choose **Forgot PIN or password?** and enter the recovery code from the wizard. Only the Owner can be reset this way.
- **Nothing else helps.** Open **Backup**, then **Support**, create the support file and send it to your vendor.
