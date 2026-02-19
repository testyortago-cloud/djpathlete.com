create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_payment_id text unique,
  stripe_customer_id text,
  amount_cents integer not null,
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  description text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments enable row level security;
create policy "Users can view own payments" on public.payments for select using (user_id = auth.uid());
create policy "Admins can manage all payments" on public.payments for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
