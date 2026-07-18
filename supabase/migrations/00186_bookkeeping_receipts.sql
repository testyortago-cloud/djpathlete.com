-- 00186_bookkeeping_receipts.sql
-- Phase 3 (receipts): link a receipt document to its ledger entry, mark
-- IRS-sensitive accounts as requiring a business purpose, and seed the
-- (default OFF) retention-pruning cron flag. Additive + reversible.

-- 1) receipt <-> ledger link. ON DELETE SET NULL lets the retention cron drop
--    an expired image while the ledger entry (the actual book record) survives.
alter table bookkeeping_ledger_entries
  add column if not exists document_id uuid
    references bookkeeping_documents(id) on delete set null;
create index if not exists idx_bk_ledger_document
  on bookkeeping_ledger_entries(document_id);

-- 2) per-account "business purpose required" flag (IRS-sensitive categories).
alter table bookkeeping_accounts
  add column if not exists requires_business_purpose boolean not null default false;
update bookkeeping_accounts set requires_business_purpose = true
  where account_type = 'expense'
    and name in ('Meals (business purpose)', 'Travel', 'Vehicle');

-- 3) retention cron flag — DB-backed, default OFF (destructive).
insert into system_settings (key, value, description) values
  ('cron_bookkeeping_retention_enabled', 'false'::jsonb,
   'Daily cron: prune bookkeeping_documents (statements + receipts) past retain_until — deletes the bucket object + row, nulls the linked ledger entry document_id. Default OFF (destructive).')
on conflict (key) do nothing;
