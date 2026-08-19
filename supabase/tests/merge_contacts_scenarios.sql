-- supabase/tests/merge_contacts_scenarios.sql
--
-- Self-contained scenario coverage for `public.merge_contacts`
-- (supabase/migrations/00217_lead_engine_sequence_functions.sql, replaced
-- wholesale by supabase/migrations/00220_lead_engine_pipeline_merge.sql).
--
-- WHY THIS IS SQL, NOT A VITEST TEST: mergeContacts() in lib/db/contacts.ts
-- (Task 10) is now a single opaque `.rpc("merge_contacts", …)` call — the
-- actual behaviour lives entirely inside this plpgsql function. Asserting it
-- through a JS mock would mean re-implementing the function's logic a
-- second time in the mock and testing that re-implementation instead of the
-- code that ships. The only honest way to test it is against a real
-- Postgres.
--
-- COVERAGE: three behaviours of merge_contacts that Task 1's live
-- verification did not exercise (it used two contacts, never touched
-- user_id, and ran no cross-business case) and that, after Task 10 deleted
-- the JS-level tests that used to cover them via the old REST-round-trip
-- implementation, had no test anywhere:
--   1. Survivor has user_id IS NULL, loser has one -> survivor takes it.
--   2. Both have DIFFERENT non-null user_ids -> survivor keeps its own AND
--      a contact_timeline_events row of kind 'user_id_conflict' is recorded.
--   3. merge_contacts is called with a p_business that does not match the
--      loser's business_id -> the loser is NOT deleted.
--
-- Scenarios 4-6 were added by the branch's fix wave. When BOTH contacts have
-- an active run in the SAME sequence, the function used to always keep the
-- survivor's run and exit the loser's, regardless of progress. If the
-- survivor's run sat at position 0 and the loser's at position 4, the person
-- received steps 0..3 a SECOND time, days apart. sequence_messages_idem is
-- (run_id, step_id), so it cannot stop that — the run ids differ. The rule is
-- now "keep whichever run is further along":
--   4. Loser further along  -> the loser's run survives.
--   5. Tie on position      -> the earlier enrolled_at survives (matching
--                              siblingRunDefer in lib/lead-engine/guardrails.ts,
--                              where the older run holds the right to send).
--   6. Survivor further along -> the survivor's run survives (the original
--                              behaviour, which was only ever right by luck).
-- (Idempotency and contact_consents re-pointing are NOT re-covered here —
-- Task 1's report already verified both live, with before/after row counts
-- and a re-pointed contact_consents row respectively.)
--
-- Scenarios 7-12 were added by Stage 1c Task 2, covering the sixth cascading
-- child (opportunities) and the first_touch_session_id "earliest wins" rule:
--   7. Loser has an open opportunity, survivor has none -> the survivor owns
--      it afterward, still open.
--   8. Both have an open opportunity in the SAME pipeline, loser's stage is
--      further along -> the SURVIVOR's card is closed 'lost' /
--      'merged_into_survivor' / closed_trigger 'merge', and the loser's card
--      survives, re-pointed to the survivor. This is the assertion that
--      fails if someone "simplifies" the contested block to always keep the
--      survivor's card (see the mutation record in the Task 2 report).
--   9. Survivor's first_touch_session_id is NULL, loser's is set -> survivor
--      takes the loser's.
--  10. Both set, loser's marketing_attribution row is older -> survivor takes
--      the loser's.
--  11. Both set, survivor's marketing_attribution row is older -> survivor
--      keeps its own.
--  12. Loser's first_touch_session_id is set but has no marketing_attribution
--      row -> falls back to contacts.created_at, no crash.
--
-- HOW TO RUN (against the throwaway local cluster — see CONTEXT.md):
--   export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
--   <pgcheck.sh helper> 00212 00213 00214 00215 00216 00217 00218 00219 00220   # fresh schema
--   psql -h 127.0.0.1 -p 55433 -U postgres -d mcheck \
--        -v ON_ERROR_STOP=1 -f supabase/tests/merge_contacts_scenarios.sql
--
-- Every scenario RAISEs EXCEPTION on failure, so ON_ERROR_STOP=1 turns any
-- regression into a non-zero psql exit. The whole script runs inside one
-- transaction that is always ROLLBACK'd at the end, so it leaves no residue
-- and is safe to re-run repeatedly against the same database.

