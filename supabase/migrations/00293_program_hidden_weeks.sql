-- 00293_program_hidden_weeks.sql
--
-- A coach can hide a week on the program itself, before any client is on it.
-- The week is then hidden from every client on the program, now and later,
-- unless the coach opened it for one client (program_week_access.visibility
-- = 'shown'). Read by lib/programs/week-visibility.ts (weekState/buildWeekGate);
-- written by POST /api/admin/programs/[id]/hidden-weeks and shifted by
-- delete-week, which renumbers later weeks.
--
-- Additive: every existing program gets '{}' (nothing hidden), today's behaviour.

ALTER TABLE public.programs
  ADD COLUMN hidden_weeks integer[] NOT NULL DEFAULT '{}'::integer[],
  ADD CONSTRAINT programs_hidden_weeks_positive CHECK (0 < ALL (hidden_weeks));
