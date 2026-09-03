-- supabase/migrations/00242_google_ads_accounts_business_id.sql
-- The second singleton. enqueueBookingConversion picks accounts[0] of the
-- active Google Ads accounts, so multi-coach ads attribution was blocked by one
-- line independently of business_id.
--
-- NOT NULL with a singleton DEFAULT, so every existing row is filled by the
-- default and every existing reader -- lib/ads/agent.ts, lib/ads/ga4-audiences.ts,
-- conversions.ts's own value-adjustment path, and the Firebase twin in
-- functions/src/ads/ -- keeps working untouched.

alter table public.google_ads_accounts
  add column if not exists business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id) on delete cascade;

create index if not exists google_ads_accounts_business_id
  on public.google_ads_accounts (business_id);