BEGIN;

-- Scenario 1: survivor has no user_id, loser does -> survivor carries it.
DO $$
DECLARE
  v_business        uuid := '00000000-0000-0000-0000-000000000001';
  v_loser_user      uuid;
  v_survivor        uuid;
  v_loser           uuid;
  v_result_user_id  uuid;
BEGIN
  INSERT INTO public.users DEFAULT VALUES RETURNING id INTO v_loser_user;

  INSERT INTO public.contacts (business_id, email, user_id)
    VALUES (v_business, 'scenario1-survivor@example.com', NULL)
    RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164, user_id)
    VALUES (v_business, '+16175551001', v_loser_user)
    RETURNING id INTO v_loser;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario1_user_id_carry');

  SELECT user_id INTO v_result_user_id FROM public.contacts WHERE id = v_survivor;

  IF v_result_user_id IS DISTINCT FROM v_loser_user THEN
    RAISE EXCEPTION 'SCENARIO 1 FAILED: survivor.user_id = %, expected the loser''s % (user_id was not carried over)',
      v_result_user_id, v_loser_user;
  END IF;

  RAISE NOTICE 'SCENARIO 1 PASSED: survivor carried the loser''s user_id';
END $$;

-- Scenario 2: both contacts have DIFFERENT non-null user_ids -> survivor's
-- own user_id must not be overwritten, and the conflict must be recorded
-- rather than silently resolved either way.
DO $$
DECLARE
  v_business         uuid := '00000000-0000-0000-0000-000000000001';
  v_survivor_user    uuid;
  v_loser_user       uuid;
  v_survivor         uuid;
  v_loser            uuid;
  v_result_user_id   uuid;
  v_conflict_count   int;
BEGIN
  INSERT INTO public.users DEFAULT VALUES RETURNING id INTO v_survivor_user;
  INSERT INTO public.users DEFAULT VALUES RETURNING id INTO v_loser_user;

  INSERT INTO public.contacts (business_id, email, user_id)
    VALUES (v_business, 'scenario2-survivor@example.com', v_survivor_user)
    RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164, user_id)
    VALUES (v_business, '+16175551002', v_loser_user)
    RETURNING id INTO v_loser;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario2_user_id_conflict');

  SELECT user_id INTO v_result_user_id FROM public.contacts WHERE id = v_survivor;
  IF v_result_user_id IS DISTINCT FROM v_survivor_user THEN
    RAISE EXCEPTION 'SCENARIO 2 FAILED: survivor.user_id changed to % (expected it to keep its own %, not guess)',
      v_result_user_id, v_survivor_user;
  END IF;

  SELECT count(*) INTO v_conflict_count
    FROM public.contact_timeline_events
   WHERE contact_id = v_survivor AND kind = 'user_id_conflict';
  IF v_conflict_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO 2 FAILED: expected exactly one user_id_conflict timeline row on the survivor, found %',
      v_conflict_count;
  END IF;

  RAISE NOTICE 'SCENARIO 2 PASSED: survivor kept its own user_id and the conflict was recorded';
END $$;

-- Scenario 3: merge_contacts is scoped to a business that does NOT own the
-- loser -> the loser must be left untouched, not deleted.
DO $$
DECLARE
  v_business_a   uuid := '00000000-0000-0000-0000-000000000001';
  v_business_b   uuid;
  v_survivor     uuid;
  v_loser        uuid;
  v_loser_exists boolean;
BEGIN
  INSERT INTO public.businesses (name) VALUES ('Scenario 3 — a different business')
    RETURNING id INTO v_business_b;

  INSERT INTO public.contacts (business_id, email)
    VALUES (v_business_a, 'scenario3-survivor@example.com')
    RETURNING id INTO v_survivor;
  -- The loser belongs to business_b...
  INSERT INTO public.contacts (business_id, phone_e164)
    VALUES (v_business_b, '+16175551003')
    RETURNING id INTO v_loser;

  -- ...but the merge is scoped to business_a.
  PERFORM public.merge_contacts(v_survivor, v_loser, v_business_a, 'scenario3_business_scope');

  SELECT EXISTS(SELECT 1 FROM public.contacts WHERE id = v_loser) INTO v_loser_exists;
  IF NOT v_loser_exists THEN
    RAISE EXCEPTION 'SCENARIO 3 FAILED: loser belonging to a different business was deleted by a merge scoped to another business';
  END IF;

  RAISE NOTICE 'SCENARIO 3 PASSED: a loser outside the merge''s business was left untouched';
