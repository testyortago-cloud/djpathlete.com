-- 00263_sequence_reenrol_cooldown.sql
--
-- WHY. `sequence_runs_one_active_per_sequence` (00216) stops a second ACTIVE
-- run of one sequence for one contact, and nothing else. The moment a run
-- completes or exits, the next trigger enrols the same person again. Between
-- 16 and 19 Sept 2026 the daily pack-renewal cron (its re-send columns are
-- 00261) re-fired the
-- `checkout_abandoned` trigger every morning for one paying account holder,
-- who went through the abandoned-checkout nurture twice in four days. The
-- webhook now excludes that checkout type outright; this column is the
-- general rule behind it — a contact who has just finished a sequence stays
-- out of it for a while, whatever fires.
--
-- READER. lib/lead-engine/enroll.ts `enrollIfTriggered` — the only reader
-- that changes behaviour, and the only path it applies to (the admin screen
-- reads it too, only to show and edit it). Manual enrolment (`enrolContactManually`,
-- the admin's "Enrol" control) is a human's say-so and is NOT subject to it;
-- that path keeps its own opt-in one-per-contact-ever check.
--
-- READ WITH `select("*")` in that function, on purpose: it runs on every lead
-- capture, and a deploy that lands before this file applies must not make
-- every enrolment throw. The reader falls back to 30 when the column is
-- absent, which is also the default below.
--
-- THE QUIZ EXCEPTION. The four quiz sequences' first email IS the result the
-- person just asked for. A retake has to get one, so those four are set to 0.
-- Everything else — including the sequences seeded later by 00255 — keeps the
-- default. Editable per sequence on /admin/sequences/<key>.

ALTER TABLE public.sequences
  ADD COLUMN IF NOT EXISTS reenrol_cooldown_days smallint NOT NULL DEFAULT 30
  CONSTRAINT sequences_reenrol_cooldown_days_check
    CHECK (reenrol_cooldown_days >= 0 AND reenrol_cooldown_days <= 365);

UPDATE public.sequences
SET reenrol_cooldown_days = 0
WHERE key LIKE 'quiz\_%';
