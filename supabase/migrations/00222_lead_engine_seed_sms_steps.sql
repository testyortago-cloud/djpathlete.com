-- supabase/migrations/00222_lead_engine_seed_sms_steps.sql
-- Lead Engine Stage 2: seeded SMS copy for the three DRAFT sequences.
--
-- Design: docs/superpowers/specs/2026-08-21-lead-engine-stage2-sms-design.md §7
--
-- WHY ONLY THREE OF THE FOUR: migration 00218 seeded four sequences, three
-- 'draft' and one 'active' (new_lead_nurture). enrollIfTriggered()
-- (lib/lead-engine/enroll.ts) only reads status = 'active', so the three
-- draft sequences have zero sequence_runs rows — inserting a step and
-- renumbering the rows after it is completely safe there, because nothing
-- is mid-flight to derail. new_lead_nurture is different: it is live, its
-- positions are read by in-flight runs every tick, and a run mid-sequence
-- advances by `current_position + 1` (lib/automation/sequence-tick.ts) — an
-- insert that shifts a stop three positions away from where a paused run
-- last saw it would make that run repeat or skip steps. So new_lead_nurture
-- gets NO live SQL here, only a comment block below: its authored sms body
-- plus the run-safe insertion runbook, to execute the day Twilio clears.
--
-- SHAPE PER SEQUENCE — insert `wait` then `sms` immediately before the
-- existing final `stop`, shifting the stop two positions later:
--
--   | key                      | old stop | new wait | new sms | new stop |
--   |---------------------------|----------|----------|---------|----------|
--   | newsletter_welcome        | 3        | 3        | 4       | 5        |
--   | cold_lead_re_engagement   | 3        | 3        | 4       | 5        |
--   | lead_magnet_delivery      | 4        | 4        | 5       | 6        |
--
-- (lead_magnet_delivery's positions are read from 00218, not guessed: that
-- sequence opens with a wait — see 00218's double-send audit — so its
-- steps run one position later than the other two: 0 wait, 1 email, 2
-- wait, 3 email (the "day-3" email the brief refers to), 4 stop.)
--
-- IDEMPOTENCY MECHANISM (must never shift a stop twice on a re-run):
-- Each stop-shift is a single `UPDATE ... SET position = position + 2
-- WHERE sequence_id = <subselect> AND position = <old literal> AND
-- kind = 'stop'`. The WHERE clause pins the OLD literal position, not a
-- computed one. On the first run the stop is sitting at that old position,
-- so the UPDATE matches and moves it. On any re-run the stop has already
-- moved to old+2, so `position = <old literal>` matches zero rows and the
-- UPDATE is a no-op — it can never fire twice against the same row. The
-- two INSERTs that follow are additionally guarded by `ON CONFLICT
-- (sequence_id, position) DO NOTHING` (00216's unique index), matching
-- 00218's style, so a re-run's inserts no-op too. Ordering matters: the
-- UPDATE runs BEFORE the inserts in each section, so the position the
-- insert targets is guaranteed vacated (by the shift, on a first run) or
-- already occupied by that same insert's own prior run (on a re-run) —
-- never occupied by the stop row, which is exactly what the unique index
-- on (sequence_id, position) would otherwise reject.
--
-- COPY RULES (spec §7): every sms body is plain text, no opt-out sentence
-- (renderSequenceSms in lib/lead-engine/sms.ts appends SMS_OPT_OUT_SENTENCE
-- exactly once at send time — one source, never duplicated in seed copy),
-- and no brand literal (this file is swept by both
-- __tests__/lib/lead-engine/no-brand-literals.test.ts and the mirrored
-- check inside __tests__/lib/lead-engine/seed-sequences.test.ts).
--
-- wait_minutes for the new wait step: newsletter_welcome and
-- cold_lead_re_engagement are given explicit values by the brief (1440 and
-- 4320). lead_magnet_delivery's is not specified there, so 1440 (1 day) is
-- chosen here to mirror newsletter_welcome's short "settle after the last
-- email, then nudge" pattern — the lead_magnet sms is a same-week check-in
-- ("did the download land?"), not a final no-pressure close like
-- cold_lead_re_engagement's 4320 (3 days), so the shorter gap fits its
-- role better.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. newsletter_welcome — stop 3 -> 5; insert 3: wait 1440, 4: sms.
-- -----------------------------------------------------------------------------

UPDATE public.sequence_steps
SET position = position + 2
WHERE sequence_id = (
    SELECT id FROM public.sequences
    WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'newsletter_welcome'
  )
  AND position = 3
  AND kind = 'stop';

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'newsletter_welcome'),
  3, 'wait', 1440, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'newsletter_welcome'),
  4, 'sms', NULL, NULL,
  $body$Hi {{name}} — thanks for joining the newsletter. Expect one useful training idea a week, no filler. Save this number so you know it's us.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. lead_magnet_delivery — stop 4 -> 6; insert 4: wait 1440, 5: sms.
--    (Positions read from 00218: 0 wait, 1 email, 2 wait, 3 email "day-3",
--    4 stop. The sms lands right after the day-3 email, same shift
--    pattern as the other two sequences.)
-- -----------------------------------------------------------------------------

UPDATE public.sequence_steps
SET position = position + 2
WHERE sequence_id = (
    SELECT id FROM public.sequences
    WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'
  )
  AND position = 4
  AND kind = 'stop';

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'),
  4, 'wait', 1440, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'lead_magnet_delivery'),
  5, 'sms', NULL, NULL,
  $body$Hi {{name}} — did the download land? If anything in it raises a question, text back and a real person answers.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. cold_lead_re_engagement — stop 3 -> 5; insert 3: wait 4320, 4: sms.
