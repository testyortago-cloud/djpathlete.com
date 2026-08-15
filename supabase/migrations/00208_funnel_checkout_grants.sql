-- 00208_funnel_checkout_grants.sql
--
-- The idempotency ledger for anonymous purchases made from a funnel page.
--
-- WHY A TABLE AND NOT A COLUMN SOMEWHERE. Stripe retries a webhook for days,
-- and this flow's side effects are not naturally idempotent: it can CREATE A
-- USER, grant a program and send a "set your password" email. Replaying it
-- without a ledger means a second grant and a second password email to someone
-- who has already set one. The Stripe checkout session id is the natural key --
-- one session is one purchase, forever -- so it carries the UNIQUE constraint
-- and the whole design rests on it.
--
-- `lib/funnels/checkout/grant.ts` writes this row AFTER the grant, deliberately:
-- recording first would make a failed grant permanently unretryable, because
-- the replay would stop at the idempotency check.

create table if not exists public.funnel_checkout_grants (
  id uuid primary key default gen_random_uuid(),

  -- The idempotency key. UNIQUE is the actual guard: two webhook deliveries
  -- racing each other both pass the read, and the loser's insert is refused by
  -- the database rather than by application timing.
  stripe_session_id text not null unique,

  -- Who it was granted to. Set null on delete rather than cascade: this row is
  -- a financial record of a payment that happened, and it must survive the
  -- account being removed.
  user_id uuid references public.users(id) on delete set null,

  -- Kept as plain text rather than a FK. The email is what the buyer typed at
  -- Stripe and is the only handle on the purchase if the user row is ever gone.
  email text not null,

  product_kind text not null check (product_kind in ('program')),
  product_id uuid not null,

  -- Which page sold it, for attribution. No FK to funnel_steps: a step can be
  -- deleted and the purchase still happened.
  funnel_id uuid,
  step_id uuid,

  -- The lead captured before checkout, when there was one.
  lead_id uuid,

  -- True when this purchase created the account. Drives whether a set-password
  -- email was owed, and tells the coach whether this was a new customer.
  account_created boolean not null default false,

  created_at timestamptz not null default now()
);

-- "Has this session been processed?" is the hot path, run on every webhook
-- delivery including the retries. The unique constraint already indexes
-- stripe_session_id, so only the reporting reads need help.
create index if not exists funnel_checkout_grants_user_idx
  on public.funnel_checkout_grants (user_id);
create index if not exists funnel_checkout_grants_created_idx
  on public.funnel_checkout_grants (created_at desc);

-- Service-role only. Every reader and writer is a server route or the Stripe
-- webhook; no browser session may see who bought what.
alter table public.funnel_checkout_grants enable row level security;

comment on table public.funnel_checkout_grants is
  'Idempotency ledger for anonymous funnel purchases. One row per completed Stripe checkout session; written after the grant so a failed grant stays retryable.';
