-- 00236_bookkeeping_gmail_vendor_watch.sql
-- Third listing source for the receipt poller: a Gmail search over the coach's
-- own inbox, alongside the label (00193) and the forwarder watch (00196/00197).
--
-- WHY: the forwarder watch assumed receipts reach the coach VIA a forwarding
-- account, so both its clauses key on a forwarder address. An invoice a vendor
-- sends straight to the coach matches neither, and the 'DJP Receipts' label has
-- never existed in the connected mailbox (`label_missing: true` on every run
-- since 2026-08-02), so those invoices were invisible: the poller reported
-- `processed: 0` hourly while receipts kept arriving. This source needs nothing
-- done to the mailbox, which is the point — no label, no filter, no forward.
--
-- SUBJECT-scoped deliberately. The poller ingests the BODY of any listed message
-- with no usable attachment, so a body-wide search would file every email that
-- merely mentions a receipt as a receipt — real documents, real AI spend, and a
-- review board nobody can triage. A vendor invoice names itself in its subject.
-- Blank value = source off. Editable like any settings row; narrow it to
-- `from:billing@vendor.com` once the real senders are known.
insert into system_settings (key, value, description) values
  ('bookkeeping_gmail_receipt_query',
   to_jsonb('subject:(invoice OR receipt OR "payment received" OR "payment confirmation" OR "your order")'::text),
   'Gmail search for the receipt poller''s vendor watch — mail that is neither labelled nor forwarded. Blank disables it. The poller always appends -in:sent -in:chats and a bounded newer_than:.')
on conflict (key) do nothing;

-- A rolling window in DAYS, not a fixed `after:` date like the forwarder watch:
-- this source is far broader than a named-address one, and a fixed cutoff
-- silently widens forever as it ages. The route clamps it to 1..365, so this
-- source can never walk the whole mailbox however the row is edited.
insert into system_settings (key, value, description) values
  ('bookkeeping_gmail_receipt_query_window_days',
   '45'::jsonb,
   'Rolling window (days) for the receipt poller''s vendor watch. Clamped to 1-365; invalid or absent falls back to 45.')
on conflict (key) do nothing;
