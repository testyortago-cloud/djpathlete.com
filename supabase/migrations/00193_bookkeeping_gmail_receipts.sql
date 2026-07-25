-- 00193_bookkeeping_gmail_receipts.sql
-- Track C (Phase 3b): Gmail receipt poller data model.
--
-- external_ref holds the poller idempotency key 'gmail:<messageId>:<attachmentIndex>'.
-- CONSTRAINT DISCIPLINE: this column is check-then-insert only (the poller skips a
-- message when any document matches external_ref LIKE 'gmail:<id>:%'). It must NEVER
-- become a PostgREST onConflict target — it is nullable and Postgres treats NULLs as
-- distinct, so an upsert keyed on it can never dedupe (every existing photo/statement
-- row has external_ref NULL). The UNIQUE below is the belt behind the skip check, not
-- an upsert seam.
--
-- scan_result is the durable home for the coalesced vision result (the functions
-- receipt-scan handler writes it; the photo flow's RTDB/browser-memory path is
-- unchanged).
--
-- NOTE FOR C5/C6: the skip key above means "already INGESTED", not "already
-- SCANNED". If ingest writes the document row and then the receipt_scan job
-- write fails, the next poll skips that message forever. The review surface
-- must therefore expose receipt documents with scan_result IS NULL as
-- "scan failed — retry" so nothing goes silently missing.
--
-- Both column adds are IF NOT EXISTS so replaying supabase/migrations/ against a
-- DB that already has 00193 does not abort at 42701 before the seeds below.
alter table bookkeeping_documents add column if not exists external_ref text unique;
alter table bookkeeping_documents add column if not exists scan_result jsonb;

insert into system_settings (key, value, description) values
  ('cron_bookkeeping_gmail_receipts_enabled', 'false'::jsonb, 'Enable the hourly Gmail receipt-label poller (ingests labeled attachments as receipt scans)'),
  ('bookkeeping_gmail_receipt_label', '"DJP Receipts"'::jsonb, 'Gmail label name the receipt poller watches')
on conflict (key) do nothing;
