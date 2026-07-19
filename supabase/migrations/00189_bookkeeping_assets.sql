-- 00189_bookkeeping_assets.sql
-- AI Bookkeeper Phase 6d: depreciable-asset register (design §6.1, D-12/D-13).
-- Depreciation is REPORT-LAYER only — no ledger changes, no new `source` value.
-- All fields accountant-supplied; straight_line is the only method (D-13).
-- Money is integer cents. RLS is ceremony (DAL uses service-role) per 00183.

CREATE TABLE IF NOT EXISTS bookkeeping_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  basis_cents     INTEGER NOT NULL CHECK (basis_cents >= 0),
  salvage_cents   INTEGER NOT NULL DEFAULT 0 CHECK (salvage_cents >= 0),
  in_service_on   DATE NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('straight_line')),
  convention      TEXT NOT NULL CHECK (convention IN ('full_month','half_year')),
  recovery_years  INTEGER NOT NULL CHECK (recovery_years BETWEEN 1 AND 50),
  accountant_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (salvage_cents <= basis_cents)
);
CREATE INDEX IF NOT EXISTS idx_bk_assets_book ON bookkeeping_assets(book_id);

ALTER TABLE bookkeeping_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage assets" ON bookkeeping_assets FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
