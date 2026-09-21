-- 00276_save_pipeline_stages.sql
--
-- G29. Replaces a board's whole stage list atomically.
--
-- TypeScript decides, this writes. Validation and the card-move plan are
-- computed by lib/lead-engine/stage-list.ts and passed in; the business rules
-- do not get a second home here where they can drift from the editor's copy.
-- This mirrors save_sequence_steps (00256) deliberately, including its
-- survivor row-count check -- see below for why that is not optional.
--
-- WHY WHOLE-LIST AND NOT PER-STAGE: pipeline_stages carries
-- UNIQUE (pipeline_id, position) and it is NOT deferrable, so two stages
-- cannot be swapped with two UPDATEs -- the first collides with the row that
-- has not moved yet. Renumbering the entire board from the submitted order in
-- one statement sidesteps that completely, needs no DEFERRABLE migration, and
-- fails atomically.

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
BEGIN
  -- EMPTY-LIST GUARD, first, before anything else runs. With an empty
  -- p_stages, array_agg() below returns NULL, so v_submitted_ids IS NULL is
  -- true -- and the DELETE in step 2 matches every row on
  -- "v_submitted_ids IS NULL OR NOT (id = ANY(...))", wiping the board's
  -- entire stage list. On a board with cards the FK on
  -- opportunities.stage_id stops that DELETE; on an EMPTY board (dev has
  -- two: camps_clinics, assessment) nothing stops it, and the call succeeds
  -- leaving zero stages, which decideMove can never close a card on again.
  -- lib/lead-engine/stage-list.ts's validateStageList already refuses an
  -- empty list at the route, so this only fires when something bypassed
  -- that -- which is exactly the case a last line of defence exists for.
  IF p_stages IS NULL OR jsonb_array_length(p_stages) = 0 THEN
    RAISE EXCEPTION 'A board needs at least one stage; refusing to empty board %', p_pipeline_id;
  END IF;

  -- The board must belong to the tenant. Every other statement here is
  -- scoped by p_pipeline_id, so this is the one line standing between a
  -- caller with the wrong business_id and another tenant's board.
  PERFORM 1 FROM public.pipelines
   WHERE id = p_pipeline_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Board % does not belong to business %', p_pipeline_id, p_business_id;
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
  UPDATE public.opportunities o
     SET stage_id         = (m->>'to_stage_id')::uuid,
         entered_stage_at = now(),
         updated_at       = now()
    FROM jsonb_array_elements(p_move_cards) m
   WHERE o.stage_id = (m->>'from_stage_id')::uuid
     AND o.business_id = p_business_id;

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
END;
$function$;

REVOKE ALL ON FUNCTION public.save_pipeline_stages(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_pipeline_stages(uuid, uuid, jsonb, jsonb) TO service_role;