END $$;

-- ---------------------------------------------------------------------------
-- Scenarios 4-6: two active runs in the same sequence -> the FURTHER-ALONG
-- run survives the merge. Keeping the wrong one re-sends every step between
-- the two positions to a real person.
-- ---------------------------------------------------------------------------

-- Scenario 4: the LOSER's run is further along -> it is the one that survives.
DO $$
DECLARE
  v_business    uuid := '00000000-0000-0000-0000-000000000001';
  v_sequence    uuid;
  v_survivor    uuid;
  v_loser       uuid;
  v_run_behind  uuid;  -- survivor's, position 0
  v_run_ahead   uuid;  -- loser's, position 4
  v_ahead_status text;
  v_behind_status text;
  v_active_count int;
BEGIN
  INSERT INTO public.sequences (business_id, key, name, status)
    VALUES (v_business, 'scenario4_seq', 'Scenario 4 sequence', 'active')
    RETURNING id INTO v_sequence;

  INSERT INTO public.contacts (business_id, email)
    VALUES (v_business, 'scenario4-survivor@example.com') RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164)
    VALUES (v_business, '+16175551004') RETURNING id INTO v_loser;

  INSERT INTO public.sequence_runs (business_id, sequence_id, contact_id, current_position, status, enrolled_at)
    VALUES (v_business, v_sequence, v_survivor, 0, 'active', now() - interval '1 day')
    RETURNING id INTO v_run_behind;
  INSERT INTO public.sequence_runs (business_id, sequence_id, contact_id, current_position, status, enrolled_at)
    VALUES (v_business, v_sequence, v_loser, 4, 'active', now() - interval '10 days')
    RETURNING id INTO v_run_ahead;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario4_further_along_wins');

  SELECT status INTO v_ahead_status  FROM public.sequence_runs WHERE id = v_run_ahead;
  SELECT status INTO v_behind_status FROM public.sequence_runs WHERE id = v_run_behind;

  IF v_ahead_status <> 'active' THEN
    RAISE EXCEPTION 'SCENARIO 4 FAILED: the run at position 4 is now %, expected it to survive as active. Keeping the position-0 run re-sends steps 0..3 to this person.',
      v_ahead_status;
  END IF;
  IF v_behind_status <> 'exited' THEN
    RAISE EXCEPTION 'SCENARIO 4 FAILED: the lagging run at position 0 is %, expected exited', v_behind_status;
  END IF;

  -- And exactly one active run remains for the survivor in this sequence:
  -- sequence_runs_one_active_per_sequence would have rejected the re-point
  -- otherwise, so this also proves the merge did not silently skip it.
  SELECT count(*) INTO v_active_count FROM public.sequence_runs
   WHERE contact_id = v_survivor AND sequence_id = v_sequence AND status = 'active';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO 4 FAILED: expected exactly 1 active run on the survivor, found %', v_active_count;
  END IF;

  RAISE NOTICE 'SCENARIO 4 PASSED: the further-along run survived the merge';
END $$;

-- Scenario 5: both runs sit at the SAME position -> the earlier enrolled_at
-- survives. Neither would replay a step, so this is about determinism; the
-- direction matches siblingRunDefer, where the older run is the one entitled
-- to send.
DO $$
DECLARE
  v_business   uuid := '00000000-0000-0000-0000-000000000001';
  v_sequence   uuid;
  v_survivor   uuid;
  v_loser      uuid;
  v_run_older  uuid;  -- loser's, enrolled first
  v_run_newer  uuid;  -- survivor's
  v_older_status text;
  v_newer_status text;
