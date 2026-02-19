create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_password_reset_tokens_token on public.password_reset_tokens(token);
create index idx_password_reset_tokens_user_id on public.password_reset_tokens(user_id);

alter table public.password_reset_tokens enable row level security;
create policy "Service role only" on public.password_reset_tokens for all using (false);