-- -----------------------------------------------------------------------------

UPDATE public.sequence_steps
SET position = position + 2
WHERE sequence_id = (
    SELECT id FROM public.sequences
    WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'cold_lead_re_engagement'
  )
  AND position = 3
  AND kind = 'stop';

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'cold_lead_re_engagement'),
  3, 'wait', 4320, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'cold_lead_re_engagement'),
  4, 'sms', NULL, NULL,
  $body$Hi {{name}} — no pressure. If getting back to training is still on your mind, reply here and we'll find a time to talk.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- =============================================================================
-- 4. new_lead_nurture (ACTIVE) — SMS COPY DRAFTED, NOT YET INSERTED.
--
-- This sequence has live sequence_runs rows advancing through it right now
-- (or will, the moment funnel submissions start enrolling — trigger_source
-- 'funnel_form', wired since 00218). Its positions are 0 email, 1 wait,
-- 2 email, 3 wait, 4 email, 5 stop, all contiguous, and
-- lib/automation/sequence-tick.ts advances a run to `current_position + 1`
-- after each processed step. Inserting a step here the way the three drafts
-- above were seeded would silently renumber every position after the
-- insert point — a run paused mid-sequence would resume at a position that
-- now means something different, skipping or repeating a step. That is not
-- a risk worth taking with a live audience, so nothing below this line is
-- a statement the database will execute. Every line in this block is a SQL
-- comment; __tests__/lib/lead-engine/seed-sequences.test.ts asserts exactly
-- that (strips `--`-prefixed lines, then checks no reference to
-- new_lead_nurture survives).
--
-- AUTHORED SMS BODY (ready for review; not live until the runbook below
-- runs):
--
--   "{{name}} — quick text to say the email with next steps is in your
--   inbox. If texting is easier, reply here any time."
--
-- Same shift pattern as the three drafts: the new wait lands exactly at the
-- old stop position (5) and the new sms one after it (6), with the stop
-- itself shifting from 5 to 7 — i.e. this sequence has one more content
-- step than the other three, so its stop's old position (5) is higher, but
-- the +2 shift and the "wait then sms land where the stop used to sit"
-- placement are identical in kind. Positions 3 and 4 (the existing wait and
-- email) are NOT touched by this shift at all — they keep their row,
-- content and position exactly as 00218 seeded them.
--
-- RUN-SAFE INSERTION RUNBOOK (execute the day Twilio clears, as its own
-- reviewed migration or an operator script — not as part of this file):
--
--   1. PAUSE the sequence so the tick runner stops advancing any run in it:
--        UPDATE public.sequences SET status = 'paused'
--        WHERE business_id = '00000000-0000-0000-0000-000000000001'
--          AND key = 'new_lead_nurture';
--
--   2. VERIFY no run is mid-window, i.e. every active run is either absent
--      or sitting at a position that will not be touched by the shift.
--      Only the stop itself (position 5) is being renumbered — positions 3
--      and 4 (the existing wait and email) keep their row, content and
--      position exactly as they are — so any run already sitting at
--      position 5 is "mid-window":
--        SELECT count(*) FROM public.sequence_runs
--        WHERE sequence_id = (
--          SELECT id FROM public.sequences
--          WHERE business_id = '00000000-0000-0000-0000-000000000001'
--            AND key = 'new_lead_nurture'
--        )
--        AND status = 'active'
--        AND current_position >= 5;
--      This must return 0 before continuing. If it does not, wait for
--      those runs to advance past position 4 (or complete/exit) and check
--      again — do not renumber under them.
--
--   3. SHIFT + INSERT, same pattern as the three drafts above:
--        UPDATE public.sequence_steps
--        SET position = position + 2
--        WHERE sequence_id = (
--            SELECT id FROM public.sequences
--            WHERE business_id = '00000000-0000-0000-0000-000000000001'
--              AND key = 'new_lead_nurture'
--          )
--          AND position = 5
--          AND kind = 'stop';
--
--        INSERT INTO public.sequence_steps
--          (business_id, sequence_id, position, kind, wait_minutes, subject, body)
--        VALUES (
--          '00000000-0000-0000-0000-000000000001',
--          (SELECT id FROM public.sequences
--           WHERE business_id = '00000000-0000-0000-0000-000000000001'
--             AND key = 'new_lead_nurture'),
--          5, 'wait', 1440, NULL, NULL
--        )
--        ON CONFLICT (sequence_id, position) DO NOTHING;
--
--        INSERT INTO public.sequence_steps
--          (business_id, sequence_id, position, kind, wait_minutes, subject, body)
--        VALUES (
--          '00000000-0000-0000-0000-000000000001',
--          (SELECT id FROM public.sequences
--           WHERE business_id = '00000000-0000-0000-0000-000000000001'
--             AND key = 'new_lead_nurture'),
--          6, 'sms', NULL, NULL,
--          -- body: the authored sms text above, as a $body$-quoted literal
--        )
--        ON CONFLICT (sequence_id, position) DO NOTHING;
--
--   4. REACTIVATE:
--        UPDATE public.sequences SET status = 'active'
--        WHERE business_id = '00000000-0000-0000-0000-000000000001'
--          AND key = 'new_lead_nurture';
--
-- RE-PUBLISH CAVEAT: none applies here. Task 6 verified the consent
-- checkbox markup ships as live application code (funnel form components),
-- not as published funnel content read from a snapshot — so nothing in
-- this runbook, or in the three draft inserts above, requires re-publishing
-- any funnel. This is purely a data operation against sequences and
-- sequence_steps.
-- =============================================================================
