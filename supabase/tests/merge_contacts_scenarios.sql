-- supabase/tests/merge_contacts_scenarios.sql
--
-- Self-contained scenario coverage for `public.merge_contacts`
-- (supabase/migrations/00217_lead_engine_sequence_functions.sql).
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
-- HOW TO RUN (against the throwaway local cluster — see CONTEXT.md):
--   export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
--   <pgcheck.sh helper> 00212 00213 00214 00215 00216 00217   # fresh schema
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

ROLLBACK;
