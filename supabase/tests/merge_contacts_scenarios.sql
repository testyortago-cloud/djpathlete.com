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

ROLLBACK;