BEGIN
  INSERT INTO public.sequences (business_id, key, name, status)
    VALUES (v_business, 'scenario5_seq', 'Scenario 5 sequence', 'active')
    RETURNING id INTO v_sequence;

  INSERT INTO public.contacts (business_id, email)
    VALUES (v_business, 'scenario5-survivor@example.com') RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164)
    VALUES (v_business, '+16175551005') RETURNING id INTO v_loser;

  INSERT INTO public.sequence_runs (business_id, sequence_id, contact_id, current_position, status, enrolled_at)
    VALUES (v_business, v_sequence, v_loser, 2, 'active', now() - interval '30 days')
    RETURNING id INTO v_run_older;
  INSERT INTO public.sequence_runs (business_id, sequence_id, contact_id, current_position, status, enrolled_at)
    VALUES (v_business, v_sequence, v_survivor, 2, 'active', now() - interval '1 hour')
    RETURNING id INTO v_run_newer;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario5_tie_breaks_on_enrolled_at');

  SELECT status INTO v_older_status FROM public.sequence_runs WHERE id = v_run_older;
  SELECT status INTO v_newer_status FROM public.sequence_runs WHERE id = v_run_newer;

  IF v_older_status <> 'active' OR v_newer_status <> 'exited' THEN
    RAISE EXCEPTION 'SCENARIO 5 FAILED: on a position tie expected the older run to survive (older=%, newer=%)',
      v_older_status, v_newer_status;
  END IF;

  RAISE NOTICE 'SCENARIO 5 PASSED: a position tie was broken on enrolled_at';
END $$;

-- Scenario 6: the SURVIVOR's run is further along -> it survives, and the
-- loser's lagging run is exited. This is the pre-fix behaviour, and it is
-- still the right answer in this direction; the scenario exists so a fix that
-- simply inverted the rule cannot pass.
DO $$
DECLARE
  v_business   uuid := '00000000-0000-0000-0000-000000000001';
  v_sequence   uuid;
  v_survivor   uuid;
  v_loser      uuid;
  v_run_ahead  uuid;  -- survivor's, position 6
  v_run_behind uuid;  -- loser's, position 1
  v_ahead_status  text;
  v_behind_status text;
BEGIN
  INSERT INTO public.sequences (business_id, key, name, status)
    VALUES (v_business, 'scenario6_seq', 'Scenario 6 sequence', 'active')
    RETURNING id INTO v_sequence;

  INSERT INTO public.contacts (business_id, email)
    VALUES (v_business, 'scenario6-survivor@example.com') RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164)
    VALUES (v_business, '+16175551006') RETURNING id INTO v_loser;

  INSERT INTO public.sequence_runs (business_id, sequence_id, contact_id, current_position, status, enrolled_at)
    VALUES (v_business, v_sequence, v_survivor, 6, 'active', now() - interval '2 days')
    RETURNING id INTO v_run_ahead;
  INSERT INTO public.sequence_runs (business_id, sequence_id, contact_id, current_position, status, enrolled_at)
    VALUES (v_business, v_sequence, v_loser, 1, 'active', now() - interval '20 days')
    RETURNING id INTO v_run_behind;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario6_survivor_further_along');

  SELECT status INTO v_ahead_status  FROM public.sequence_runs WHERE id = v_run_ahead;
  SELECT status INTO v_behind_status FROM public.sequence_runs WHERE id = v_run_behind;

  IF v_ahead_status <> 'active' OR v_behind_status <> 'exited' THEN
    RAISE EXCEPTION 'SCENARIO 6 FAILED: expected the survivor''s position-6 run to survive and the position-1 run to exit (ahead=%, behind=%)',
      v_ahead_status, v_behind_status;
  END IF;

  RAISE NOTICE 'SCENARIO 6 PASSED: the further-along run survived, in the other direction too';
END $$;

-- ---------------------------------------------------------------------------
-- Scenarios 7-8: opportunities, the sixth cascading child (Stage 1c Task 2).
-- Both use the seeded 'coaching' pipeline from 00219 (consult_booked = position
-- 1, consulted = position 2, both kind 'open').
-- ---------------------------------------------------------------------------

-- Scenario 7: loser has an open opportunity, survivor has none -> the
-- survivor owns it afterward, and it is still open.
DO $$
DECLARE
  v_business  uuid := '00000000-0000-0000-0000-000000000001';
  v_pipeline  uuid;
  v_stage     uuid;
  v_survivor  uuid;
  v_loser     uuid;
  v_opp       uuid;
  v_result_contact uuid;
  v_result_outcome text;
