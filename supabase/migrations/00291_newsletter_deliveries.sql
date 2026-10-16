-- The newsletter retry queue: one row per subscriber a newsletter send FAILED
-- to reach, drained in small batches during the tenant's working hours.
--
-- Why it exists: the send keeps no per-recipient record, so a failed batch
-- was lost for good. On 2026-10-09 "Awareness before Action" reached 1,100 of
-- 5,883 subscribers; batch 12 onward answered 429 daily_quota_exceeded and the
-- other 4,783 were never sent.
--
-- WRITERS: functions/src/newsletter-send.ts (a batch Resend refused),
-- scripts/enqueue-newsletter-retry.ts (a past send, rebuilt by hand),
-- lib/db/newsletter-deliveries.ts (the drain, and the Resend webhook's
-- bounce and complaint arms). READERS: lib/automation/newsletter-retry.ts
-- (the drain and its brake) and the /admin/newsletter list's status line.
-- Service role only.
create table if not exists public.newsletter_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  newsletter_id uuid not null references public.newsletters(id) on delete cascade,
  email text not null,
  -- pending: waiting for a working-hours slot.
  -- sending: claimed by a batch whose outcome is not confirmed yet. The next
  --   tick resends the SAME rows under the SAME batch_key, so Resend's
  --   idempotency answers instead of sending twice.
  -- sent: Resend accepted it. failed: refused on its own (a 422 for one row).
  -- skipped: unsubscribed before its turn.
  -- paused: stopped for a person to look at; last_error says why.
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'paused')),
  -- Spent by 422 refusals only. Each one halves the next batch these rows
  -- are sent in, so one bad address isolates itself instead of failing 99.
  attempts integer not null default 0,
  last_error text,
  -- The Idempotency-Key of the batch that claimed the row, and when.
  batch_key text,
  claimed_at timestamptz,
  -- Resend's email id; the webhook matches bounces and complaints on it.
  provider_message_id text,
  sent_at timestamptz,
  -- A PERMANENT bounce only (see app/api/webhooks/resend/route.ts).
  bounced_at timestamptz,
  -- A spam complaint.
  complained_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsletter_id, email)
);

create index if not exists idx_newsletter_deliveries_pending
  on public.newsletter_deliveries(business_id, created_at) where status = 'pending';
create index if not exists idx_newsletter_deliveries_sending
  on public.newsletter_deliveries(business_id) where status = 'sending';
create index if not exists idx_newsletter_deliveries_provider_message
  on public.newsletter_deliveries(provider_message_id) where provider_message_id is not null;

alter table public.newsletter_deliveries enable row level security;
create policy "Service role only" on public.newsletter_deliveries for all using (false);

create trigger set_updated_at before update on public.newsletter_deliveries
  for each row execute function public.update_updated_at();

-- One row per newsletter with a queue. The status line and the drain read
-- counts from here because a select of the rows themselves stops at
-- PostgREST's 1,000-row cap, and one retry alone is 4,783 rows.
-- security_invoker keeps the table's RLS in force for anyone but the service role.
create or replace view public.newsletter_delivery_summary
  with (security_invoker = true) as
select
  business_id,
  newsletter_id,
  (count(*) filter (where status = 'pending'))::int as pending,
  (count(*) filter (where status = 'sending'))::int as sending,
  (count(*) filter (where status = 'sent'))::int as sent,
  (count(*) filter (where status = 'failed'))::int as failed,
  (count(*) filter (where status = 'skipped'))::int as skipped,
  (count(*) filter (where status = 'paused'))::int as paused,
  count(bounced_at)::int as bounced,
  count(complained_at)::int as complained,
  max(last_error) filter (where status = 'paused') as pause_reason
from public.newsletter_deliveries
group by business_id, newsletter_id;
