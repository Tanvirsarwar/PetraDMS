-- PetraDMS schema v2 (app v1.1.0): company <-> product link, bulk purchase entry, box + pcs everywhere.
-- Forward-only and additive: no v1 row is changed, only new tables and new columns with neutral defaults.

-- ===== Company <-> product link =====
-- last_cost is the cost of ONE default pack (or of one base unit when default_pack_id is NULL), in poisha.
CREATE TABLE supplier_products (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  default_pack_id INTEGER REFERENCES product_packs(id),
  last_cost INTEGER CHECK (last_cost IS NULL OR last_cost >= 0),
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (supplier_id, product_id)
);
CREATE INDEX ix_supprod_supplier ON supplier_products(supplier_id, sort);
CREATE INDEX ix_supprod_product ON supplier_products(product_id);
CREATE INDEX ix_supprod_pack ON supplier_products(default_pack_id);

-- ===== Purchase drafts (same behaviour as sale_drafts: one per user, survives a crash) =====
CREATE TABLE purchase_drafts (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL REFERENCES users(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_pdrafts_user ON purchase_drafts(user_id);
CREATE INDEX ix_pdrafts_supplier ON purchase_drafts(supplier_id);

-- ===== Products: default units =====
ALTER TABLE products ADD COLUMN default_sale_pack_id INTEGER REFERENCES product_packs(id);
ALTER TABLE products ADD COLUMN default_purchase_pack_id INTEGER REFERENCES product_packs(id);
CREATE INDEX ix_products_defsale ON products(default_sale_pack_id);
CREATE INDEX ix_products_defpurch ON products(default_purchase_pack_id);

-- ===== Purchases: company invoice fields =====
-- supplier_ref (v1) is the company's invoice number. invoice_date / due_date are the company's dates;
-- business_date stays the day the goods were received and posted.
ALTER TABLE purchases ADD COLUMN invoice_date TEXT;
ALTER TABLE purchases ADD COLUMN due_date TEXT;
ALTER TABLE purchases ADD COLUMN disc_kind TEXT CHECK (disc_kind IS NULL OR disc_kind IN ('pct','fixed'));
ALTER TABLE purchases ADD COLUMN disc_value INTEGER NOT NULL DEFAULT 0;
-- VAT / other charge and freight: both are added to the bill total and capitalised into stock cost.
ALTER TABLE purchases ADD COLUMN tax INTEGER NOT NULL DEFAULT 0 CHECK (tax >= 0);
ALTER TABLE purchases ADD COLUMN freight INTEGER NOT NULL DEFAULT 0 CHECK (freight >= 0);
-- why a repeated company invoice number was accepted
ALTER TABLE purchases ADD COLUMN dup_reason TEXT NOT NULL DEFAULT '';

-- ===== Purchase lines: pieces beside boxes, free goods, line discount, charge share =====
-- base_qty = qty * factor + loose_qty. `amount` is the authoritative line money (gross - discount) and is never
-- re-derived from a per-piece cost. A free line has amount 0 and still raises stock.
ALTER TABLE purchase_items ADD COLUMN loose_qty INTEGER NOT NULL DEFAULT 0 CHECK (loose_qty >= 0);
ALTER TABLE purchase_items ADD COLUMN line_kind TEXT NOT NULL DEFAULT 'normal' CHECK (line_kind IN ('normal','free'));
ALTER TABLE purchase_items ADD COLUMN disc_kind TEXT CHECK (disc_kind IS NULL OR disc_kind IN ('pct','fixed'));
ALTER TABLE purchase_items ADD COLUMN disc_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN alloc_charge INTEGER NOT NULL DEFAULT 0;

-- ===== Branding: the trader's own logo (v1.1) =====
-- A small image as a data URL (PNG, JPEG or WebP, at most 256 KB), kept in the database so every backup carries it.
ALTER TABLE business_profile ADD COLUMN logo TEXT NOT NULL DEFAULT '';
