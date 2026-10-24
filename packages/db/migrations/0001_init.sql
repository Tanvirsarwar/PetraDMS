-- PetraDMS schema v1. Forward-only. Money = INTEGER poisha, quantity = INTEGER base units.
-- Every table has an INTEGER primary key plus a random 128-bit `uuid` for future sync.

-- ===== Identity =====
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE business_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL DEFAULT '',
  name_bn TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  tax_no TEXT NOT NULL DEFAULT '',
  footer_note TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE license_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  trial_started_at TEXT,
  last_seen_max TEXT,
  license_blob TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  next INTEGER NOT NULL DEFAULT 1
);

-- ===== Catalog =====
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  name_bn TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL
);

CREATE TABLE brands (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  name_bn TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_bn TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id),
  brand_id INTEGER REFERENCES brands(id),
  base_unit TEXT NOT NULL DEFAULT 'pcs',
  track_expiry INTEGER NOT NULL DEFAULT 0,
  -- prices are per ONE BASE UNIT, in poisha; packs may override (see product_packs)
  price_retail INTEGER NOT NULL DEFAULT 0 CHECK (price_retail >= 0),
  price_wholesale INTEGER NOT NULL DEFAULT 0 CHECK (price_wholesale >= 0),
  price_dealer INTEGER NOT NULL DEFAULT 0 CHECK (price_dealer >= 0),
  min_price INTEGER NOT NULL DEFAULT 0 CHECK (min_price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0,
  stock_value INTEGER NOT NULL DEFAULT 0,
  last_cost INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
  favourite INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_packs (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  name_bn TEXT NOT NULL DEFAULT '',
  factor INTEGER NOT NULL CHECK (factor >= 1),
  -- NULL means factor * the product's per-base-unit price
  price_retail INTEGER CHECK (price_retail IS NULL OR price_retail >= 0),
  price_wholesale INTEGER CHECK (price_wholesale IS NULL OR price_wholesale >= 0),
  price_dealer INTEGER CHECK (price_dealer IS NULL OR price_dealer >= 0),
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, name),
  UNIQUE (product_id, factor)
);

CREATE TABLE product_barcodes (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  product_id INTEGER NOT NULL REFERENCES products(id),
  pack_id INTEGER REFERENCES product_packs(id),
  barcode TEXT NOT NULL UNIQUE
);

