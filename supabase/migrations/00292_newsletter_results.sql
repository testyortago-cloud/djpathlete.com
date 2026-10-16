-- Newsletter results: what happened to every email of a send, per recipient.
--
-- newsletter_deliveries (00291) held only the retry queue. It now also holds
-- one row per person the blast reached (origin 'send'), so a send's results
-- survive Resend's ~30-day log. Every row that exists today is a retry row.
--
-- WRITERS: functions/src/newsletter-send.ts (each accepted batch),
-- scripts/backfill-newsletter-results.ts (a past send, from Resend's log), and
-- the Resend webhook (app/api/webhooks/resend/route.ts) for the three stamps.
-- READERS: newsletter_delivery_results below, read by lib/db/newsletter-deliveries.ts
-- getNewsletterResults for /admin/newsletter and the newsletter's own page.
alter table public.newsletter_deliveries
  add column if not exists origin text not null default 'retry'
    check (origin in ('send', 'retry')),
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz;

-- The retry's own status line keeps counting retry rows only: a 5,883-person
-- blast must not read "5,883 done" under "Resending to people who missed it".
-- Same columns as 00291, so this replaces in place.
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
where origin = 'retry'
group by business_id, newsletter_id;

-- One row per newsletter: everyone Resend accepted, blast and retry together.
create or replace view public.newsletter_delivery_results
  with (security_invoker = true) as
select
  business_id,
  newsletter_id,
  count(*)::int as recipients,
  count(delivered_at)::int as delivered,
  count(opened_at)::int as opened,
  count(clicked_at)::int as clicked,
  count(bounced_at)::int as bounced,
  count(complained_at)::int as complained
from public.newsletter_deliveries
where status = 'sent'
group by business_id, newsletter_id;
