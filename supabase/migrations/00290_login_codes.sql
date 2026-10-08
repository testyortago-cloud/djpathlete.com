-- Six-digit sign-in codes emailed from /login ("Email me a sign-in code").
-- Read and written only by lib/db/login-codes.ts through the service role.
--
-- No business_id, deliberately: a code belongs to a person's login, and
-- users, password_reset_tokens and email_verification_tokens carry none
-- either. The reader (verifyLoginCode) keys on user_id alone.
create table if not exists public.login_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  -- Wrong tries spent on this code. Claimed before each comparison, so
  -- parallel guesses cannot share one try.
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_codes_user_created on public.login_codes(user_id, created_at desc);

alter table public.login_codes enable row level security;
create policy "Service role only" on public.login_codes for all using (false);