-- ===== Stock =====
CREATE TABLE stock_batches (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  qty_remaining INTEGER NOT NULL DEFAULT 0 CHECK (qty_remaining >= 0),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_batch_identity ON stock_batches(product_id, batch_no, COALESCE(expiry_date, ''));

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  business_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening','purchase','sale','bonus','sales_return','purchase_return','damage','expired','internal_use','adjust_in','adjust_out','void_reversal')),
  base_qty INTEGER NOT NULL,
  value INTEGER NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  reverses_id INTEGER REFERENCES stock_movements(id),
  user_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE stock_adjustments (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  doc_no TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','damage','expired','internal_use','adjust_in','adjust_out')),
  base_qty INTEGER NOT NULL CHECK (base_qty > 0),
  value INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  void_reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ===== Parties =====
CREATE TABLE areas (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  name_bn TEXT NOT NULL DEFAULT ''
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  name_bn TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  area_id INTEGER REFERENCES areas(id),
  type TEXT NOT NULL DEFAULT 'retail' CHECK (type IN ('retail','wholesale','dealer')),
  credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  default_discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (default_discount_bp BETWEEN 0 AND 10000),
  balance INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  name_bn TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  balance INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  name_bn TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  base_salary INTEGER NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  balance INTEGER NOT NULL DEFAULT 0,
  joined_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Balance sign: customer > 0 = customer owes us; supplier > 0 = we owe supplier; employee > 0 = we owe employee.
CREATE TABLE party_ledger (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  party_kind TEXT NOT NULL CHECK (party_kind IN ('customer','supplier','employee')),
  party_id INTEGER NOT NULL,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('opening','sale','payment','return','adjustment','salary_due','salary_paid','advance','void_reversal','purchase')),
  amount INTEGER NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  reverses_id INTEGER REFERENCES party_ledger(id),
  business_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ===== Sales =====
CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  doc_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  revision INTEGER NOT NULL DEFAULT 1,
  business_date TEXT NOT NULL,
  price_tier TEXT NOT NULL DEFAULT 'retail' CHECK (price_tier IN ('retail','wholesale','dealer')),
  subtotal INTEGER NOT NULL,
  disc_kind TEXT CHECK (disc_kind IS NULL OR disc_kind IN ('pct','fixed')),
  disc_value INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  tax_bp INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  round_off INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL DEFAULT 0,
  account_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  approved_by INTEGER REFERENCES users(id),
  void_reason TEXT,
  voided_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  revision INTEGER NOT NULL DEFAULT 1,
  line_no INTEGER NOT NULL,
  line_kind TEXT NOT NULL CHECK (line_kind IN ('normal','bonus')),
  product_id INTEGER NOT NULL REFERENCES products(id),
  pack_id INTEGER REFERENCES product_packs(id),
  pack_name TEXT NOT NULL,
  factor INTEGER NOT NULL CHECK (factor >= 1),
  qty INTEGER NOT NULL CHECK (qty > 0),
  base_qty INTEGER NOT NULL CHECK (base_qty > 0),
  price INTEGER NOT NULL DEFAULT 0,
  disc_kind TEXT CHECK (disc_kind IS NULL OR disc_kind IN ('pct','fixed')),
  disc_value INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL,
  alloc_discount INTEGER NOT NULL DEFAULT 0,
  cogs INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sale_item_batches (
  id INTEGER PRIMARY KEY,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  batch_id INTEGER NOT NULL REFERENCES stock_batches(id),
  base_qty INTEGER NOT NULL CHECK (base_qty > 0),
  returned_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sale_returns (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  doc_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  business_date TEXT NOT NULL,
  refund_mode TEXT NOT NULL CHECK (refund_mode IN ('due','cash')),
  account_id INTEGER,
  net_amount INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  cogs_restored INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  reason TEXT NOT NULL DEFAULT '',
  void_reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE sale_return_items (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id),
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  base_qty INTEGER NOT NULL CHECK (base_qty > 0),
  net_amount INTEGER NOT NULL,
  cogs INTEGER NOT NULL
);

CREATE TABLE sale_drafts (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== Purchases =====
CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  doc_no TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  business_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL DEFAULT 0,
  account_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  void_reason TEXT,
  voided_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  line_no INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  pack_id INTEGER REFERENCES product_packs(id),
  pack_name TEXT NOT NULL,
  factor INTEGER NOT NULL CHECK (factor >= 1),
  qty INTEGER NOT NULL CHECK (qty > 0),
  base_qty INTEGER NOT NULL CHECK (base_qty > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  amount INTEGER NOT NULL,
  alloc_discount INTEGER NOT NULL DEFAULT 0,
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  batch_id INTEGER REFERENCES stock_batches(id)
);

CREATE TABLE purchase_returns (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  doc_no TEXT NOT NULL UNIQUE,
  purchase_id INTEGER REFERENCES purchases(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  business_date TEXT NOT NULL,
  refund_mode TEXT NOT NULL CHECK (refund_mode IN ('due','cash')),
  account_id INTEGER,
  credit INTEGER NOT NULL,
  cost_value INTEGER NOT NULL,
  -- cost_value - credit: positive = loss, booked to COGS (section 5.4)
  variance INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  reason TEXT NOT NULL DEFAULT '',
  void_reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE purchase_return_items (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES purchase_returns(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  base_qty INTEGER NOT NULL CHECK (base_qty > 0),
  credit INTEGER NOT NULL,
  cost_value INTEGER NOT NULL
);

-- ===== Money =====
CREATE TABLE money_accounts (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  name_bn TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('cash','bank','bkash','nagad','other')),
  balance INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- amount is signed: positive = money in, negative = money out
CREATE TABLE cash_transactions (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  account_id INTEGER NOT NULL REFERENCES money_accounts(id),
  business_date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('opening','sale','purchase','payment','expense','salary','advance','refund','day_close','void_reversal')),
  ref_type TEXT,
  ref_id INTEGER,
  reverses_id INTEGER REFERENCES cash_transactions(id),
  party_kind TEXT,
  party_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK ((direction = 'in' AND amount >= 0) OR (direction = 'out' AND amount <= 0))
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  doc_no TEXT NOT NULL UNIQUE,
  party_kind TEXT NOT NULL CHECK (party_kind IN ('customer','supplier','employee')),
  party_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('received','given')),
  purpose TEXT NOT NULL DEFAULT 'normal' CHECK (purpose IN ('normal','salary','advance')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  account_id INTEGER NOT NULL REFERENCES money_accounts(id),
  reference TEXT NOT NULL DEFAULT '',
  invoice_ref_type TEXT,
  invoice_ref_id INTEGER,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  void_reason TEXT,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE day_closings (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  business_date TEXT NOT NULL UNIQUE,
  opening_cash INTEGER NOT NULL,
  collections INTEGER NOT NULL,
  expenses INTEGER NOT NULL,
  expected_cash INTEGER NOT NULL,
  actual_cash INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('closed','reopened')),
  note TEXT NOT NULL DEFAULT '',
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT NOT NULL,
  reopened_by INTEGER REFERENCES users(id),
  reopened_at TEXT,
  reopen_reason TEXT
);

-- ===== People / spend =====
CREATE TABLE salary_sheets (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  business_date TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  void_reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE salary_lines (
  id INTEGER PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES salary_sheets(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  base INTEGER NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 0,
  deduction INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL,
  UNIQUE (sheet_id, employee_id)
);

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  name_bn TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  doc_no TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  account_id INTEGER NOT NULL REFERENCES money_accounts(id),
  payee TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  void_reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ===== Trace =====
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE backup_log (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE app_log (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE game_scores (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  player TEXT NOT NULL,
  score INTEGER NOT NULL,
  at TEXT NOT NULL
);

-- ===== Indexes: every foreign key, business_date, party, product+date =====
CREATE INDEX ix_products_category ON products(category_id);
CREATE INDEX ix_products_brand ON products(brand_id);
CREATE INDEX ix_products_status ON products(status);
CREATE INDEX ix_packs_product ON product_packs(product_id);
CREATE INDEX ix_barcodes_product ON product_barcodes(product_id);
CREATE INDEX ix_barcodes_pack ON product_barcodes(pack_id);
CREATE INDEX ix_batches_product ON stock_batches(product_id, expiry_date);
CREATE INDEX ix_mov_product_date ON stock_movements(product_id, business_date);
CREATE INDEX ix_mov_date ON stock_movements(business_date);
CREATE INDEX ix_mov_batch ON stock_movements(batch_id);
CREATE INDEX ix_mov_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX ix_mov_reverses ON stock_movements(reverses_id);
CREATE INDEX ix_mov_user ON stock_movements(user_id);
CREATE INDEX ix_adj_product ON stock_adjustments(product_id);
CREATE INDEX ix_adj_batch ON stock_adjustments(batch_id);
CREATE INDEX ix_adj_date ON stock_adjustments(business_date);
CREATE INDEX ix_adj_user ON stock_adjustments(user_id);
CREATE INDEX ix_customers_area ON customers(area_id);
CREATE INDEX ix_ledger_party ON party_ledger(party_kind, party_id);
CREATE INDEX ix_ledger_date ON party_ledger(business_date);
CREATE INDEX ix_ledger_ref ON party_ledger(ref_type, ref_id);
CREATE INDEX ix_ledger_reverses ON party_ledger(reverses_id);
CREATE INDEX ix_ledger_user ON party_ledger(user_id);
CREATE INDEX ix_sales_customer ON sales(customer_id);
CREATE INDEX ix_sales_date ON sales(business_date);
CREATE INDEX ix_sales_account ON sales(account_id);
CREATE INDEX ix_sales_user ON sales(user_id);
CREATE INDEX ix_sales_approved ON sales(approved_by);
CREATE INDEX ix_sales_voided_by ON sales(voided_by);
CREATE INDEX ix_sale_items_sale ON sale_items(sale_id, revision);
CREATE INDEX ix_sale_items_product ON sale_items(product_id);
CREATE INDEX ix_sale_items_pack ON sale_items(pack_id);
CREATE INDEX ix_sib_item ON sale_item_batches(sale_item_id);
CREATE INDEX ix_sib_batch ON sale_item_batches(batch_id);
CREATE INDEX ix_sret_sale ON sale_returns(sale_id);
CREATE INDEX ix_sret_date ON sale_returns(business_date);
CREATE INDEX ix_sret_user ON sale_returns(user_id);
CREATE INDEX ix_sreti_return ON sale_return_items(return_id);
CREATE INDEX ix_sreti_item ON sale_return_items(sale_item_id);
CREATE INDEX ix_sreti_product ON sale_return_items(product_id);
CREATE INDEX ix_drafts_user ON sale_drafts(user_id);
CREATE INDEX ix_drafts_customer ON sale_drafts(customer_id);
CREATE INDEX ix_purch_supplier ON purchases(supplier_id);
CREATE INDEX ix_purch_date ON purchases(business_date);
CREATE INDEX ix_purch_account ON purchases(account_id);
CREATE INDEX ix_purch_user ON purchases(user_id);
CREATE INDEX ix_purch_voided_by ON purchases(voided_by);
CREATE INDEX ix_purchi_purchase ON purchase_items(purchase_id);
CREATE INDEX ix_purchi_product ON purchase_items(product_id);
CREATE INDEX ix_purchi_pack ON purchase_items(pack_id);
CREATE INDEX ix_purchi_batch ON purchase_items(batch_id);
CREATE INDEX ix_pret_purchase ON purchase_returns(purchase_id);
CREATE INDEX ix_pret_supplier ON purchase_returns(supplier_id);
CREATE INDEX ix_pret_date ON purchase_returns(business_date);
CREATE INDEX ix_pret_user ON purchase_returns(user_id);
CREATE INDEX ix_preti_return ON purchase_return_items(return_id);
CREATE INDEX ix_preti_product ON purchase_return_items(product_id);
CREATE INDEX ix_preti_batch ON purchase_return_items(batch_id);
CREATE INDEX ix_cash_account ON cash_transactions(account_id, business_date);
CREATE INDEX ix_cash_date ON cash_transactions(business_date);
CREATE INDEX ix_cash_ref ON cash_transactions(ref_type, ref_id);
CREATE INDEX ix_cash_reverses ON cash_transactions(reverses_id);
CREATE INDEX ix_cash_party ON cash_transactions(party_kind, party_id);
CREATE INDEX ix_cash_user ON cash_transactions(user_id);
CREATE INDEX ix_pay_party ON payments(party_kind, party_id);
CREATE INDEX ix_pay_account ON payments(account_id);
CREATE INDEX ix_pay_date ON payments(business_date);
CREATE INDEX ix_pay_user ON payments(user_id);
CREATE INDEX ix_close_closed_by ON day_closings(closed_by);
CREATE INDEX ix_close_reopened_by ON day_closings(reopened_by);
CREATE INDEX ix_sheet_user ON salary_sheets(user_id);
CREATE UNIQUE INDEX ux_sheet_month ON salary_sheets(month) WHERE status = 'posted';
CREATE INDEX ix_sline_sheet ON salary_lines(sheet_id);
CREATE INDEX ix_sline_employee ON salary_lines(employee_id);
CREATE INDEX ix_expenses_category ON expenses(category_id);
CREATE INDEX ix_expenses_account ON expenses(account_id);
CREATE INDEX ix_expenses_date ON expenses(business_date);
CREATE INDEX ix_expenses_user ON expenses(user_id);
CREATE INDEX ix_audit_user ON audit_log(user_id);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX ix_audit_at ON audit_log(at);
