create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  name text not null,
  role text,
  sport text,
  quote text not null,
  avatar_url text,
  rating integer check (rating between 1 and 5),
  is_featured boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.testimonials enable row level security;
create policy "Anyone can view active testimonials" on public.testimonials for select using (is_active = true);
create policy "Admins can manage testimonials" on public.testimonials for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