BEGIN
  SELECT id INTO v_pipeline FROM public.pipelines
   WHERE business_id = v_business AND key = 'coaching';
  SELECT id INTO v_stage FROM public.pipeline_stages
   WHERE pipeline_id = v_pipeline AND key = 'consult_booked';

  INSERT INTO public.contacts (business_id, email)
    VALUES (v_business, 'scenario7-survivor@example.com') RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164)
    VALUES (v_business, '+16175551007') RETURNING id INTO v_loser;

  INSERT INTO public.opportunities (business_id, pipeline_id, contact_id, stage_id)
    VALUES (v_business, v_pipeline, v_loser, v_stage)
    RETURNING id INTO v_opp;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario7_opportunity_no_conflict');

  SELECT contact_id, outcome INTO v_result_contact, v_result_outcome
    FROM public.opportunities WHERE id = v_opp;

  IF v_result_contact IS DISTINCT FROM v_survivor THEN
    RAISE EXCEPTION 'SCENARIO 7 FAILED: opportunity.contact_id = %, expected the survivor %',
      v_result_contact, v_survivor;
  END IF;
  IF v_result_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO 7 FAILED: opportunity.outcome = % (expected still open / NULL)',
      v_result_outcome;
  END IF;

  RAISE NOTICE 'SCENARIO 7 PASSED: the survivor owns the loser''s open opportunity, still open';
END $$;

-- Scenario 8: both have an open opportunity in the SAME pipeline, and the
-- LOSER's card is further along (higher stage position) -> the SURVIVOR's
-- card is closed 'lost' / 'merged_into_survivor' / closed_trigger 'merge',
-- and the loser's card survives, re-pointed to the survivor. Keeping the
-- survivor's card unconditionally would either violate
-- opportunities_one_open_per_contact_pipeline on re-point, or (if someone
-- "simplified" the contested CASE to always return the survivor's card)
-- silently drop the loser's more-advanced deal.
DO $$
DECLARE
  v_business       uuid := '00000000-0000-0000-0000-000000000001';
  v_pipeline       uuid;
  v_stage_behind   uuid;  -- consult_booked, position 1
  v_stage_ahead    uuid;  -- consulted, position 2
  v_survivor       uuid;
  v_loser          uuid;
  v_survivor_opp   uuid;  -- position 1, expected to be the one closed
  v_loser_opp      uuid;  -- position 2, expected to survive
  v_survivor_opp_outcome  text;
  v_survivor_opp_reason   text;
  v_survivor_opp_trigger  text;
  v_loser_opp_contact     uuid;
  v_loser_opp_outcome     text;
  v_open_count            int;
BEGIN
  SELECT id INTO v_pipeline FROM public.pipelines
   WHERE business_id = v_business AND key = 'coaching';
  SELECT id INTO v_stage_behind FROM public.pipeline_stages
   WHERE pipeline_id = v_pipeline AND key = 'consult_booked';
  SELECT id INTO v_stage_ahead FROM public.pipeline_stages
   WHERE pipeline_id = v_pipeline AND key = 'consulted';

  INSERT INTO public.contacts (business_id, email)
    VALUES (v_business, 'scenario8-survivor@example.com') RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164)
    VALUES (v_business, '+16175551008') RETURNING id INTO v_loser;

  INSERT INTO public.opportunities (business_id, pipeline_id, contact_id, stage_id)
    VALUES (v_business, v_pipeline, v_survivor, v_stage_behind)
    RETURNING id INTO v_survivor_opp;
  INSERT INTO public.opportunities (business_id, pipeline_id, contact_id, stage_id)
    VALUES (v_business, v_pipeline, v_loser, v_stage_ahead)
    RETURNING id INTO v_loser_opp;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario8_contested_opportunity');

  SELECT outcome, outcome_reason, closed_trigger
    INTO v_survivor_opp_outcome, v_survivor_opp_reason, v_survivor_opp_trigger
    FROM public.opportunities WHERE id = v_survivor_opp;
  SELECT contact_id, outcome INTO v_loser_opp_contact, v_loser_opp_outcome
    FROM public.opportunities WHERE id = v_loser_opp;

  IF v_survivor_opp_outcome IS DISTINCT FROM 'lost' THEN
    RAISE EXCEPTION 'SCENARIO 8 FAILED: survivor''s (less-advanced) opportunity.outcome = %, expected lost',
      v_survivor_opp_outcome;
  END IF;
  IF v_survivor_opp_reason IS DISTINCT FROM 'merged_into_survivor' THEN
    RAISE EXCEPTION 'SCENARIO 8 FAILED: survivor''s opportunity.outcome_reason = %, expected merged_into_survivor',
      v_survivor_opp_reason;
  END IF;
  IF v_survivor_opp_trigger IS DISTINCT FROM 'merge' THEN
    RAISE EXCEPTION 'SCENARIO 8 FAILED: survivor''s opportunity.closed_trigger = %, expected merge',
      v_survivor_opp_trigger;
  END IF;

  IF v_loser_opp_contact IS DISTINCT FROM v_survivor THEN
    RAISE EXCEPTION 'SCENARIO 8 FAILED: loser''s (further-along) opportunity.contact_id = %, expected the survivor % (it should survive, re-pointed)',
      v_loser_opp_contact, v_survivor;
  END IF;
  IF v_loser_opp_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO 8 FAILED: loser''s (further-along) opportunity.outcome = % (expected still open / NULL)',
      v_loser_opp_outcome;
  END IF;

  -- Confirms the re-point never collided with opportunities_one_open_per_contact_pipeline.
  SELECT count(*) INTO v_open_count FROM public.opportunities
   WHERE contact_id = v_survivor AND pipeline_id = v_pipeline AND outcome IS NULL;
  IF v_open_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO 8 FAILED: expected exactly 1 open opportunity for the survivor in this pipeline, found %',
      v_open_count;
  END IF;

  RAISE NOTICE 'SCENARIO 8 PASSED: the further-along card survived, the lagging card was closed as a merge loss';
