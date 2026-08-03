-- 00198_bookkeeping_close_nudge.sql
-- Monthly close nudge: a single dark flag for the cron that emails the coach the
-- list of finished months that still have no close row. Additive, reversible,
-- inert without code. Default FALSE — it sends outbound email, so it stays off
-- until the coach turns it on.
--
-- The pre-close readiness gate that ships alongside this needs no migration: it
-- computes entirely from existing ledger, account, close and dismissal rows.

INSERT INTO system_settings (key, value, description) VALUES
  ('cron_bookkeeping_close_nudge_enabled', 'false'::jsonb, 'Email the coach on the 3rd of each month listing finished months that are still open')
ON CONFLICT (key) DO NOTHING;
