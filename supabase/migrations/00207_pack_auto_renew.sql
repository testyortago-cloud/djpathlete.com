-- 00207_pack_auto_renew.sql — automatic pack renewal against a saved card
-- NOTE: written but NOT applied to the live DB until approved.
-- auto_renew lives on the PACK because the consent captured is "when THIS pack
-- runs out, buy another". A renewal pack inherits the flag from its source.
-- The unique (source_package_id) below is the double-charge guard: the insert
-- IS the lock, exactly as unique (scheduled_session_id, kind) is for 00178.

alter table public.client_packages
  add column if not exists auto_renew boolean not null default false,
  add column if not exists renewed_from_package_id uuid references public.client_packages(id) on delete set null,
  add column if not exists renewal_attempted_at timestamptz;

create table if not exists public.pack_renewal_attempts (
  id uuid primary key default gen_random_uuid(),
  source_package_id uuid not null references public.client_packages(id) on delete cascade,
  new_package_id uuid references public.client_packages(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  billing_user_id uuid not null references public.users(id) on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','skipped')),
  stripe_payment_intent_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (source_package_id)
);

create index if not exists idx_pack_renewal_attempts_user
  on public.pack_renewal_attempts(user_id, status);
create index if not exists idx_client_packages_auto_renew
  on public.client_packages(status, auto_renew) where auto_renew = true;

alter table public.pack_renewal_attempts enable row level security;
-- No client read policy, matching session_fee_charges: renewals are coach-managed
-- and the client sees the charge on their statement and in the receipt email.
