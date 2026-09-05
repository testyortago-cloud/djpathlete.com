-- supabase/migrations/00251_business_domains_platform_seed.sql
-- Tenancy phase 4: the platform's own hosts become rows.
--
-- business_domains (00240) has had no reader and no rows. lib/tenancy/public.ts
-- now reads it by the request's Host, so the two hosts production answers on
-- are seeded here for the platform business. `host` is a plain UNIQUE
-- constraint, so ON CONFLICT (host) is inferable and a re-run is a no-op.
--
-- THE RACE. On push to main this applies while Vercel is still building. Old
-- code + these rows: ignored. New code + no rows yet: lib/tenancy/public.ts
-- warns once and serves the platform. Both orders serve the platform, because
-- the platform is the only business; there is no window with a different answer.
--
-- verified_at is set: both hosts are live on Vercel today (darrenjpaul.com
-- answers 307 to www; www answers 200). vercel_domain_id stays null — it has
-- no reader, and a value nothing reads is a labelling gap, not data.

insert into public.business_domains (business_id, host, kind, verified_at)
values
  ('00000000-0000-0000-0000-000000000001', 'www.darrenjpaul.com', 'primary', now()),
  ('00000000-0000-0000-0000-000000000001', 'darrenjpaul.com',     'alias',   now())
on conflict (host) do nothing;
