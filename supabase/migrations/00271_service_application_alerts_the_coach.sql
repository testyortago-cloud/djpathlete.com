-- 00271 — the coach hears when an application goes unanswered (gap G12)
--
-- TWO FAULTS, ONE SHAPE CHANGE.
--
-- 1. THE APPLICANT IS CONFIRMED TWICE. `sendInquiryAutoReply` already emails
--    an instant confirmation the moment an application arrives. This
--    sequence's step 0 ("We have your application") then says the same thing
--    again. Two confirmations for one action reads as a system that has lost
--    count, and it is the first impression a paying enquiry gets.
--
-- 2. NOBODY TELLS THE COACH. The sequence chases the APPLICANT twice and
--    never once tells Darren that somebody applied and has had no reply. The
--    lead-facing nudges go out on schedule whether or not a human has been
--    anywhere near the enquiry.
--
-- THE NEW SHAPE, and it is the same six steps, not a rebuild:
--
--      before                            after
--   0  email "We have your application"  wait 2880   (two days)
--   1  wait 2880                         ALERT       -> business_settings.reply_to
--   2  email "What the first ..."        email "What the first ..."
--   3  wait 5760                         wait 5760
--   4  email "Still want to talk?"       email "Still want to talk?"
--   5  stop                              stop
--
-- The two lead-facing nudges and their waits are untouched, wording and all —
-- G03 signed that copy off. Only the duplicate confirmation is removed and the
-- alert takes its place in the count.
--
-- WHY THE ALERT SITS AFTER THE WAIT, NOT AT POSITION 0. Two days is the grace
-- period. A run that ends because the person booked or bought (`exit_reason`
-- payment / booking) never reaches this step, so the alert cannot nag about
-- somebody who has already converted.
--
-- WHAT THE ALERT CANNOT KNOW, AND WHY ITS WORDING SAYS SO. Nothing in this
-- system exits a run because the COACH REPLIED — there is no such exit reason
-- (`lib/lead-engine/sequence-exit-reasons.ts` enumerates every one that can
-- reach the database, and an outbound reply is not among them), and nothing
-- reads the coach's inbox. So a coach who answers the same afternoon still
-- gets this two days later. An earlier draft of the subject asserted "No
-- reply yet to X's application", which is a statement of fact this code is not
-- in a position to make, and it would be WRONG in exactly the case a diligent
-- coach creates most often — which is how an alert channel gets trained into
-- noise. The subject is therefore a question, and the body says outright that
-- we cannot see their inbox. Making it true rather than merely hedged would
-- need a reply signal that does not exist yet.
--
-- DELETING STEP 0 IS SAFE HERE, AND IT WAS CHECKED RATHER THAN ASSUMED.
-- `sequence_messages_step_id_fkey` cascades, so removing a step that has ever
-- sent anything destroys the record of real messages to real people — the
-- exact reason `save_sequence_steps` refuses that in the editor. Measured on
-- production before writing this: `service_application_received` has sent
-- ZERO messages from ANY of its steps, so nothing is destroyed. The guard
-- below re-checks it at run time rather than trusting this paragraph.
--
-- THE POSITION SHUFFLE GOES VIA A TEMPORARY RANGE. There is a unique index on
-- (sequence_id, position) — `sequence_steps_position_uniq` — so renumbering
-- in place collides the moment two steps want the same slot mid-statement.
-- Everything moves to position + 1000 first, then down into its final slot.
--
-- NOT BUSINESS-SCOPED, keyed on `sequences.key`, for the reason 00269 gives:
-- every tenant holding the seeded sequence should get the fix, and an id read
-- off one database is a different row on another. One tenant whose copy has
-- been edited into a shape this file does not recognise is SKIPPED, not
-- fatal: raising would deny every other tenant the fix because one coach
-- added a step.
--
-- IN-FLIGHT RUNS ARE MOVED WITH THEIR STEPS, and this is the part a data
-- migration is most likely to forget. `sequence_runs.current_position` names
-- the NEXT step to execute, and this file renumbers the steps underneath it.
-- Left alone, a run parked at position 1 — which every run is for one tick
-- after its acknowledgement email goes out — would find the ALERT there and
-- tell the coach "no reply yet, they applied two days ago" within minutes of
-- the application arriving. False, and about the worst first impression an
-- alert channel could make.
--
-- So this mirrors what the product's own editor already does
-- (`planStepSave` + `save_sequence_steps`, migration 00256), by step identity
-- rather than by number:
--   * a run sitting on the DELETED acknowledgement (position 0) has nowhere
--     to go, so it is EXITED with `sequence_edited` — the same reason the
--     editor writes, already in both exit-reason inventories;
--   * a run sitting on the two-day wait (position 1) is repointed to 0, where
--     that wait now lives;
--   * runs at 2..5 need nothing: those steps keep their numbers, because the
--     alert fills the slot the deleted step vacated.
--
-- THE ALERT COPY IS DRAFTED, NOT AUTHORED. Same status as the wording
-- migrations 00253/00255 carry: it is written to be edited on
-- /admin/sequences/service_application_received, and this file is not the
-- place it will finally live. It deliberately contains NO link: the only
-- substitutions the renderer knows are {{name}}, {{unsubscribe_url}} and
-- {{sms_consent_url}}, and hard-coding a URL here would bake one tenant's
-- domain into seeded copy — the white-label problem this repo is trying to
-- walk away from. A `{{contact_url}}` field would fix that and is a separate
-- decision.

