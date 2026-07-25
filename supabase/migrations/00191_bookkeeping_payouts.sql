-- 00191_bookkeeping_payouts.sql
-- Track A (6e): Stripe payout mirror (read model — never a ledger table).
-- amount_cents = Stripe payout `amount` (NET); gross/fee derived from lines.
-- Plain UNIQUEs are the upsert keys (PostgREST onConflict needs plain).
-- Flag arrives OFF; additive, idempotent, inert without code.
-- RLS is ceremony (the DAL uses service-role, which bypasses it) — matches
-- every sibling bookkeeping table since 00183; without it these would be the
-- only anon-key-readable bookkeeping tables.
create table if not exists bookkeeping_payouts (
  id uuid primary key default gen_random_uuid(),
  stripe_payout_id text not null unique,
  book_id uuid not null references bookkeeping_books(id) on delete cascade,
  amount_cents integer not null,
  gross_cents integer not null default 0,
  fee_cents integer not null default 0,
  arrival_date date not null,
  status text not null check (status in ('in_transit','paid','failed','canceled','pending')),
  currency text not null default 'usd',
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bk_payouts_book_arrival on bookkeeping_payouts (book_id, arrival_date);

create table if not exists bookkeeping_payout_lines (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references bookkeeping_payouts(id) on delete cascade,
  stripe_balance_txn_id text not null unique,
  type text not null,
  amount_cents integer not null,
  fee_cents integer not null,
  net_cents integer not null,
  txn_date date not null,
  description text,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bk_payout_lines_txn_date on bookkeeping_payout_lines (txn_date);

alter table bookkeeping_payouts enable row level security;
alter table bookkeeping_payout_lines enable row level security;

drop policy if exists "Admins manage payouts" on bookkeeping_payouts;
create policy "Admins manage payouts" on bookkeeping_payouts for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'));

drop policy if exists "Admins manage payout lines" on bookkeeping_payout_lines;
create policy "Admins manage payout lines" on bookkeeping_payout_lines for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin'));

insert into system_settings (key, value, description) values
  ('cron_bookkeeping_payout_sync_enabled', 'false'::jsonb, 'Enable the nightly Stripe payout ingestion into the bookkeeping payout mirror')
on conflict (key) do nothing;
