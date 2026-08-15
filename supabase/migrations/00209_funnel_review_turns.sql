-- 00209_funnel_review_turns.sql
--
-- The AI page review stage appends its changes as their OWN turn rather than
-- folding them into the build turn that produced the page.
--
-- That separation is the whole safety argument for letting the reviser rewrite
-- copy. `revertToRevision` already powers "Go back to here" on every restorable
-- turn, so undoing ONLY the polish — while keeping the page the builder made —
-- is one click. Folded into the build turn, the two would be inseparable: an
-- owner who disliked one rewritten headline would have to throw away the whole
-- draft to get it back.
--
-- It also keeps the transcript honest. "The builder wrote this, then the
-- reviewer changed that" is a different story from "the builder wrote this",
-- and a source of 'ai' on both would have told the second one.
--
-- ADDITIVE AND BACKWARDS COMPATIBLE. Every source already written stays legal,
-- so this does not have to be sequenced ahead of the deploy that uses it — a
-- row with source 'review' simply cannot be written until the code that writes
-- one ships.

alter table funnel_step_turns drop constraint if exists funnel_step_turns_source_check;

alter table funnel_step_turns
  add constraint funnel_step_turns_source_check
  check (source = any (array['ai'::text, 'inspector'::text, 'revert'::text, 'review'::text]));
