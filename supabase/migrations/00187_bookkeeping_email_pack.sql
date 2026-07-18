-- 00187_bookkeeping_email_pack.sql
-- Phase 4b: outbound accountant-pack email flags + stored accountant address.
-- Both flags default OFF (D10: outward-emitting). Additive, reversible, inert without code.
insert into system_settings (key, value, description) values
  ('bookkeeping_email_pack_enabled', 'false'::jsonb, 'Enable the manual "Email to accountant" action on /admin/books/reports'),
  ('cron_bookkeeping_quarterly_pack_enabled', 'false'::jsonb, 'Enable the quarterly accountant-pack email cron'),
  ('bookkeeping_accountant_email', '""'::jsonb, 'Accountant recipient for the quarterly pack (empty = cron skips)')
on conflict (key) do nothing;