DO $$
DECLARE
  seq RECORD;
  sent_count int;
  ack_id uuid;
  bad_kinds int;
  branch_pointers int;
  converted int := 0;
BEGIN
  FOR seq IN
    SELECT s.id, s.business_id FROM public.sequences s WHERE s.key = 'service_application_received'
  LOOP
    -- Is there anything to do? Checked FIRST, before any shape guard, so that
    -- a re-run over an already-converted sequence skips quietly instead of
    -- failing on a count that has legitimately changed since.
    SELECT id INTO ack_id
      FROM public.sequence_steps
     WHERE sequence_id = seq.id AND position = 0 AND kind = 'email';

    IF ack_id IS NULL THEN
      CONTINUE;
    END IF;

    -- SHAPE GUARDS. Any mismatch SKIPS this tenant rather than raising: one
    -- coach who added a step must not deny every other tenant the fix.
    IF (SELECT count(*) FROM public.sequence_steps WHERE sequence_id = seq.id) <> 6 THEN
      RAISE NOTICE 'service_application_received (sequence %) is not 6 steps; skipping.', seq.id;
      CONTINUE;
    END IF;

    -- The KINDS, not just the count. Six steps in the wrong order is still
    -- six steps, and renumbering by position would then move the wrong rows.
    SELECT count(*) INTO bad_kinds
      FROM public.sequence_steps
     WHERE sequence_id = seq.id
       AND (position, kind) NOT IN ((0,'email'),(1,'wait'),(2,'email'),(3,'wait'),(4,'email'),(5,'stop'));
    IF bad_kinds > 0 THEN
      RAISE NOTICE 'service_application_received (sequence %) is not the email/wait/email/wait/email/stop shape; skipping.', seq.id;
      CONTINUE;
    END IF;

    -- A branch anywhere in this sequence means some step points at a POSITION,
    -- and renumbering would silently repoint it. None exists today (checked on
    -- production), but a coach can add one through the editor at any time.
    SELECT count(*) INTO branch_pointers
      FROM public.sequence_steps
     WHERE sequence_id = seq.id
       AND (on_true_position IS NOT NULL OR on_false_position IS NOT NULL);
    IF branch_pointers > 0 THEN
      RAISE NOTICE 'service_application_received (sequence %) has branch targets; skipping rather than repointing them.', seq.id;
      CONTINUE;
    END IF;

    -- Never cascade away the record of a real send.
    SELECT count(*) INTO sent_count FROM public.sequence_messages WHERE step_id = ack_id;
    IF sent_count > 0 THEN
      RAISE EXCEPTION
        'step 0 of service_application_received (sequence %) has % sent message(s); removing it would delete them. Retire the step in the editor instead.',
        seq.id, sent_count;
    END IF;

    -- IN-FLIGHT RUNS, BEFORE THE STEPS MOVE. Order matters only for
    -- readability — both statements key on the OLD numbering, which is still
    -- in force until the renumber below.
    UPDATE public.sequence_runs
       SET status = 'exited',
           exit_reason = 'sequence_edited',
           completed_at = now(),
           updated_at = now()
     WHERE sequence_id = seq.id
       AND status = 'active'
       AND current_position = 0;

    UPDATE public.sequence_runs
       SET current_position = 0,
           updated_at = now()
     WHERE sequence_id = seq.id
       AND status = 'active'
       AND current_position = 1;

    DELETE FROM public.sequence_steps WHERE id = ack_id;

    -- Park everything out of the way of sequence_steps_position_uniq, then
    -- bring it down. Renumbering in place collides mid-statement.
    UPDATE public.sequence_steps SET position = position + 1000 WHERE sequence_id = seq.id;

    UPDATE public.sequence_steps SET position = 0 WHERE sequence_id = seq.id AND position = 1001; -- the two-day wait
    UPDATE public.sequence_steps SET position = 2 WHERE sequence_id = seq.id AND position = 1002; -- first nudge
    UPDATE public.sequence_steps SET position = 3 WHERE sequence_id = seq.id AND position = 1003; -- the four-day wait
    UPDATE public.sequence_steps SET position = 4 WHERE sequence_id = seq.id AND position = 1004; -- last nudge
    UPDATE public.sequence_steps SET position = 5 WHERE sequence_id = seq.id AND position = 1005; -- stop

    INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, subject, body)
    VALUES (
      seq.business_id,
      seq.id,
      1,
      'alert',
      '{{name}} applied two days ago — have you replied?',
      E'{{name}} sent a service application two days ago.\n\n'
      'They have already had the automatic "we have your application" email, and the '
      'follow-up emails are still going out on schedule. This is only a nudge to check '
      'that a person has actually come back to them.\n\n'
      'We cannot see your inbox, so if you have already replied there is nothing to do '
      'here.\n\n'
      'You will not get another reminder about this one.'
    );

    converted := converted + 1;
  END LOOP;

  -- VERIFICATION. Three separate properties, because the obvious one is the
  -- weakest: a GROUP BY over zero matching sequences produces zero groups and
  -- therefore raises nothing, so "nothing matched" would read as success.
  --
  -- 1. Something must exist to check at all.
  IF NOT EXISTS (SELECT 1 FROM public.sequences WHERE key = 'service_application_received') THEN
    RAISE EXCEPTION 'no service_application_received sequence exists; 00271 had nothing to convert, which is not a state it should reach.';
  END IF;

  -- 2. Every copy that was converted must be the intended shape, with
  --    CONTIGUOUS positions 0..5. Count-plus-one-alert is not enough: drop a
  --    single renumber statement and a step is stranded at 1004, where the
  --    count is still 6, the alert is still one, and `decideStep` finds
  --    nothing at position 4 and silently completes the run.
  FOR seq IN
    SELECT s.id,
           count(*) AS steps,
           count(*) FILTER (WHERE st.kind = 'alert') AS alerts,
           count(*) FILTER (WHERE st.position = 0 AND st.kind = 'email') AS ack_at_zero,
           min(st.position) AS lo,
           max(st.position) AS hi
      FROM public.sequences s
      JOIN public.sequence_steps st ON st.sequence_id = s.id
     WHERE s.key = 'service_application_received'
       AND EXISTS (SELECT 1 FROM public.sequence_steps a WHERE a.sequence_id = s.id AND a.kind = 'alert')
     GROUP BY s.id
    HAVING count(*) <> 6
        OR count(*) FILTER (WHERE st.kind = 'alert') <> 1
        OR count(*) FILTER (WHERE st.position = 0 AND st.kind = 'email') <> 0
        OR min(st.position) <> 0
        OR max(st.position) <> 5
  LOOP
    RAISE EXCEPTION
      'service_application_received (sequence %) ended up with % steps, % alert(s), % email(s) at position 0, positions %..% — not the shape 00271 intends.',
      seq.id, seq.steps, seq.alerts, seq.ack_at_zero, seq.lo, seq.hi;
  END LOOP;

  RAISE NOTICE '00271: converted % copy/copies of service_application_received.', converted;
END $$;
