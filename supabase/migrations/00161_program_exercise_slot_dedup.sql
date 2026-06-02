-- 00161_program_exercise_slot_dedup.sql
--
-- Guard against "doubled day" corruption in program_exercises, where two
-- exercises end up sharing the same slot (program_id, week_number,
-- day_of_week, order_index). Observed cause: a second day-design inserted onto
-- a day that already had one (week/day regeneration, copy, append, or a
-- malformed architect skeleton), producing one calendar day with two stacked
-- workouts and duplicate order_index values.
--
-- A hard UNIQUE constraint is intentionally NOT used: the program builder
-- reorders exercises via parallel, independent PATCHes that transiently place
-- two rows at the same order_index, which a unique constraint would reject and
-- break drag-and-drop. Instead this is a SOFT, INSERT-only guard that renumbers
-- a colliding insert to the next free slot. Reorder UPDATEs are untouched.
--
-- Steps:
--   1. Re-sequence order_index in any day that currently has collisions
--      (content-preserving: no exercise is added or removed).
--   2. Add a supporting (non-unique) index on the slot tuple.
--   3. Install a BEFORE INSERT trigger that auto-bumps colliding inserts.

-- ── 1. Re-sequence existing collisions ────────────────────────────────────
-- For every (program, week, day) that contains a duplicate order_index, densely
-- renumber ALL of that day's rows by their current (order_index, created_at, id)
-- so the relative order is preserved and ties get a stable, distinct position.
with affected as (
  select distinct program_id, week_number, day_of_week
  from program_exercises
  group by program_id, week_number, day_of_week, order_index
  having count(*) > 1
),
ranked as (
  select pe.id,
         row_number() over (
           partition by pe.program_id, pe.week_number, pe.day_of_week
           order by pe.order_index, pe.created_at nulls last, pe.id
         ) - 1 as new_order
  from program_exercises pe
  join affected a
    on a.program_id = pe.program_id
   and a.week_number = pe.week_number
   and a.day_of_week = pe.day_of_week
)
update program_exercises pe
set order_index = ranked.new_order
from ranked
where pe.id = ranked.id
  and pe.order_index is distinct from ranked.new_order;

-- ── 2. Supporting index ────────────────────────────────────────────────────
-- Speeds up the trigger's lookups and the frequent
-- "order by week_number, day_of_week, order_index" reads. Non-unique by design.
create index if not exists idx_program_exercises_slot
  on program_exercises (program_id, week_number, day_of_week, order_index);

-- ── 3. Soft INSERT guard ───────────────────────────────────────────────────
create or replace function program_exercises_dedupe_slot()
returns trigger
language plpgsql
as $$
declare
  next_index int;
begin
  -- If the incoming slot is already occupied for this program/week/day, move
  -- the new row to the next free position (max + 1) instead of colliding.
  -- Verified to also resolve collisions WITHIN a single multi-row INSERT.
  if exists (
    select 1 from program_exercises
    where program_id = NEW.program_id
      and week_number = NEW.week_number
      and day_of_week = NEW.day_of_week
      and order_index = NEW.order_index
  ) then
    select coalesce(max(order_index), -1) + 1 into next_index
    from program_exercises
    where program_id = NEW.program_id
      and week_number = NEW.week_number
      and day_of_week = NEW.day_of_week;
    NEW.order_index := next_index;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_program_exercises_dedupe_slot on program_exercises;
create trigger trg_program_exercises_dedupe_slot
  before insert on program_exercises
  for each row
  execute function program_exercises_dedupe_slot();
