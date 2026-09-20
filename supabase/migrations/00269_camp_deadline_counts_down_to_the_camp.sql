-- 00269 — camp_clinic_deadline counts down to the camp (Lead Engine gap G11)
--
-- WHAT CHANGES. The three `wait` steps in `camp_clinic_deadline` stop counting
-- days from the moment somebody signed up and start counting days back from
-- the camp's own start date. Nothing else moves: no step is added, removed or
-- repositioned, and not one word of the copy is touched.
--
-- WHY IT IS ONLY THE WAITS, which is the whole reason this migration is three
-- UPDATEs and a check instead of a rebuild. The sequence ALREADY alternates
-- email / wait / email / wait / email / wait / email / stop. The countdown
-- this row asks for needs exactly that shape, so the reseed is a change of
-- three numbers. No INSERT, no DELETE, no position shuffle — which also means
-- no `sequence_messages` row is cascaded away (`sequence_messages_step_id_fkey`),
-- the failure mode the sequence editor has a guard for.
--
-- STEP 0 DELIBERATELY STAYS IMMEDIATE, and this is the thing to read twice.
-- The ledger row describes the sequence as "14 / 7 / 3 / 1 days before", which
-- reads as four countdown reminders. It is not: step 0 is "About the camp you
-- asked about" — *"Thanks for putting your name down. Your place isn't held
-- yet..."* — an ACKNOWLEDGEMENT of the signup, not a deadline reminder. Putting
-- a 14-day wait in front of it would mean somebody who registers interest four
-- months out hears nothing at all for three and a half months, having just
-- been told their place is not held. So the acknowledgement stays instant and
-- the three CHASERS become the countdown.
--
-- THE MAPPING, and why each one:
--   position 1  2880 min (2 days)  ->  14 days before
--       gates "What a day there looks like" — the informational one, which
--       wants to arrive while there is still time to decide.
--   position 3  5760 min (4 days)  ->   7 days before
--       gates "Places are limited" — urgency, a week out.
--   position 5  5760 min (4 days)  ->   3 days before
--       gates "Last one about this", which says outright *"I will not keep
--       bringing it up"*. Three days rather than one: it asks the reader to
--       "register properly", and one day before is not enough room to act.
--
-- THE QUOTATION'S FOURTH MOMENT (1 day before) HAS NO EMAIL, and this
-- migration does not invent one. There are four emails and one of them is the
-- acknowledgement, so there are three chasers for four named moments. Writing
-- a fourth is the owner's, not an agent's: G03 signed the copy off AS SEEDED
-- and every word here was drafted by migrations 00253/00255. If the owner
-- wants 14/7/3/1, they write the fourth email and it gets its own migration.
--
-- WAIT_MINUTES IS SET TO NULL, not left beside the new config. The tick
-- ignores `wait_minutes` entirely once `wait_until` is present
-- (lib/automation/sequence-tick.ts), so a leftover 2880 would sit in the row
-- reading like the answer while changing nothing. Migration 00268 widened
-- `sequence_steps_wait_needs_minutes` to permit exactly this — a wait with
-- `wait_until` and no minutes — and still refuses a wait with neither.
--
-- NO RUN IS DISTURBED. Measured on production before writing this:
-- `camp_clinic_deadline` has ZERO runs of any status, ever. There is nothing
-- in flight to re-time, and no `sequence_messages` row references any of
-- these steps.
--
-- WHAT LATE SIGNUPS NOW GET, stated plainly because it is a real behaviour
-- change and not a bug: somebody who registers interest 10 days out gets the
-- acknowledgement instantly, then skips the 14-day reminder (its moment has
-- gone) and joins at 7 days. Under the old enrolment-relative timing they
-- would have received all four spread over 10 days regardless of when the
-- camp actually was. Fewer messages, each one true.
--
-- SCOPED BY KEY, NOT BY ID. `sequences.key` is the stable identifier across
-- the production database and the dev clone; an id read off one is not the
-- same row on the other, which is how a data migration succeeds and matches
-- nothing. The `kind = 'wait'` predicate makes each UPDATE self-checking: if
-- the shape is ever not what this header describes, it matches zero rows
-- rather than rewriting the wrong step.

UPDATE public.sequence_steps st
   SET wait_minutes = NULL,
       config = jsonb_build_object('wait_until', jsonb_build_object('days_before_anchor', 14)),
       updated_at = now()
  FROM public.sequences s
 WHERE s.id = st.sequence_id
   AND s.key = 'camp_clinic_deadline'
   AND st.position = 1
   AND st.kind = 'wait';

UPDATE public.sequence_steps st
   SET wait_minutes = NULL,
       config = jsonb_build_object('wait_until', jsonb_build_object('days_before_anchor', 7)),
       updated_at = now()
  FROM public.sequences s
 WHERE s.id = st.sequence_id
   AND s.key = 'camp_clinic_deadline'
   AND st.position = 3
   AND st.kind = 'wait';

UPDATE public.sequence_steps st
   SET wait_minutes = NULL,
       config = jsonb_build_object('wait_until', jsonb_build_object('days_before_anchor', 3)),
       updated_at = now()
  FROM public.sequences s
 WHERE s.id = st.sequence_id
   AND s.key = 'camp_clinic_deadline'
   AND st.position = 5
   AND st.kind = 'wait';

-- Fails the migration loudly if the sequence was not in the shape this header
-- describes. A data migration that silently matches nothing is the failure
-- this repo has already paid for once, and it is indistinguishable from
-- success in every log.
-- PER SEQUENCE ROW, NOT ACROSS THE TABLE. `sequences` is unique on
-- (business_id, key), and the UPDATEs above are deliberately not
-- business-scoped — every tenant holding the seeded sequence gets re-timed,
-- which is what a white-label product wants. A single table-wide `= 3` would
-- therefore RAISE the day a second business is seeded, having found 6. This
-- checks each row's own step list instead, so it scales with tenants and
-- still catches the shape being wrong for any one of them.
DO $$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    SELECT s.id,
           s.business_id,
           count(*) FILTER (WHERE st.kind = 'wait' AND st.config ? 'wait_until') AS anchored
      FROM public.sequences s
      JOIN public.sequence_steps st ON st.sequence_id = s.id
     WHERE s.key = 'camp_clinic_deadline'
     GROUP BY s.id, s.business_id
    HAVING count(*) FILTER (WHERE st.kind = 'wait' AND st.config ? 'wait_until') <> 3
  LOOP
    RAISE EXCEPTION
      'camp_clinic_deadline (sequence %, business %) should have 3 anchored waits after this migration, found %. That row is not in the shape 00269 expected; inspect it before re-running.',
      offender.id, offender.business_id, offender.anchored;
  END LOOP;
END $$;
