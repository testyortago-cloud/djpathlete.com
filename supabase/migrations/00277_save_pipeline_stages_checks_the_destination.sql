-- 00277_save_pipeline_stages_checks_the_destination.sql
--
-- G29, whole-branch review (Important 1). ONE line of new behaviour:
-- step 1's card-move UPDATE now cross-checks `to_stage_id` the same way it
-- already cross-checked `from_stage_id`.
--
-- WHAT WAS WRONG. 00276 verified that a move came OFF a stage this save is
-- deleting, and then trusted whatever `to_stage_id` it was handed. Two ways
-- that bites:
--
--   1. The destination is ALSO being removed. Reachable in three clicks in
--      the editor: remove "Consulted" (which holds cards), choose "Proposal"
--      as their destination, then remove "Proposal" too. Step 1 moved the
--      cards onto Proposal and step 2 then tried to DELETE Proposal, so the
--      whole save died on `opportunities_stage_id_fkey` and a coach read a
--      raw Postgres string.
--
--   2. Worse, and the reason this is a migration rather than only a
--      TypeScript fix: `to_stage_id` naming ANOTHER BOARD'S stage. Nothing
--      stopped it — `opportunities.stage_id` has no composite foreign key
--      tying it to `pipeline_id`, so the cards were relocated onto a foreign
--      board WITH NO ERROR AT ALL, and then rendered on neither board,
--      because `readBoard` joins stages by `pipeline_id`. Not lost;
--      invisible.
--
-- The new predicate says: a destination must be one of the SUBMITTED ids.
-- The survivor check above already proves every submitted id belongs to this
-- board, so "submitted" means "a stage of this board that is staying" — both
-- halves, in one condition. A move that fails it is skipped, exactly as a
-- bad `from_stage_id` is skipped, and step 2 then refuses the DELETE on the
-- foreign key. That is the correct fail-closed outcome for a caller that
-- bypassed the DAL; the readable English refusal for the ordinary path lives
-- in `invalidDestinationProblems` (lib/lead-engine/stage-list.ts), which
-- `savePipelineStages` runs before it ever reaches this function.
--
-- WHY A NEW FILE RATHER THAN AN EDIT TO 00276: Supabase keys applied
-- migrations on the version NUMBER, so editing an applied file leaves the
-- dev clone running the old body with the new text on disk and nothing to
-- say so. `CREATE OR REPLACE` on the same signature is the whole change.
--
-- Everything below is 00276's body verbatim apart from the two marked lines.
-- The function is short enough that restating it is cheaper than a patch
-- nobody can read as a whole.

