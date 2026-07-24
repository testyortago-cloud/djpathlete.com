-- 00190_bookkeeping_income_sync.sql
-- Nightly platform-income sync cron flag. Arrives OFF (money-posting cron);
-- the owner flips it in admin settings. Additive, idempotent, inert without code.
insert into system_settings (key, value, description) values
  ('cron_bookkeeping_income_sync_enabled', 'false'::jsonb, 'Enable the nightly platform-income auto-post to the primary business book')
on conflict (key) do nothing;
