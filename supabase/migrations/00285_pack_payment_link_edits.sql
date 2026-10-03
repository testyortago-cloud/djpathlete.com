-- Serialize copy/reissue/price edits of an unpaid pack across server instances.
-- Keeping the original Stripe association during expiry lets completion
-- webhooks still resolve the pack if payment wins the race.
alter table public.client_packages
  add column if not exists payment_link_edit_token text,
  add column if not exists payment_link_edit_expires_at timestamptz;
