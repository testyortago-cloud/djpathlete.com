-- 00188_bookkeeping_period_closes.sql
-- AI Bookkeeper Phase 6a: monthly close. Per-book-per-month totals snapshot
-- (D-1: reopen = DELETE the row, audit metadata preserves the snapshot) plus
-- the adjustment-entry linkage column (D-3) and two dark flags. Additive,
-- reversible, inert without code. RLS is ceremony only — the DAL uses the
-- service-role client (00183 precedent).

CREATE TABLE IF NOT EXISTS bookkeeping_period_closes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  period         TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  income_cents   INTEGER NOT NULL,
  expense_cents  INTEGER NOT NULL,
  net_cents      INTEGER NOT NULL,
  entry_count    INTEGER NOT NULL,
  email_sent_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, period)  -- PLAIN unique (00184 lesson); doubles as the (book_id, period) index
);

ALTER TABLE bookkeeping_period_closes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage period closes" ON bookkeeping_period_closes FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- D-3: adjustment entries reference the closed month they correct. Nullable;
-- never part of any unique key (source_ref stays the dedupe key).
ALTER TABLE bookkeeping_ledger_entries
  ADD COLUMN IF NOT EXISTS adjusts_period TEXT
  CHECK (adjusts_period IS NULL OR adjusts_period ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Flags (both dark). The watchdog flag rides 00188 because 6a+6b build
-- back-to-back this session (spec §3.1 note); 6a code never reads it.
INSERT INTO system_settings (key, value, description) VALUES
  ('bookkeeping_close_email_enabled', 'false'::jsonb, 'Send the books-closed email when a month is closed'),
  ('cron_bookkeeping_receipt_watchdog_enabled', 'false'::jsonb, 'Enable the weekly missing-receipt watchdog email cron')
ON CONFLICT (key) DO NOTHING;
