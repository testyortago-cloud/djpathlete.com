-- supabase/migrations/00256_sequence_management.sql
-- Gap #11 of docs/full-engine-scope-vs-built.md.
-- Design: docs/superpowers/specs/2026-09-08-sequence-management-design.md
--
-- TWO CHANGES, both to functions. No column is added and no signature changes,
-- so this is safe in either deploy order against the Vercel build it races.
--
-- 1. claim_sequence_runs stops claiming runs whose sequence is switched off.
--
--    Until now, turning a sequence off stopped NEW people entering it and did
--    nothing whatsoever to the people already inside -- claim_sequence_runs
--    filtered on sequence_runs.status (the RUN's status) and never joined
--    sequences at all, and loadRunContext reads that row but selects only
--    trigger_source. So "paused" meant "paused for new arrivals". With a
--    switch about to appear in front of a coach, that is a switch that lies.
--
--    THE GATE MUST BE BEFORE THE CLAIM, NOT AFTER IT. The UPDATE below does
--    attempts = attempts + 1, and the runner destroys a run at MAX_ATTEMPTS.
--    Filtering after the claim would tick every held run's attempts up on every
--    pass and destroy all of them within minutes -- the 73-run incident again,
--    caused by the safety feature. Do not "simplify" this into the runner.
--
--    Resume needs no new state: a held run is simply not selected, next_run_at
--    stays where it was, and switching the sequence back on makes it claimable
--    on the very next tick at its existing current_position.
--
-- 2. save_sequence_steps replaces a sequence's whole step list atomically.
--
--    TypeScript decides, this writes. Validation and the re-point plan are
--    computed by lib/lead-engine/step-list.ts and passed in; the business rules
--    do not get a second home here where they can drift from the tick's copy.
--
--    WHOLE-BRANCH REVIEW FIX: the survivor UPDATE's row count is now checked
--    against the number of ids submitted, RAISE-ing on a mismatch. A submitted
--    id that does not belong to this sequence (stale, another sequence's, or
--    just wrong -- reachable with nothing more exotic than one coach with two
--    tabs open on the same sequence) used to match nothing and write no row,
--    while every later array slot still took its own ordinal position --
--    punching a gap like 0,1,3,4 instead of 0,1,2,3. A run advancing into that
--    gap was reported by the tick as having reached the end: the exact lie
--    this whole feature exists to prevent. The route
--    (app/api/admin/sequences/[key]/steps/route.ts) checks this too, in
--    readable English; this RAISE is the line that cannot be bypassed.

CREATE OR REPLACE FUNCTION public.claim_sequence_runs(p_business_id uuid, p_limit integer, p_claim_token text)
 RETURNS SETOF public.sequence_runs
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.sequence_runs r
     SET claimed_at = now(),
         claimed_by = p_claim_token,
         attempts   = r.attempts + 1,
         updated_at = now()
   WHERE r.id IN (
     SELECT s.id
       FROM public.sequence_runs s
       JOIN public.sequences q
         ON q.id = s.sequence_id
        AND q.business_id = s.business_id
      WHERE s.business_id = p_business_id
        AND s.status      = 'active'
        AND q.status      = 'active'
        AND s.next_run_at <= now()
        AND (s.claimed_at IS NULL OR s.claimed_at < now() - interval '10 minutes')
      ORDER BY s.next_run_at
        -- OF s, not a bare FOR UPDATE. Once `sequences` is in the FROM, a bare
        -- FOR UPDATE locks a row in BOTH tables, so every tick would take a row
        -- lock on the sequence itself and the on/off switch would block behind
        -- the tick (and vice versa) for no reason. Only the run is being
        -- claimed, so only the run is locked. Do not shorten this.
        FOR UPDATE OF s SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING r.*;
END;
$function$;

-- p_steps: ordered JSON array; the ARRAY INDEX IS THE POSITION. Each element:
--   { id, kind, wait_minutes, subject, body, branch_condition,
--     on_true_position, on_false_position, config }
--   `id` null means a step that does not exist yet.
-- p_repoint: [{ "run_id": uuid, "to_position": int }]
-- p_exit_run_ids: runs whose step was removed.
CREATE OR REPLACE FUNCTION public.save_sequence_steps(
  p_business_id   uuid,
  p_sequence_id   uuid,
  p_steps         jsonb,
  p_repoint       jsonb,
  p_exit_run_ids  uuid[]
) RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_keep_ids  uuid[];
  v_sent      integer;
  v_owned     boolean;
  v_updated   integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.sequences
     WHERE id = p_sequence_id AND business_id = p_business_id
  ) INTO v_owned;
  IF NOT v_owned THEN
    RAISE EXCEPTION 'sequence % does not belong to business %', p_sequence_id, p_business_id;
  END IF;

  SELECT coalesce(array_agg((e->>'id')::uuid), ARRAY[]::uuid[])
    INTO v_keep_ids
    FROM jsonb_array_elements(p_steps) AS e
   WHERE e->>'id' IS NOT NULL;

  -- Removing a step CASCADES sequence_messages away with it
  -- (sequence_messages_step_id_fkey), destroying the record of real messages
  -- sent to real people. Refuse. The route checks this too so the operator
  -- gets a sentence; this is the line that cannot be bypassed.
  SELECT count(*) INTO v_sent
    FROM public.sequence_messages m
    JOIN public.sequence_steps s ON s.id = m.step_id
   WHERE s.sequence_id = p_sequence_id
     AND NOT (s.id = ANY (v_keep_ids));
  IF v_sent > 0 THEN
    RAISE EXCEPTION 'refusing to remove a step that has already sent % message(s)', v_sent;
  END IF;

  DELETE FROM public.sequence_steps
   WHERE sequence_id = p_sequence_id
     AND business_id = p_business_id
     AND NOT (id = ANY (v_keep_ids));

  -- sequence_steps_position_uniq is a bare UNIQUE INDEX on
  -- (sequence_id, position) and is NOT deferrable, so renumbering in place
  -- collides mid-statement. Park every survivor on a negative position first;
  -- there is no position >= 0 CHECK, so this is legal, and nothing else can
  -- ever hold a negative.
  UPDATE public.sequence_steps
     SET position = -1 - position
   WHERE sequence_id = p_sequence_id
     AND business_id = p_business_id;

  -- New steps go straight to their final positions. Survivors are all negative
  -- at this moment, so nothing can collide.
  INSERT INTO public.sequence_steps
    (business_id, sequence_id, position, kind, wait_minutes, subject, body,
     branch_condition, on_true_position, on_false_position, config)
  SELECT p_business_id,
         p_sequence_id,
         (e.ord - 1)::int,
         e.value->>'kind',
         nullif(e.value->>'wait_minutes','')::int,
         e.value->>'subject',
         e.value->>'body',
         CASE WHEN e.value->'branch_condition' = 'null'::jsonb THEN NULL ELSE e.value->'branch_condition' END,
         nullif(e.value->>'on_true_position','')::int,
         nullif(e.value->>'on_false_position','')::int,
         coalesce(e.value->'config', '{}'::jsonb)
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS e(value, ord)
   WHERE e.value->>'id' IS NULL;

  -- Survivors move from their negative parking spot to the final position, and
  -- pick up every edited field on the way.
  UPDATE public.sequence_steps s
     SET position          = (e.ord - 1)::int,
         kind              = e.value->>'kind',
         wait_minutes      = nullif(e.value->>'wait_minutes','')::int,
         subject           = e.value->>'subject',
         body              = e.value->>'body',
         branch_condition  = CASE WHEN e.value->'branch_condition' = 'null'::jsonb THEN NULL ELSE e.value->'branch_condition' END,
         on_true_position  = nullif(e.value->>'on_true_position','')::int,
         on_false_position = nullif(e.value->>'on_false_position','')::int,
         config            = coalesce(e.value->'config', '{}'::jsonb),
         updated_at        = now()
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS e(value, ord)
   WHERE s.sequence_id = p_sequence_id
     AND s.business_id = p_business_id
     AND e.value->>'id' IS NOT NULL
     AND s.id = (e.value->>'id')::uuid;

  -- Every non-null id in p_steps must have matched exactly one real row of
  -- THIS sequence above. An id belonging to nothing (another sequence's,
  -- already deleted, or simply wrong) writes no row while every later array
  -- slot still takes its own ordinal position -- punching a gap such as
  -- 0,1,3,4. A run that advances into that gap finds no step and is reported
  -- by the tick as having reached the end, which is the exact lie this whole
  -- feature exists to prevent. This also catches a DUPLICATED id for free: a
  -- repeated id can only ever update the one row it names once, so
  -- ROW_COUNT falls short of array_length(v_keep_ids, 1), which counts every
  -- element as submitted, duplicates included. The route checks this too (a
  -- readable sentence); this is the line that cannot be bypassed.
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> coalesce(array_length(v_keep_ids, 1), 0) THEN
    RAISE EXCEPTION 'expected to update % survivor step(s) but touched %', coalesce(array_length(v_keep_ids, 1), 0), v_updated;
  END IF;

  UPDATE public.sequence_runs r
     SET current_position = (e.value->>'to_position')::int,
         updated_at       = now()
    FROM jsonb_array_elements(p_repoint) AS e(value)
   WHERE r.id = (e.value->>'run_id')::uuid
     AND r.business_id = p_business_id
     AND r.sequence_id = p_sequence_id
     AND r.status = 'active';

  -- Exited, never completed. Reporting a stopped follow-up as one that reached
  -- the end is the exact lie this whole feature exists to prevent.
  UPDATE public.sequence_runs
     SET status = 'exited',
         exit_reason = 'sequence_edited',
         completed_at = now(),
         updated_at = now()
   WHERE id = ANY (p_exit_run_ids)
     AND business_id = p_business_id
     AND sequence_id = p_sequence_id
     AND status = 'active';
END;
$function$;
