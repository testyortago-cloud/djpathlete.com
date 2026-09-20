-- 00270 — camp_clinic_deadline's description stops contradicting it (G11)
--
-- WHY THIS IS A SEPARATE FILE FROM 00269. 00269 had already been applied when
-- this was found. Supabase keys an applied migration on its VERSION, so
-- editing that file would leave every database that has already run it
-- holding the old text while the file claimed otherwise — a stale dev clone
-- that looks correct. A new number is the only honest fix.
--
-- WHAT WAS WRONG. Migration 00255 seeded the description as:
--
--   "Chases someone who registered interest in a camp or clinic and has not
--    paid. Runs on relative waits from the moment they registered interest,
--    not on the camp start date -- a run cannot know which camp it belongs
--    to, so the copy never names one."
--
-- Every clause of the middle sentence became false when 00269 re-timed the
-- waits: it now runs on exactly the camp start date, and since G10 a run
-- DOES know which camp it belongs to (`sequence_runs.enrolment_metadata`
-- carries `camp_name`). This string is not an internal note — it is rendered
-- on /admin/sequences, so it is the only description of this sequence a coach
-- ever reads, and it told them the opposite of what the sequence does.
--
-- WHAT THE NEW TEXT PROMISES, and each clause is true of the shipped
-- behaviour rather than of the plan:
--   * the first email is immediate — step 0 is the acknowledgement, and 00269
--     deliberately left it un-anchored;
--   * three reminders at 14 / 7 / 3 days before — the three waits 00269 set;
--   * a late signup skips the ones whose moment has gone — `skipPastAnchoredMoment`
--     in lib/automation/sequence-tick.ts;
--   * somebody with no camp date behind them stops after the first email —
--     the `not_anchored` exit, which is what a hand-enrolled contact gets.
--
-- The copy still never names a camp, so that clause is kept: it is a fact
-- about the emails, and it remains true.
--
-- NOT BUSINESS-SCOPED, for the same reason 00269 is not: every tenant holding
-- the seeded sequence should describe it correctly. Keyed on `sequences.key`,
-- never an id read off one database.
--
-- GUARDED on the old text, so this cannot overwrite a description a coach has
-- since rewritten by hand. If it matches nothing, nothing is changed and
-- nothing is claimed — which is why there is no RAISE here, unlike 00269: a
-- hand-edited description is a legitimate outcome, not a broken shape.

UPDATE public.sequences
   SET description = 'Chases someone who registered interest in a camp or clinic and has not paid. '
                     'The first email goes out straight away. The three after it count down to the '
                     'camp''s own start date -- 14, 7 and 3 days before -- so everyone gets them at '
                     'the same moment, whenever they signed up. Someone who signs up late skips the '
                     'reminders whose moment has already gone. Someone added by hand has no camp '
                     'date, so their follow-up stops after the first email. The copy never names a '
                     'particular camp.',
       updated_at = now()
 WHERE key = 'camp_clinic_deadline'
   AND description LIKE '%Runs on relative waits from the moment they registered interest%';
