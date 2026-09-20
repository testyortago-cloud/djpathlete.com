-- 00272 — the sequences that should have a text, get one (gap G17)
--
-- WHAT WAS MISSING. Seven active sequences carried no `sms` step at all, so
-- the only channel any of them could reach a person on was email. G18 made
-- texting consent collectable; this puts something there to send.
--
-- SIX, NOT THE SEVEN THE ROW LISTS, AND THE SEVENTH IS THE POINT.
-- `sms_repermission` is deliberately excluded. Read its own seeded body: it is
-- a ONE-TIME EMAIL to an imported contact "whose phone number carries no
-- recorded SMS consent", and it ends "If you'd rather we stick to email only,
-- you don't need to do anything — we won't text you unless you tell us to."
-- A text step in it would message exactly the people who have not agreed,
-- breaking the promise made in the message itself. It has no text step BY
-- DESIGN; the ledger row's list of seven describes the schema, not a to-do
-- list. Production still holds 73 runs on that sequence, so this is not
-- theoretical.
--
-- EVERY TEXT IS PRECEDED BY A `wait`, AND THAT IS NOT A STYLE CHOICE.
-- `business_settings.daily_message_cap` is 1 on production (and 1 is the
-- schema default, 00212). `dailyCapDefer` counts every `sequence_messages`
-- row for that CONTACT today, across all sequences, and defers to local
-- midnight once the count reaches the cap — after which `quietHoursDefer`
-- pushes it to 08:00. So a text placed immediately after an email does not
-- arrive after the email; it arrives the NEXT MORNING.
--
-- An earlier cut of this migration put each text directly after an email, and
-- the quiz text read "Your quiz result is in your email now." It would have
-- arrived the following day, saying "now". Every seeded SMS step already in
-- the product sits after a wait for this reason — `newsletter_welcome`
-- (wait 1440), `new_lead_nurture` (1440), `lead_magnet_delivery` (1440),
-- `cold_lead_re_engagement` (4320) — and `seed-sequences.test.ts` pins that
-- "wait + sms" shape for 00222. This follows it, so the delay is a thing the
-- sequence STATES rather than an artefact of a cap nobody remembered.
--
-- The cost is stated plainly: inserting `wait 1440 + sms` pushes whatever
-- followed out by one day. The quiz's second email moves from day 2 to day 3.
--
-- WHERE EACH TEXT GOES, and each placement is a copy decision as much as a
-- timing one:
--
--   quiz_* (x4)  after the result email. The text is a deliverability
--                backstop — "it went to your email, check spam" — which is
--                why it must come early rather than after the second email.
--   camp         after "Places are limited", NOT after the final email. That
--                last email says "I will not keep bringing it up", and a text
--                after it breaks the promise in the message itself — the same
--                reasoning that excludes sms_repermission above. Placed
--                earlier, the email that promises to stop still comes last.
--   application  after "Still want to talk?", and deliberately NOT a restating
--                of it: the text offers the opposite door ("say so and I will
--                close this off"), so the two messages are not the same ask
--                twice.
--
-- WHY A TEXT STEP IS SAFE TO ADD TO A LIVE SEQUENCE. `decideStep` advances
-- past an `sms` step with the note `no_sms_consent` when the contact has no
-- granted SMS consent row, and `no_phone_number` when there is no number; a
-- suppressed identifier exits the whole run before either. Production has
-- ZERO consent rows of any channel today, so every one of these steps is a
-- no-op until somebody ticks the new box. Nothing here can text anyone who
-- has not asked for it.
--
-- THE COPY IS DRAFTED, NOT AUTHORED — same status as 00253/00255, editable on
-- /admin/sequences/<key> with no deploy. Four rules shaped every line:
--
--   1. NO "Reply STOP" IN THE BODY. `renderSequenceSms` appends
--      `SMS_OPT_OUT_SENTENCE` to every send; writing it in says it twice.
--   2. PLAIN ASCII ONLY. GSM-7 has no em dash, no curly quote, no ellipsis.
--      One of them anywhere forces the WHOLE message to UCS-2, dropping a
--      segment from 153 characters to 67 — a single smart apostrophe roughly
--      triples what every send costs, silently.
--   3. NO `{{name}}`. `substituteName` falls back to the EMPTY STRING, so a
--      nameless contact would read "Hi , your quiz result..." on the channel
--      with the least room to look broken. A merge field also makes the
--      length non-deterministic, and a long name turns a 1-segment message
--      into 2. (The existing seeded texts from 00222 DO use `{{name}}`; this
--      is a deliberate divergence, argued on determinism, not an oversight.)
--   4. SHORT, AND SAYING WHAT TO DO NEXT.
--
--   All four bodies are ONE GSM-7 segment WITH the opt-out sentence appended,
--   counted through the project's own `countSmsSegments` in
--   __tests__/lib/lead-engine/sequence-sms-copy.test.ts — not estimated here.
--
-- POSITIONS SHIFT, SO BRANCH TARGETS AND IN-FLIGHT RUNS BOTH MOVE.
-- The four `quiz_*` sequences carry a `branch` whose `on_true_position` /
-- `on_false_position` are POSITION NUMBERS (6 and 4). Inserting two steps at
-- position 1 renumbers everything after it, so both pointers are rewritten —
-- and the shape guard asserts they were 6 and 4 BEFORE doing so, because a
-- coach who swapped the arms in the editor must not have that edit silently
-- reverted.
--
-- `sequence_runs.current_position` names the NEXT step to execute, so a run
-- past the insertion point moves with the steps. Measured on production: one
-- active run, `quiz_ceiling_breaker` at position 2, which becomes 4 — the same
-- email row it pointed at before.
--
-- THE POSITION PARK. `sequence_steps_position_uniq` is unique on
-- (sequence_id, position), so every renumber goes out to +1000 and comes back.
--
-- ONE TENANT NEVER BLOCKS ANOTHER. A copy edited into a shape this file does
-- not recognise is SKIPPED with a NOTICE. The verification at the end is
-- scoped to the sequences this run actually CONVERTED, so a skipped tenant
-- cannot abort the migration for everybody else — an earlier cut got that
-- wrong, and a single coach's extra step would have failed the deploy.

DO $$
DECLARE
  seq RECORD;
  bad_shape int;
  converted_ids uuid[] := '{}';

  quiz_athlete_body CONSTANT text :=
    'Your quiz result went to your email yesterday. Cannot see it? Check your spam folder. Reply here with any question.';
  quiz_parent_body CONSTANT text :=
    'The athlete''s quiz result went to your email yesterday. Cannot see it? Check your spam. Reply here with a question.';
  camp_body CONSTANT text :=
    'Places at the camp are capped, and registering interest does not hold one. Reply here if you want yours.';
  application_body CONSTANT text :=
    'If the timing is wrong, say so and I will close this off. Otherwise reply here and we will find a slot.';
BEGIN
  -- ---------------------------------------------------------------------
  -- A. The four quiz sequences: wait 1440 + sms at 1 and 2.
  -- ---------------------------------------------------------------------
  FOR seq IN
    SELECT s.id, s.business_id, s.key
      FROM public.sequences s
     WHERE s.key IN ('quiz_aspiring_pro', 'quiz_ceiling_breaker', 'quiz_parent_coach', 'quiz_rebuilder')
  LOOP
    IF EXISTS (SELECT 1 FROM public.sequence_steps WHERE sequence_id = seq.id AND kind = 'sms') THEN
      CONTINUE;
    END IF;

    -- Kinds AND branch pointers. The pointers are part of the shape: a coach
    -- who swapped the arms has made an edit this migration must not revert.
    SELECT count(*) INTO bad_shape
      FROM public.sequence_steps
     WHERE sequence_id = seq.id
       AND (position, kind) NOT IN
           ((0,'email'),(1,'wait'),(2,'email'),(3,'branch'),(4,'email'),(5,'stop'),(6,'email'),(7,'stop'));
    IF bad_shape > 0
       OR (SELECT count(*) FROM public.sequence_steps WHERE sequence_id = seq.id) <> 8
       OR NOT EXISTS (
            SELECT 1 FROM public.sequence_steps
             WHERE sequence_id = seq.id AND kind = 'branch'
               AND on_true_position = 6 AND on_false_position = 4)
    THEN
      RAISE NOTICE '% (sequence %) is not the 8-step quiz shape with a 6/4 branch; skipping.', seq.key, seq.id;
      CONTINUE;
    END IF;

    -- Runs first, while the OLD numbering is still in force. Two steps go in
    -- at 1, so everything from 1 onward slides two slots later.
    UPDATE public.sequence_runs
       SET current_position = current_position + 2, updated_at = now()
     WHERE sequence_id = seq.id AND status = 'active' AND current_position >= 1;

    UPDATE public.sequence_steps SET position = position + 1000 WHERE sequence_id = seq.id;
    UPDATE public.sequence_steps SET position = 0 WHERE sequence_id = seq.id AND position = 1000;
    UPDATE public.sequence_steps SET position = 3 WHERE sequence_id = seq.id AND position = 1001;
    UPDATE public.sequence_steps SET position = 4 WHERE sequence_id = seq.id AND position = 1002;
    UPDATE public.sequence_steps SET position = 5 WHERE sequence_id = seq.id AND position = 1003;
    UPDATE public.sequence_steps SET position = 6 WHERE sequence_id = seq.id AND position = 1004;
    UPDATE public.sequence_steps SET position = 7 WHERE sequence_id = seq.id AND position = 1005;
    UPDATE public.sequence_steps SET position = 8 WHERE sequence_id = seq.id AND position = 1006;
    UPDATE public.sequence_steps SET position = 9 WHERE sequence_id = seq.id AND position = 1007;

    -- The branch moved 3 -> 5, and both targets moved with the steps they
    -- name: the "has an account" arm 6 -> 8, the other 4 -> 6.
    UPDATE public.sequence_steps
       SET on_true_position = 8, on_false_position = 6, updated_at = now()
     WHERE sequence_id = seq.id AND kind = 'branch';

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes)
    VALUES (seq.business_id, seq.id, 1, 'wait', 1440);

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, body)
    VALUES (
      seq.business_id, seq.id, 2, 'sms',
      CASE WHEN seq.key = 'quiz_parent_coach' THEN quiz_parent_body ELSE quiz_athlete_body END
    );

    converted_ids := converted_ids || seq.id;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- B. camp_clinic_deadline: wait 1440 + sms at 5 and 6, after "Places are
  --    limited" and BEFORE the final email that promises to stop.
  -- ---------------------------------------------------------------------
  FOR seq IN
    SELECT s.id, s.business_id, s.key FROM public.sequences s WHERE s.key = 'camp_clinic_deadline'
  LOOP
    IF EXISTS (SELECT 1 FROM public.sequence_steps WHERE sequence_id = seq.id AND kind = 'sms') THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO bad_shape
      FROM public.sequence_steps
     WHERE sequence_id = seq.id
       AND (position, kind) NOT IN
           ((0,'email'),(1,'wait'),(2,'email'),(3,'wait'),(4,'email'),(5,'wait'),(6,'email'),(7,'stop'));
    IF bad_shape > 0
       OR (SELECT count(*) FROM public.sequence_steps WHERE sequence_id = seq.id) <> 8
       OR EXISTS (
            SELECT 1 FROM public.sequence_steps
             WHERE sequence_id = seq.id
               AND (on_true_position IS NOT NULL OR on_false_position IS NOT NULL))
    THEN
      RAISE NOTICE '% (sequence %) is not the 8-step camp shape, or carries branch targets; skipping.', seq.key, seq.id;
      CONTINUE;
    END IF;

    UPDATE public.sequence_runs
       SET current_position = current_position + 2, updated_at = now()
     WHERE sequence_id = seq.id AND status = 'active' AND current_position >= 5;

    UPDATE public.sequence_steps SET position = position + 1000 WHERE sequence_id = seq.id;
    UPDATE public.sequence_steps SET position = 0 WHERE sequence_id = seq.id AND position = 1000;
    UPDATE public.sequence_steps SET position = 1 WHERE sequence_id = seq.id AND position = 1001;
    UPDATE public.sequence_steps SET position = 2 WHERE sequence_id = seq.id AND position = 1002;
    UPDATE public.sequence_steps SET position = 3 WHERE sequence_id = seq.id AND position = 1003;
    UPDATE public.sequence_steps SET position = 4 WHERE sequence_id = seq.id AND position = 1004;
    UPDATE public.sequence_steps SET position = 7 WHERE sequence_id = seq.id AND position = 1005;
    UPDATE public.sequence_steps SET position = 8 WHERE sequence_id = seq.id AND position = 1006;
    UPDATE public.sequence_steps SET position = 9 WHERE sequence_id = seq.id AND position = 1007;

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes)
    VALUES (seq.business_id, seq.id, 5, 'wait', 1440);

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, body)
    VALUES (seq.business_id, seq.id, 6, 'sms', camp_body);

    converted_ids := converted_ids || seq.id;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- C. service_application_received: wait 1440 + sms at 5 and 6, after the
  --    last email, offering the opposite door rather than repeating it.
  -- ---------------------------------------------------------------------
  FOR seq IN
    SELECT s.id, s.business_id, s.key FROM public.sequences s WHERE s.key = 'service_application_received'
  LOOP
    IF EXISTS (SELECT 1 FROM public.sequence_steps WHERE sequence_id = seq.id AND kind = 'sms') THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO bad_shape
      FROM public.sequence_steps
     WHERE sequence_id = seq.id
       AND (position, kind) NOT IN
           ((0,'wait'),(1,'alert'),(2,'email'),(3,'wait'),(4,'email'),(5,'stop'));
    IF bad_shape > 0
       OR (SELECT count(*) FROM public.sequence_steps WHERE sequence_id = seq.id) <> 6
       OR EXISTS (
            SELECT 1 FROM public.sequence_steps
             WHERE sequence_id = seq.id
               AND (on_true_position IS NOT NULL OR on_false_position IS NOT NULL))
    THEN
      RAISE NOTICE '% (sequence %) is not the 6-step shape 00271 left, or carries branch targets; skipping.', seq.key, seq.id;
      CONTINUE;
    END IF;

    UPDATE public.sequence_runs
       SET current_position = current_position + 2, updated_at = now()
     WHERE sequence_id = seq.id AND status = 'active' AND current_position >= 5;

    UPDATE public.sequence_steps SET position = 7 WHERE sequence_id = seq.id AND position = 5;

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes)
    VALUES (seq.business_id, seq.id, 5, 'wait', 1440);

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, body)
    VALUES (seq.business_id, seq.id, 6, 'sms', application_body);

    converted_ids := converted_ids || seq.id;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- VERIFICATION. Scoped to what this run CONVERTED, so a skipped tenant
  -- cannot fail the deploy for everyone else.
  -- ---------------------------------------------------------------------

  -- 1. Something must actually have been converted. Asserting that a row
  --    EXISTS is not the same thing: every loop can CONTINUE (a coach adds
  --    one step to each sequence and no shape matches) and the migration
  --    would otherwise finish green having done nothing at all.
  IF cardinality(converted_ids) = 0 THEN
    RAISE EXCEPTION '00272 converted nothing. Either every copy has been edited away from the shapes it knows, or it has already run — check before assuming success.';
  END IF;

  -- 2. sms_repermission must STILL have no text step. Asserted rather than
  --    left to the absence of code: it is the one exclusion made on purpose,
  --    and a later edit that "completes the set" would text people who have
  --    explicitly not agreed.
  IF EXISTS (
    SELECT 1 FROM public.sequence_steps st
      JOIN public.sequences s ON s.id = st.sequence_id
     WHERE s.key = 'sms_repermission' AND st.kind = 'sms'
  ) THEN
    RAISE EXCEPTION 'sms_repermission has a text step. That sequence asks by EMAIL for permission to text; a text step in it messages people who have not given it.';
  END IF;

  -- 3. Every converted sequence: exactly one text, exactly one more wait than
  --    it had, and CONTIGUOUS positions from 0. A count alone cannot see a
  --    dropped renumber — that leaves a step stranded at 1004, where
  --    `decideStep` finds nothing at the gap and silently completes the run.
  FOR seq IN
    SELECT s.key, s.id,
           count(*) AS steps,
           count(*) FILTER (WHERE st.kind = 'sms') AS sms_steps,
           min(st.position) AS lo,
           max(st.position) AS hi
      FROM public.sequences s
      JOIN public.sequence_steps st ON st.sequence_id = s.id
     WHERE s.id = ANY (converted_ids)
     GROUP BY s.key, s.id
    HAVING count(*) FILTER (WHERE st.kind = 'sms') <> 1
        OR min(st.position) <> 0
        OR max(st.position) <> count(*) - 1
  LOOP
    RAISE EXCEPTION
      '% (sequence %) ended up with % steps, % text(s), positions %..% — not contiguous from 0, or not exactly one text.',
      seq.key, seq.id, seq.steps, seq.sms_steps, seq.lo, seq.hi;
  END LOOP;

  -- 3b. Every converted text is immediately preceded by a wait. This is the
  --     assertion the whole daily-cap argument rests on, so it is checked
  --     rather than trusted to the three INSERT pairs above staying in step.
  FOR seq IN
    SELECT s.key, s.id, st.position
      FROM public.sequences s
      JOIN public.sequence_steps st ON st.sequence_id = s.id
     WHERE s.id = ANY (converted_ids)
       AND st.kind = 'sms'
       AND NOT EXISTS (
             SELECT 1 FROM public.sequence_steps prev
              WHERE prev.sequence_id = st.sequence_id
                AND prev.position = st.position - 1
                AND prev.kind = 'wait')
  LOOP
    RAISE EXCEPTION
      '% (sequence %) has a text at position % that does not follow a wait. The daily message cap would defer it to the next morning.',
      seq.key, seq.id, seq.position;
  END LOOP;

  -- 3c. The quiz branches specifically, after the two-step shift.
  FOR seq IN
    SELECT s.key, s.id, st.position, st.on_true_position AS t, st.on_false_position AS f
      FROM public.sequences s
      JOIN public.sequence_steps st ON st.sequence_id = s.id
     WHERE s.id = ANY (converted_ids)
       AND st.kind = 'branch'
       AND (st.position <> 5 OR st.on_true_position <> 8 OR st.on_false_position <> 6)
  LOOP
    RAISE EXCEPTION
      '% (sequence %) branch is at position % pointing at %/% — expected position 5 pointing at 8/6 after the shift.',
      seq.key, seq.id, seq.position, seq.t, seq.f;
  END LOOP;

  RAISE NOTICE '00272: added a wait + text to % sequence(s).', cardinality(converted_ids);
END $$;
