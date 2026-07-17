-- 00183_bookkeeping_foundation.sql
-- APPLIED to the live DB 2026-07-17 via mcp apply_migration (verified: 3 books,
-- 25 accounts, 0 entries). AI Bookkeeper Phase 1: the ledger spine. Three sets
-- of books (Darren's business, his wife's business, Household & Personal), a
-- per-book chart of accounts, and a categorized single-entry ledger. Money is
-- integer cents. RLS is enabled for ceremony only — every DAL uses the
-- service-role client and scopes book_id in application code (design doc D1/§5).

CREATE TABLE IF NOT EXISTS bookkeeping_books (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  book_kind    TEXT NOT NULL CHECK (book_kind IN ('business','household')),
  owner_label  TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  currency     TEXT NOT NULL DEFAULT 'usd',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookkeeping_accounts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id                UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  account_type           TEXT NOT NULL CHECK (account_type IN ('income','expense')),
  service_line           TEXT,
  is_deductible_candidate BOOLEAN NOT NULL DEFAULT false,
  tax_category           TEXT,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  archived_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, name)
);
CREATE INDEX IF NOT EXISTS idx_bk_accounts_book ON bookkeeping_accounts(book_id);

CREATE TABLE IF NOT EXISTS bookkeeping_ledger_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id          UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  account_id       UUID REFERENCES bookkeeping_accounts(id) ON DELETE SET NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('income','expense')),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'usd',
  occurred_on      DATE NOT NULL,
  memo             TEXT,
  business_purpose TEXT,
  counterparty     TEXT,
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','platform_import','statement_import','receipt')),
  source_ref       TEXT,
  import_batch_id  UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (book_id, source, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_bk_ledger_book_date ON bookkeeping_ledger_entries(book_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_bk_ledger_book_account ON bookkeeping_ledger_entries(book_id, account_id);
CREATE INDEX IF NOT EXISTS idx_bk_ledger_source ON bookkeeping_ledger_entries(source, source_ref);

ALTER TABLE bookkeeping_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookkeeping_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookkeeping_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage books" ON bookkeeping_books FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE POLICY "Admins manage accounts" ON bookkeeping_accounts FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE POLICY "Admins manage ledger" ON bookkeeping_ledger_entries FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- Seed the three books
INSERT INTO bookkeeping_books (id, name, book_kind, owner_label, is_primary, sort_order)
VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Darren — DJP Athlete', 'business', 'Darren', true, 0),
  ('b0000000-0000-4000-8000-000000000002', 'Spouse — Business',    'business', 'Spouse', false, 1),
  ('b0000000-0000-4000-8000-000000000003', 'Household & Personal', 'household', 'Household', false, 2)
ON CONFLICT (id) DO NOTHING;

-- Seed a starter chart of accounts (Darren's real income lines + standard
-- expense buckets incl. the tenant reframe: rent/utilities/equipment)
INSERT INTO bookkeeping_accounts (book_id, name, account_type, service_line, is_deductible_candidate, sort_order)
VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Performance Training — Sports',  'income', 'performance_training', false, 0),
  ('b0000000-0000-4000-8000-000000000001', 'Performance Training — Stripe',  'income', 'performance_training', false, 1),
  ('b0000000-0000-4000-8000-000000000001', 'Teams / Center Work',            'income', 'teams_center', false, 2),
  ('b0000000-0000-4000-8000-000000000001', 'Session Packs',                  'income', 'session_packs', false, 3),
  ('b0000000-0000-4000-8000-000000000001', 'Camps & Clinics',                'income', 'camps', false, 4),
  ('b0000000-0000-4000-8000-000000000001', 'Memberships',                    'income', 'memberships', false, 5),
  ('b0000000-0000-4000-8000-000000000001', 'Shop',                           'income', 'shop', false, 6),
  ('b0000000-0000-4000-8000-000000000001', 'Other Income',                   'income', 'other', false, 7),
  ('b0000000-0000-4000-8000-000000000001', 'Equipment',                      'expense', NULL, true, 10),
  ('b0000000-0000-4000-8000-000000000001', 'Software & Subscriptions',       'expense', NULL, true, 11),
  ('b0000000-0000-4000-8000-000000000001', 'Travel',                         'expense', NULL, true, 12),
  ('b0000000-0000-4000-8000-000000000001', 'Meals (business purpose)',       'expense', NULL, true, 13),
  ('b0000000-0000-4000-8000-000000000001', 'Phone & Internet',               'expense', NULL, true, 14),
  ('b0000000-0000-4000-8000-000000000001', 'Vehicle',                        'expense', NULL, true, 15),
  ('b0000000-0000-4000-8000-000000000001', 'Professional Fees',              'expense', NULL, true, 16),
  ('b0000000-0000-4000-8000-000000000001', 'Uncategorized',                  'expense', NULL, false, 99),
  ('b0000000-0000-4000-8000-000000000003', 'Rent',                           'expense', NULL, false, 0),
  ('b0000000-0000-4000-8000-000000000003', 'Utilities',                      'expense', NULL, false, 1),
  ('b0000000-0000-4000-8000-000000000003', 'Internet',                       'expense', NULL, false, 2),
  ('b0000000-0000-4000-8000-000000000003', 'Renter''s Insurance',            'expense', NULL, false, 3),
  ('b0000000-0000-4000-8000-000000000003', 'Home Repairs & Maintenance',     'expense', NULL, false, 4),
  ('b0000000-0000-4000-8000-000000000003', 'Medical',                        'expense', NULL, false, 5),
  ('b0000000-0000-4000-8000-000000000003', 'Vehicles',                       'expense', NULL, false, 6),
  ('b0000000-0000-4000-8000-000000000003', 'Children',                       'expense', NULL, false, 7),
  ('b0000000-0000-4000-8000-000000000003', 'Other Household',                'expense', NULL, false, 8)
ON CONFLICT (book_id, name) DO NOTHING;
