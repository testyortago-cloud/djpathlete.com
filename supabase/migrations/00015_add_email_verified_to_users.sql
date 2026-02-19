alter table public.users add column if not exists email_verified boolean not null default false;

-- Mark existing users as verified (they were created before this feature)
update public.users set email_verified = true;

create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_email_verification_tokens_token on public.email_verification_tokens(token);

alter table public.email_verification_tokens enable row level security;
create policy "Service role only" on public.email_verification_tokens for all using (false);
