create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reviews enable row level security;
create policy "Anyone can view published reviews" on public.reviews for select using (is_published = true);
create policy "Users can manage own reviews" on public.reviews for all using (user_id = auth.uid());
create policy "Admins can manage all reviews" on public.reviews for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
