-- 00178_session_fee_charges.sql — no-show / late-cancel fee charges (off-session)
-- NOTE: written but NOT applied to the live DB until approved.
-- A charge is only ever created + attempted when session_fees_enabled AND the
-- configured amount > 0 AND the client has a saved default card. The unique
-- (scheduled_session_id, kind) guarantees a session is never double-charged.

create table if not exists public.session_fee_charges (
  id uuid primary key default gen_random_uuid(),
  scheduled_session_id uuid not null references public.scheduled_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('no_show','late_cancel')),
  amount_cents int not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','waived')),
  stripe_payment_intent_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (scheduled_session_id, kind)
);
create index if not exists idx_session_fee_charges_user on public.session_fee_charges(user_id, status);

alter table public.session_fee_charges enable row level security;
-- No client read policy: fees are coach-managed; clients see the charge on their card statement.
