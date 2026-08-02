-- 00197_bookkeeping_gmail_forwarders_since.sql
-- Backlog guard for the forwarder watch (owner request 2026-08-02): the
-- forwarder Gmail query gains `after:<date>` so flipping the poller on does
-- not walk years of yortago mailbox history into the review queue. The LABEL
-- source stays unbounded on purpose — labeling old mail "DJP Receipts" remains
-- the explicit opt-in backfill path (Decision C-8).
insert into system_settings (key, value, description) values
  ('bookkeeping_gmail_receipt_forwarders_since',
   '"2026-08-02"'::jsonb,
   'Forwarder-watch cutoff (YYYY-MM-DD): the Gmail receipt poller only reads forwarder mail after this date. Blank/invalid = unbounded. The label source is unaffected.')
on conflict (key) do nothing;
