-- 00196_bookkeeping_gmail_forwarders.sql
-- Gmail body receipts (spec 2026-08-02, Decision B-2): addresses whose mail the
-- receipt poller ingests WITHOUT the label. Matched from: OR to: because a
-- manual forward arrives From=the forwarder while a Gmail auto-forward keeps
-- the ORIGINAL sender and only the To: header names the forwarder account.
-- Admin-editable like any settings row; empty array = label-only (old behavior).
insert into system_settings (key, value, description) values
  ('bookkeeping_gmail_receipt_forwarders',
   '["yortago@gmail.com", "testyortago@gmail.com"]'::jsonb,
   'Email addresses (from OR to) whose Gmail messages the receipt poller ingests without needing the label')
on conflict (key) do nothing;
