-- A coach's own Trained and Elite standards for the performance tests, optionally
-- per age group, so a 14-year-old is judged against 14-year-olds. A test with no
-- row here keeps the built-in reference range (REFERENCE_RANGES in
-- lib/coach-intel/test-normalization.ts).
--
-- Why it exists: the standards were a constant in code, so the coach (Darren,
-- 2026-10-30) could not find where to enter them, and there was no way to compare
-- a client with people their age.
--
-- Values are in the test's own units; the three 1RM tests are multiples of body
-- weight, as the built-in ranges are. "Better" stays the test's own direction
-- (lower for sprints), so for a sprint floor > trained > elite. The app checks the
-- order on save, since the direction lives in code.
--
-- age_min / age_max NULL = all ages. A client is matched to the narrowest band
-- containing their age, then the all-ages row, then the built-in range.
--
-- WRITER: app/api/admin/performance-standards/route.ts.
-- READERS: lib/db/performance-standards.ts, used by the arena
-- (app/(admin)/admin/clients/[id]/arena) and the shared test report
-- (app/athlete/[token]). Service role only.
create table if not exists public.performance_standards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  test_type text not null,
  age_min integer check (age_min >= 0),
  age_max integer check (age_max >= 0),
  floor_value numeric not null,
  trained_value numeric not null,
  elite_value numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_standards_age_order check (age_min is null or age_max is null or age_min <= age_max)
);

-- One row per business, test and age band (NULL band = all ages).
create unique index if not exists performance_standards_band
  on public.performance_standards (business_id, test_type, coalesce(age_min, -1), coalesce(age_max, -1));

alter table public.performance_standards enable row level security;
create policy "Service role only" on public.performance_standards for all using (false);

create trigger set_updated_at before update on public.performance_standards
  for each row execute function public.update_updated_at();
