-- 00192_bookkeeping_finding_dismissals.sql
-- Track B (5b polish, design 2026-07-25 §2.1, decision B-1): identity-based
-- dismissals for insight findings. Fingerprint = "<finder>:<key>" (pure fn in
-- lib/bookkeeping/finding-fingerprint.ts) — identity, never amounts, so nightly
-- income-sync total growth cannot resurface a dismissal. Dismissals only filter
-- DISPLAY (and the AI narrative input); the pure recompute (D4) never changes.
-- RLS is enabled for ceremony only (00183 precedent): every DAL uses the
-- service-role client and scopes book_id in application code.

CREATE TABLE IF NOT EXISTS bookkeeping_finding_dismissals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  fingerprint   TEXT NOT NULL,
  dismissed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_bk_dismissals_book ON bookkeeping_finding_dismissals(book_id);

ALTER TABLE bookkeeping_finding_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage finding dismissals" ON bookkeeping_finding_dismissals FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