END $$;

-- ---------------------------------------------------------------------------
-- Scenarios 9-12: first_touch_session_id, the earliest-wins rule (Stage 1c
-- Task 2). This column is the root of campaign-to-revenue reporting, so
-- keeping the wrong one misattributes every dollar of the contact's revenue.
-- ---------------------------------------------------------------------------

-- Scenario 9: survivor's first_touch_session_id is NULL, loser's is set ->
-- survivor takes the loser's, unconditionally (no attribution row needed).
DO $$
DECLARE
  v_business uuid := '00000000-0000-0000-0000-000000000001';
  v_survivor uuid;
  v_loser    uuid;
  v_result   text;
BEGIN
  INSERT INTO public.contacts (business_id, email, first_touch_session_id)
    VALUES (v_business, 'scenario9-survivor@example.com', NULL) RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164, first_touch_session_id)
    VALUES (v_business, '+16175551009', 'sess-scenario9-loser') RETURNING id INTO v_loser;

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario9_first_touch_null_survivor');

  SELECT first_touch_session_id INTO v_result FROM public.contacts WHERE id = v_survivor;

  IF v_result IS DISTINCT FROM 'sess-scenario9-loser' THEN
    RAISE EXCEPTION 'SCENARIO 9 FAILED: survivor.first_touch_session_id = %, expected the loser''s sess-scenario9-loser',
      v_result;
  END IF;

  RAISE NOTICE 'SCENARIO 9 PASSED: survivor with no first touch took the loser''s';
END $$;

-- Scenario 10: both set, the LOSER's marketing_attribution row is older ->
-- survivor takes the loser's session id.
DO $$
DECLARE
  v_business uuid := '00000000-0000-0000-0000-000000000001';
  v_survivor uuid;
  v_loser    uuid;
  v_result   text;
