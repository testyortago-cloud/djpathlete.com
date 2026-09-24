-- supabase/migrations/00278_funnel_tenancy.sql
-- G31: the funnel subsystem carries a tenant.
--
-- THIS MIGRATION SHIPS IN ITS OWN PUSH, AHEAD OF THE CODE. apply-migrations.yml
-- runs on push to main while Vercel is still building and nothing sequences the
-- two. Shipping the predicates in the same push would mean 47 readers each
-- tolerating a missing column, and a tolerance path that never turns off is a
-- cross-tenant leak nobody sees. Pushing the schema first costs one extra push
-- and removes that branch entirely.
--
-- THE DEFAULT MUST OUTLIVE THIS DEPLOY. It is what keeps the currently-deployed
-- bundle's inserts from failing 23502 while it is still serving. Dropping it
-- belongs in a LATER branch, once every writer stamps business_id explicitly.
-- It cannot be dropped in a second migration in this branch: the Action applies
-- every pending migration in one run, so the default would never exist during
-- the window it was added for. (00252 recorded this; it is followed, not
-- rediscovered.)
--
-- NOT NULL is safe immediately: Postgres applies a non-volatile default to
-- existing rows during ADD COLUMN without a table rewrite, so the 9 funnels,
-- 10 steps, 2 versions and 198 turns in production are backfilled by the
-- ADD COLUMN itself. No separate backfill statement.

alter table public.funnels
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_steps
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_step_versions
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_step_turns
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_submissions
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_checkout_grants
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.lead_magnets
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

-- Targets for the composite foreign keys below. Postgres requires a unique
-- constraint on the referenced columns.
alter table public.funnels
  add constraint funnels_id_business_id_key unique (id, business_id);
alter table public.funnel_steps
  add constraint funnel_steps_id_business_id_key unique (id, business_id);

-- THE FIVE FK REPLACEMENTS. Each is DROP-then-ADD, never ADD-alongside.
--
-- WHY REPLACE: lib/db/funnel-leads.ts selects
--   "*, funnels:funnel_id (name, slug), funnel_steps:step_id (name)"
-- and PostgREST picks an embed by finding THE foreign key between two tables.
-- With both a simple and a composite FK present it answers PGRST201 ("more
-- than one relationship was found") instead of rows, and the leads inbox goes
-- blank. 00252 hit this exact wall with event_signups and verified on the dev
-- clone that the embed resolves across the composite FK alone.
--
-- ON DELETE CASCADE IS CARRIED ACROSS EVERY ONE, and that is load-bearing:
-- deleteFunnel and deleteStep in lib/db/funnels.ts both rely on the cascade.
-- Dropping the clause here would turn each of them into a
-- foreign_key_violation at runtime, with no test failing at build time.

alter table public.funnel_steps drop constraint funnel_steps_funnel_id_fkey;
alter table public.funnel_steps
  add constraint funnel_steps_funnel_business_fkey
    foreign key (funnel_id, business_id)
    references public.funnels (id, business_id)
    on delete cascade;

alter table public.funnel_step_versions drop constraint funnel_step_versions_step_id_fkey;
alter table public.funnel_step_versions
  add constraint funnel_step_versions_step_business_fkey
    foreign key (step_id, business_id)
    references public.funnel_steps (id, business_id)
    on delete cascade;

alter table public.funnel_step_turns drop constraint funnel_step_turns_step_id_fkey;
alter table public.funnel_step_turns
  add constraint funnel_step_turns_step_business_fkey
    foreign key (step_id, business_id)
    references public.funnel_steps (id, business_id)
    on delete cascade;

alter table public.funnel_submissions drop constraint funnel_submissions_funnel_id_fkey;
alter table public.funnel_submissions
  add constraint funnel_submissions_funnel_business_fkey
    foreign key (funnel_id, business_id)
    references public.funnels (id, business_id)
    on delete cascade;

alter table public.funnel_submissions drop constraint funnel_submissions_step_id_fkey;
alter table public.funnel_submissions
  add constraint funnel_submissions_step_business_fkey
    foreign key (step_id, business_id)
    references public.funnel_steps (id, business_id)
    on delete cascade;

-- Per-tenant slugs. Two coaches both wanting /go/free-guide is the first day of
-- the second tenant, not an edge case.
--
-- Case sensitivity is UNCHANGED on each: funnels stays case-insensitive
-- (lower(slug)), lead_magnets stays case-sensitive. 00252 made the same call
-- for events and said why — reconciling the two is a separate change, not one
-- to smuggle into a tenancy migration.
drop index if exists public.funnels_slug_key;
create unique index funnels_business_id_slug_key
  on public.funnels (business_id, lower(slug));

-- lead_magnets_slug_key is a table UNIQUE constraint (00112: `slug text UNIQUE
-- NOT NULL`), not a bare index like funnels_slug_key above — Postgres refuses
-- `DROP INDEX` on an index a constraint owns ("cannot drop index ... because
-- constraint ... requires it"). Confirmed against pg_constraint on the dev
-- clone (contype='u') before writing this line. DROP CONSTRAINT removes the
-- constraint and its backing index together.
alter table public.lead_magnets drop constraint if exists lead_magnets_slug_key;
create unique index lead_magnets_business_id_slug_key
  on public.lead_magnets (business_id, slug);

create index funnels_business_status_idx
  on public.funnels (business_id, status);
create index funnel_submissions_business_created_idx
  on public.funnel_submissions (business_id, created_at desc);
