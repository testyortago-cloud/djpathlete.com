-- supabase/migrations/00258_pipeline_inquiry_trigger.sql
-- Lead Engine pipeline boards, phase 1.5 Task B: give the Assessment board a
-- writer. Spec: docs/superpowers/specs/2026-09-08-pipeline-boards-and-routing-design.md §3.2
-- Plan: docs/superpowers/plans/2026-09-08-pipeline-routing-phase-1-5.md, Task B
--
-- Widens opportunity_stage_events.trigger to allow 'inquiry' -- the new
-- MoveTrigger value lib/lead-engine/pipeline-move.ts's decideMove writes for
-- a card opened by an inquiry-form submission (app/api/inquiry/route.ts).
-- Without this, every inquiry-driven insert into opportunity_stage_events
-- raises a CHECK violation the route swallows into a caught, logged error
-- (the same wrapped try/catch a pipeline failure always gets -- an enquiry
-- must never fail because a board write failed) -- so the inquiry itself
-- still succeeds, but the pipeline card silently never appears. Exactly the
-- 'quiz' bug 00254 fixed, one migration number's worth of history later.
--
-- NUMBERED 00258 DELIBERATELY. `ls supabase/migrations` on this branch shows
-- 00257 as the highest, but 00256 is already claimed by feat/sequence-
-- management -- a sibling branch invisible from this checkout that also
-- merges into main. Two branches both taking "the next number" merge cleanly
-- and collide silently; 00258 is the next number free on both.
--
-- Same DROP-before-ADD idempotence pattern 00221 established and 00254
-- reused on this same table: a manual re-apply must not raise 42710 and stop
-- the file half-run. The CHECK body is otherwise identical to 00254's,
-- verified against pg_get_constraintdef before this drop, plus the one new
-- value.

ALTER TABLE public.opportunity_stage_events
  DROP CONSTRAINT IF EXISTS opportunity_stage_events_trigger_check;

ALTER TABLE public.opportunity_stage_events
  ADD CONSTRAINT opportunity_stage_events_trigger_check
  CHECK (trigger IN ('booking', 'payment', 'manual', 'reconciler', 'merge', 'quiz', 'sequence', 'inquiry'));
