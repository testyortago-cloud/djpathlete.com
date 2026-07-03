-- 00177_session_memberships.sql — recurring "auto-withdrawal" memberships for in-person sessions
-- NOTE: written but NOT applied to the live DB until approved.
-- Reuses the Stripe subscription engine (mode:"subscription") via a
-- metadata.type = "session_membership"; the webhook writes client_memberships
-- (parallel to program `subscriptions`, but pointed at a membership plan).

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents int not null check (price_cents >= 0),
  billing_interval text not null default 'month' check (billing_interval in ('week','month')),
  sessions_per_period int check (sessions_per_period is null or sessions_per_period > 0),
  stripe_price_id text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan_id uuid references public.membership_plans(id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_customer_id text,
  status text not null default 'incomplete'
    check (status in ('active','past_due','canceled','unpaid','incomplete','trialing','paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_client_memberships_user on public.client_memberships(user_id, status);

create trigger set_updated_at before update on public.membership_plans
  for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.client_memberships
  for each row execute function public.update_updated_at();

alter table public.client_memberships enable row level security;
create policy client_memberships_own_read on public.client_memberships
  for select using (auth.uid() = user_id);
