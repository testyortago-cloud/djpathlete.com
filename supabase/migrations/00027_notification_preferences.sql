-- Notification preferences for both admins and clients
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- Admin preferences
  notify_new_client boolean not null default true,
  notify_payment_received boolean not null default true,
  notify_program_completed boolean not null default true,
  -- Client preferences
  email_notifications boolean not null default true,
  workout_reminders boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_user_unique unique (user_id)
);

-- RLS
alter table public.notification_preferences enable row level security;

create policy "Users can view own preferences"
  on public.notification_preferences for select
  using (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.notification_preferences for update
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);

-- Service role bypasses RLS, so admin server functions work without extra policies.
