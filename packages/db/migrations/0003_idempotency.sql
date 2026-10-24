-- 0003: one real-world money event posts exactly once.
--
-- 1. idempotency_keys: a client-chosen request id for an expense or a payment is stored in the SAME transaction
--    as the posting. A repeated submission (double click, retry) finds the key and returns the first result
--    instead of posting again. A failed attempt rolls the key back with everything else, so a corrected retry works.
-- 2. At most one reversal row can point at any original row (stock, party ledger, cash). Voiding already skips
--    rows that are reversed; this makes the database refuse a second reversal even if code ever tried.
--
-- Additive only: no existing row changes. Reversals are already 1:1 (invariant I7 would fail otherwise).
CREATE TABLE idempotency_keys (
  key         TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX ix_idem_created ON idempotency_keys(created_at);

CREATE UNIQUE INDEX ux_mov_reverses    ON stock_movements(reverses_id)   WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX ux_ledger_reverses ON party_ledger(reverses_id)      WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX ux_cash_reverses   ON cash_transactions(reverses_id) WHERE reverses_id IS NOT NULL;
