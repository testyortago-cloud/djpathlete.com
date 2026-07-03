-- 00176_card_on_file.sql — saved payment methods (card-on-file) for off-session charging
-- NOTE: written but NOT applied to the live DB until approved.
-- users.stripe_customer_id already exists (00055). A card is saved via a Stripe
-- hosted setup-mode Checkout; the webhook stores the payment-method id here.

create table if not exists public.user_payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_payment_method_id text not null unique,
  brand text,
  last4 text,
  exp_month int,
  exp_year int,
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_payment_methods_user on public.user_payment_methods(user_id, is_default);

alter table public.user_payment_methods enable row level security;
create policy user_payment_methods_own_read on public.user_payment_methods
  for select using (auth.uid() = user_id);