BEGIN
  INSERT INTO public.contacts (business_id, email, first_touch_session_id)
    VALUES (v_business, 'scenario10-survivor@example.com', 'sess-scenario10-survivor')
    RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164, first_touch_session_id)
    VALUES (v_business, '+16175551010', 'sess-scenario10-loser')
    RETURNING id INTO v_loser;

  INSERT INTO public.marketing_attribution (session_id, first_seen_at)
    VALUES ('sess-scenario10-survivor', now() - interval '3 days');
  INSERT INTO public.marketing_attribution (session_id, first_seen_at)
    VALUES ('sess-scenario10-loser', now() - interval '30 days');

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario10_loser_touch_older');

  SELECT first_touch_session_id INTO v_result FROM public.contacts WHERE id = v_survivor;

  IF v_result IS DISTINCT FROM 'sess-scenario10-loser' THEN
    RAISE EXCEPTION 'SCENARIO 10 FAILED: survivor.first_touch_session_id = %, expected the loser''s older sess-scenario10-loser',
      v_result;
  END IF;

  RAISE NOTICE 'SCENARIO 10 PASSED: survivor took the loser''s older first touch';
END $$;

-- Scenario 11: both set, the SURVIVOR's marketing_attribution row is older ->
-- survivor keeps its own.
DO $$
DECLARE
  v_business uuid := '00000000-0000-0000-0000-000000000001';
  v_survivor uuid;
  v_loser    uuid;
  v_result   text;
BEGIN
  INSERT INTO public.contacts (business_id, email, first_touch_session_id)
    VALUES (v_business, 'scenario11-survivor@example.com', 'sess-scenario11-survivor')
    RETURNING id INTO v_survivor;
  INSERT INTO public.contacts (business_id, phone_e164, first_touch_session_id)
    VALUES (v_business, '+16175551011', 'sess-scenario11-loser')
    RETURNING id INTO v_loser;

  INSERT INTO public.marketing_attribution (session_id, first_seen_at)
    VALUES ('sess-scenario11-survivor', now() - interval '90 days');
  INSERT INTO public.marketing_attribution (session_id, first_seen_at)
    VALUES ('sess-scenario11-loser', now() - interval '1 day');

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario11_survivor_touch_older');

  SELECT first_touch_session_id INTO v_result FROM public.contacts WHERE id = v_survivor;

  IF v_result IS DISTINCT FROM 'sess-scenario11-survivor' THEN
    RAISE EXCEPTION 'SCENARIO 11 FAILED: survivor.first_touch_session_id = %, expected it to keep its own older sess-scenario11-survivor',
      v_result;
  END IF;

  RAISE NOTICE 'SCENARIO 11 PASSED: survivor with the older first touch kept its own';
END $$;

-- Scenario 12: loser's first_touch_session_id is set but has NO
-- marketing_attribution row -> falls back to contacts.created_at, no crash.
-- The loser's contact is deliberately created far in the past (older than
-- the survivor's attribution row) so the fallback, not just "did it error",
-- is what decides the outcome.
DO $$
DECLARE
  v_business uuid := '00000000-0000-0000-0000-000000000001';
  v_survivor uuid;
  v_loser    uuid;
  v_result   text;
BEGIN
  INSERT INTO public.contacts (business_id, email, first_touch_session_id)
    VALUES (v_business, 'scenario12-survivor@example.com', 'sess-scenario12-survivor')
    RETURNING id INTO v_survivor;
  -- No marketing_attribution row exists for 'sess-scenario12-loser' at all.
  INSERT INTO public.contacts (business_id, phone_e164, first_touch_session_id, created_at)
    VALUES (v_business, '+16175551012', 'sess-scenario12-loser', now() - interval '365 days')
    RETURNING id INTO v_loser;

  INSERT INTO public.marketing_attribution (session_id, first_seen_at)
    VALUES ('sess-scenario12-survivor', now() - interval '10 days');

  PERFORM public.merge_contacts(v_survivor, v_loser, v_business, 'scenario12_loser_no_attribution_row');

  SELECT first_touch_session_id INTO v_result FROM public.contacts WHERE id = v_survivor;

  IF v_result IS DISTINCT FROM 'sess-scenario12-loser' THEN
    RAISE EXCEPTION 'SCENARIO 12 FAILED: survivor.first_touch_session_id = %, expected the loser''s sess-scenario12-loser (fell back to contacts.created_at)',
      v_result;
  END IF;

  RAISE NOTICE 'SCENARIO 12 PASSED: missing marketing_attribution row fell back to contacts.created_at without crashing';
END $$;

ROLLBACK;
