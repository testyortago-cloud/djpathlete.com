-- 00254 — make `tag` and `stage` sequence steps real.
--
-- Two independent changes that have to travel together, because the second is
-- what lets the first do anything.
--
-- 1. sequence_steps.config gets the same per-kind guard `branch` already has.
--    00216 enforces `sequence_steps_branch_needs_condition`, so a branch step
--    physically cannot be stored without its condition. `tag` and `stage` have
--    had no equivalent because nothing read their config. Now something does.
--
--    Safe to add unconditionally: read from production on 2026-09-07, there are
--    ZERO tag steps, ZERO stage steps, and every config is '{}'. No existing
--    row can violate either constraint.
--
-- 2. opportunity_stage_events.trigger gains 'sequence' and 'quiz'.
--
--    'sequence' is new: a card moved by a sequence step needs its own
--    provenance, and it must not borrow 'manual', because 00219's own comment
--    says a close is FINAL exactly when closed_trigger = 'manual' and
--    decideMove reads it to suppress later automated moves.
--
--    'quiz' is a BUG FIX. lib/lead-engine/pipeline-move.ts has returned
--    trigger: 'quiz' since the quiz shipped, and MoveTrigger declares it, but
--    this constraint never allowed it — so every quiz-driven card insert raised
--    a check violation, which app/api/quiz/submit/route.ts swallows into
--    logFailure. The quiz completed, the contact was created, and the pipeline
--    card silently was not. Zero rows carry that trigger, consistent with the
--    path never once having succeeded.
--
--    A CHECK constraint cannot be widened in place, so it is dropped and
--    re-added. Dropping a constraint drops its attributes with it — this one is
--    a bare CHECK with no NOT VALID and no deferrability, verified against
--    pg_get_constraintdef before the drop, so the re-add below is its complete
--    definition and not a lossy paraphrase.
--
-- opportunities.closed_trigger is deliberately NOT widened. A sequence step may
-- move a card but may never close one, so this path cannot reach that column.

ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_tag_needs_config
  CHECK ((kind <> 'tag') OR (config ? 'tag'));

ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_stage_needs_config
  CHECK ((kind <> 'stage') OR (config ? 'stage'));

ALTER TABLE public.opportunity_stage_events
  DROP CONSTRAINT IF EXISTS opportunity_stage_events_trigger_check;

ALTER TABLE public.opportunity_stage_events
  ADD CONSTRAINT opportunity_stage_events_trigger_check
  CHECK (trigger IN ('booking', 'payment', 'manual', 'reconciler', 'merge', 'quiz', 'sequence'));
