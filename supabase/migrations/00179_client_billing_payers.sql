-- 00179_client_billing_payers.sql — household billing: one client's automatic
-- charges (no-show/late-cancel fees + memberships) bill another client's card.
-- NOTE: written but NOT applied to the live DB until approved.
-- A row means client_user_id's automatic charges route to payer_user_id's Stripe
-- customer + default card. No row = the client pays for themselves. Resolution is
-- one hop (a payer's own payer is ignored), and self-reference is forbidden.

create table if not exists public.client_billing_payers (
  client_user_id uuid primary key references public.users(id) on delete cascade,
  payer_user_id uuid not null references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_billing_payers_no_self check (client_user_id <> payer_user_id)
);
create index if not exists idx_client_billing_payers_payer on public.client_billing_payers(payer_user_id);

create trigger set_updated_at before update on public.client_billing_payers
  for each row execute function public.update_updated_at();

alter table public.client_billing_payers enable row level security;
-- Clients may see who pays for them; writes are service-role only.
create policy client_billing_payers_own_read on public.client_billing_payers
  for select using (auth.uid() = client_user_id or auth.uid() = payer_user_id);