CREATE OR REPLACE FUNCTION public.save_pipeline_stages(
  p_business_id uuid,
  p_pipeline_id uuid,
  p_stages     jsonb,   -- ordered array; ARRAY ORDER IS THE POSITION
  p_move_cards jsonb    -- [{ "from_stage_id": uuid, "to_stage_id": uuid }]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_submitted_ids uuid[];
  v_survivors     integer;
  v_expected      integer;
  v_won_count     integer;
  v_lost_count    integer;
BEGIN
  -- The board must belong to the tenant. Checked FIRST, before the
  -- empty-list guard below: authorization before validation is the
  -- conventional order, and it means an empty-array call against another
  -- tenant's board answers with a tenant error, not "needs at least one
  -- stage" -- the latter would leak that validation ran before ownership
  -- was confirmed. Every other statement here is scoped by p_pipeline_id,
  -- so this is the one line standing between a caller with the wrong
  -- business_id and another tenant's board.
  PERFORM 1 FROM public.pipelines
   WHERE id = p_pipeline_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Board % does not belong to business %', p_pipeline_id, p_business_id;
  END IF;

  -- EMPTY-LIST GUARD. With an empty p_stages, array_agg() below returns
  -- NULL, so v_submitted_ids IS NULL is true -- and the DELETE in step 2
  -- matches every row on "v_submitted_ids IS NULL OR NOT (id = ANY(...))",
  -- wiping the board's entire stage list. On a board with cards the FK on
  -- opportunities.stage_id stops that DELETE; on an EMPTY board (dev has
  -- one: assessment) nothing stops it, and the call succeeds leaving zero
  -- stages, which decideMove can never close a card on again.
  -- lib/lead-engine/stage-list.ts's validateStageList already refuses an
  -- empty list at the route, so this only fires when something bypassed
  -- that -- which is exactly the case a last line of defence exists for.
  IF p_stages IS NULL OR jsonb_array_length(p_stages) = 0 THEN
    RAISE EXCEPTION 'A board needs at least one stage; refusing to empty board %', p_pipeline_id;
  END IF;

  SELECT array_agg((s->>'id')::uuid)
    INTO v_submitted_ids
    FROM jsonb_array_elements(p_stages) s
   WHERE s->>'id' IS NOT NULL;

  -- SURVIVOR CHECK. A submitted id that does not belong to this board
  -- (stale, another board's, or just wrong -- reachable with nothing more
  -- exotic than one coach with two tabs open) would match no row in the
  -- UPDATE below while every later array slot still took its own position,
  -- punching a gap in the ordering. save_sequence_steps carries the same
  -- check for the same reason; its header explains the incident.
  IF v_submitted_ids IS NOT NULL THEN
    v_expected := array_length(v_submitted_ids, 1);
    SELECT count(*) INTO v_survivors
      FROM public.pipeline_stages
     WHERE pipeline_id = p_pipeline_id
       AND id = ANY(v_submitted_ids);
    IF v_survivors <> v_expected THEN
      RAISE EXCEPTION 'A submitted stage does not belong to this board (% of % matched)', v_survivors, v_expected;
    END IF;
  END IF;

  -- 1. Move the cards off any stage that is about to disappear. BEFORE the
  --    delete, or the FK on opportunities.stage_id refuses it.
  --
  --    CROSS-CHECKED against the deletion set: from_stage_id must NOT be a
  --    survivor (i.e. it must be one of the stages step 2 is about to
  --    delete). Without this, a p_move_cards entry naming a SURVIVING stage
  --    would silently relocate that stage's cards with no error -- every
  --    other input here is defended (the empty guard, the survivor check,
  --    the ownership check), and this function's contract is that it
  --    defends against its own caller, not just against a malformed one.
  --    Unreachable through planStageSave today (it only populates
  --    moveCards for removedStageIds), but that is TypeScript's promise,
  --    not this function's -- the same reasoning as the survivor check two
  --    statements up.
  --
  --    AND CROSS-CHECKED THE OTHER WAY TOO, since 00277: to_stage_id must be
  --    one of the SUBMITTED ids, so a destination this save is about to
  --    delete -- or one belonging to ANOTHER BOARD -- moves nothing. See
  --    00277's header for both cases and why the second was the dangerous
  --    one.
  UPDATE public.opportunities o
     SET stage_id         = (m->>'to_stage_id')::uuid,
         entered_stage_at = now(),
         updated_at       = now()
    FROM jsonb_array_elements(p_move_cards) m
   WHERE o.stage_id = (m->>'from_stage_id')::uuid
     AND o.business_id = p_business_id
     AND (v_submitted_ids IS NULL OR NOT ((m->>'from_stage_id')::uuid = ANY(v_submitted_ids)))
     -- 00277, THE MIRROR IMAGE. `from_stage_id` must NOT survive; a
     -- `to_stage_id` MUST. Written as an explicit NOT NULL test plus the
     -- membership check rather than relying on `= ANY(NULL)` evaluating to
     -- NULL: a board submitted with no existing ids at all has nowhere for a
     -- card to go, and saying that out loud is clearer than leaning on
     -- three-valued logic.
     AND v_submitted_ids IS NOT NULL
     AND (m->>'to_stage_id')::uuid = ANY(v_submitted_ids);

  -- 2. Remove the stages that are gone. A stage still holding a card fails
  --    here on the FK, which is the correct last line: the route refuses it
  --    in English first, and this is what happens if that check is bypassed.
  DELETE FROM public.pipeline_stages
   WHERE pipeline_id = p_pipeline_id
     AND (v_submitted_ids IS NULL OR NOT (id = ANY(v_submitted_ids)));

  -- 3. Park every survivor at a negative position. The unique index is on
  --    (pipeline_id, position) and is not deferrable, so the final positions
  --    cannot be written while the old ones are still occupied. Negatives are
  --    outside the range step 4 writes, so the two sets cannot collide.
  UPDATE public.pipeline_stages
     SET position = -position
   WHERE pipeline_id = p_pipeline_id;

  -- 4. Update the survivors in place and renumber from the submitted order.
  --    `key` is deliberately NOT in the SET list: it is immutable once
  --    created, because every stored opportunity_stage_events row and
  --    routeToPipeline's return value reference it.
  UPDATE public.pipeline_stages st
     SET name             = s.name,
         kind             = s.kind,
         amber_after_days = s.amber_after_days,
         red_after_days   = s.red_after_days,
         position         = s.position
    FROM (
      SELECT (e.value->>'id')::uuid              AS id,
             e.value->>'name'                    AS name,
             e.value->>'kind'                    AS kind,
             (e.value->>'amber_after_days')::int AS amber_after_days,
             (e.value->>'red_after_days')::int   AS red_after_days,
             e.ordinality::int                   AS position
        FROM jsonb_array_elements(p_stages) WITH ORDINALITY e
       WHERE e.value->>'id' IS NOT NULL
    ) s
   WHERE st.id = s.id
     AND st.pipeline_id = p_pipeline_id;

  -- 5. Insert the brand-new stages at their submitted positions.
  INSERT INTO public.pipeline_stages
    (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
  SELECT p_business_id,
         p_pipeline_id,
         e.value->>'key',
         e.value->>'name',
         e.ordinality::int,
         e.value->>'kind',
         (e.value->>'amber_after_days')::int,
         (e.value->>'red_after_days')::int
    FROM jsonb_array_elements(p_stages) WITH ORDINALITY e
   WHERE e.value->>'id' IS NULL;

  -- 6. FINAL-STATE INVARIANT CHECK. Spec §3 (docs/superpowers/specs/
  --    2026-09-21-g29-pipeline-editor-design.md), invariant 1, names this
  --    function explicitly as a second enforcement point alongside
  --    validateStageList -- so unlike the rest of this file's header
  --    ("business rules do not get a second home here"), this one rule IS
  --    meant to be checked twice, on the binding authority of the spec.
  --    What must not happen is the RULE getting a second home: this is a
  --    terminal ASSERTION over the row set this function itself just
  --    wrote -- a plain count() FILTER over pipeline_stages for this board,
  --    AFTER every DELETE/UPDATE/INSERT above -- not a re-parse of
  --    p_stages against a re-implementation of "exactly one won, exactly
  --    one lost". An assertion about the result cannot drift from the
  --    rule the way a second copy of the rule could. validateStageList
  --    (lib/lead-engine/stage-list.ts) is the layer that produces this as
  --    readable English BEFORE the write, for the ordinary path where
  --    nothing bypassed it; this RAISE is what happens when something did
  --    -- the same threat model the empty-list guard above exists for, one
  --    stage short of empty.
  SELECT count(*) FILTER (WHERE kind = 'won'),
         count(*) FILTER (WHERE kind = 'lost')
    INTO v_won_count, v_lost_count
    FROM public.pipeline_stages
   WHERE pipeline_id = p_pipeline_id;

  IF v_won_count <> 1 OR v_lost_count <> 1 THEN
    RAISE EXCEPTION 'Board % must end with exactly one won and one lost stage (has % won, % lost)',
      p_pipeline_id, v_won_count, v_lost_count;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_pipeline_stages(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_pipeline_stages(uuid, uuid, jsonb, jsonb) TO service_role;
