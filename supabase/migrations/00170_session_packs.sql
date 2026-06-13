-- 00170_session_packs.sql — in-person session-pack credit tracking
-- NOTE: written but NOT applied to the live DB until approved.
-- Uses the canonical public.update_updated_at() trigger fn (00012) and mirrors
-- the notifications RLS style (00011). All access in-app is via the service-role
-- client which bypasses RLS; policies are defense-in-depth.

-- ─── Catalogue of sellable packs ─────────────────────────────────────────────
create table if not exists public.session_pack_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session_type text not null,
  credits int not null check (credits > 0),
  price_cents int not null check (price_cents >= 0),
  validity_days int check (validity_days is null or validity_days > 0),
  stripe_price_id text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Purchased balance hanging off a client ──────────────────────────────────
create table if not exists public.client_packages (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid references public.session_pack_products(id) on delete set null,
  session_type text not null,
  credits_total int not null check (credits_total > 0),
  credits_used int not null default 0 check (credits_used >= 0),
  price_cents int not null check (price_cents >= 0),
  payment_method text not null default 'stripe' check (payment_method in ('stripe','cash','comp')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','not_required','refunded')),
  stripe_session_id text,
  stripe_payment_id text,
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','depleted','expired','refunded','cancelled')),
  last_reminded_threshold text check (last_reminded_threshold in ('low','empty','expiring')),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_client_packages_client on public.client_packages(client_user_id, status);
create index if not exists idx_client_packages_status_expiry on public.client_packages(status, expires_at);

-- ─── Append-only attendance ledger ───────────────────────────────────────────
create table if not exists public.session_checkins (
  id uuid primary key default gen_random_uuid(),
  client_package_id uuid not null references public.client_packages(id) on delete cascade,
  client_user_id uuid not null references public.users(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  session_date date not null default current_date,
  method text not null default 'coach_tap' check (method in ('qr_self','coach_tap','manual')),
  credit_delta int not null default -1,
  voided boolean not null default false,
  voided_reason text,
  voided_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  calendar_event_id text,
  created_by uuid references public.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_session_checkins_package on public.session_checkins(client_package_id) where voided = false;
create index if not exists idx_session_checkins_client on public.session_checkins(client_user_id, checked_in_at desc);

-- ─── updated_at triggers ─────────────────────────────────────────────────────
create trigger set_updated_at before update on public.session_pack_products
  for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.client_packages
  for each row execute function public.update_updated_at();

-- ─── RLS (defense-in-depth; app uses service-role which bypasses these) ───────
alter table public.session_pack_products enable row level security;
alter table public.client_packages enable row level security;
alter table public.session_checkins enable row level security;

create policy "Admins manage pack products" on public.session_pack_products for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
create policy "Anyone can read active pack products" on public.session_pack_products for select using (is_active = true);

create policy "Clients view own packages" on public.client_packages for select using (client_user_id = auth.uid());
create policy "Admins manage all packages" on public.client_packages for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

create policy "Clients view own checkins" on public.session_checkins for select using (client_user_id = auth.uid());
create policy "Admins manage all checkins" on public.session_checkins for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
