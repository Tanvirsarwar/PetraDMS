-- 0004: funds (DSR). A fund is a CLASSIFICATION of cash movements, not a second ledger.
--
-- Money keeps living in money_accounts and cash_transactions, exactly once. A cash_transactions row may carry a
-- fund_id that says "this movement belongs to the DSR fund". Reports and statements (later stages) read the same
-- rows by fund; nothing is posted twice and no balance is copied.
--
-- Additive and backward compatible: fund_id is NULL on every existing row, which means ordinary business money,
-- as before. No balance is touched and no opening balance is created.
CREATE TABLE funds (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL UNIQUE,
  name_bn    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'dsr' CHECK (kind IN ('dsr')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

ALTER TABLE cash_transactions ADD COLUMN fund_id INTEGER REFERENCES funds(id);
CREATE INDEX ix_cash_fund ON cash_transactions(fund_id) WHERE fund_id IS NOT NULL;

-- A posted movement never changes fund: moving it would silently change two fund balances without a posting.
-- (To correct a mistake, void the document and post it again, as for any other correction.)
CREATE TRIGGER trg_cash_fund_fixed
BEFORE UPDATE OF fund_id ON cash_transactions
WHEN OLD.fund_id IS NOT NEW.fund_id
BEGIN
  SELECT RAISE(ABORT, 'a cash transaction cannot change fund');
END;
