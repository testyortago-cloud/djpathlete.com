-- 00268 — a wait step may say WHEN instead of HOW LONG (Lead Engine gap G11)
--
-- WHY THIS EXISTS AS ITS OWN FILE. `sequence_steps_wait_needs_minutes` has
-- said since 00216 that every `wait` row carries a `wait_minutes`:
--
--   CHECK ((kind <> 'wait') OR (wait_minutes IS NOT NULL))
--
-- That is exactly right for a wait that counts UP from the moment a run
-- reaches it, and it makes an ANCHORED wait unstorable. An anchored wait
-- (00267) says "three days before the camp" — a moment, not a duration — and
-- has no number of minutes to give, because the answer depends on when the
-- person enrolled. Without this widening the whole feature is unreachable
-- through the editor: `save_sequence_steps` would refuse the save, and the
-- refusal would surface as an unexplained 500.
--
-- IT IS A WIDENING, NEVER A DROP. Every row that satisfied the old CHECK
-- satisfies the new one — the first two arms are unchanged and a third is
-- added. Nothing is relaxed for an ordinary wait: one with neither
-- `wait_minutes` nor `wait_until` is still refused, which is the case the
-- constraint was written for.
--
-- DROP-THEN-ADD UNDER THE SAME NAME, and the name matters. Callers and
-- comments refer to `sequence_steps_wait_needs_minutes` by name (see
-- __tests__/lib/lead-engine/step-list.test.ts, which cites it in prose), and
-- a renamed constraint would leave those references pointing at nothing.
-- Postgres has no ALTER ... CHECK, so drop-and-add is the only route; both
-- statements run in one transaction, so there is no instant where the table
-- is unprotected.
--
-- `config ? 'wait_until'` tests for KEY PRESENCE only, deliberately. The
-- database is not the right place to validate the shape of that object —
-- `parseWaitConfig` (lib/lead-engine/step-config.ts) is, and it is shared by
-- the editor and the tick precisely so the two cannot drift. A CHECK that
-- also tried to read `days_before_anchor` would be a third validator, and the
-- one nobody could change without a migration.
--
-- THE MATCHING APPLICATION RULE is `validateStepList` (lib/lead-engine/step-list.ts),
-- which now accepts a wait carrying EITHER a positive `wait_minutes` OR a
-- readable `wait_until`, and rejects a malformed `wait_until` even when
-- `wait_minutes` is set — the tick ignores `wait_minutes` once `wait_until`
-- is present, so forgiving the anchor because the old column happens to be
-- filled in would save a step that sends at a time nobody chose.

ALTER TABLE public.sequence_steps
  DROP CONSTRAINT IF EXISTS sequence_steps_wait_needs_minutes;

ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_wait_needs_minutes
  CHECK (
    kind <> 'wait'
    OR wait_minutes IS NOT NULL
    OR config ? 'wait_until'
  );

COMMENT ON CONSTRAINT sequence_steps_wait_needs_minutes ON public.sequence_steps IS
  'A wait step must say either HOW LONG (wait_minutes, counting up from when the run reached it) or WHEN (config.wait_until, counting down to sequence_runs.anchor_at — G11, migration 00267). Key presence only: the shape of wait_until is validated by parseWaitConfig, shared by the step editor and the tick.';
