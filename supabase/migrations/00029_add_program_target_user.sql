alter table public.programs
  add column target_user_id uuid references public.users(id) on delete set null;
