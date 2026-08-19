-- supabase/migrations/00220_lead_engine_pipeline_merge.sql
-- Lead Engine Stage 1c: merge_contacts learns about opportunities, and about
-- which first_touch_session_id actually came first.
--
-- CREATE OR REPLACE, not a hand-edit of 00217 (already applied to
-- production). See supabase/migrations/00217_lead_engine_sequence_functions.sql
-- for claim_sequence_runs, which is untouched by this migration.

-- Atomic merge. Replaces three un-transacted REST round-trips.
--
-- ORDER IS LOAD-BEARING: every child is re-pointed BEFORE the loser is
-- deleted, because all six cascade. Stage 1a shipped a version that missed
-- contact_consents and silently destroyed consent evidence — in the subsystem
-- whose entire purpose is defensible consent. Stage 1b's own review caught a
-- fifth: contact_merges.survivor_id also references contacts(id) ON DELETE
-- CASCADE, so a contact that won an earlier merge would lose its own merge
-- history (and the merged_snapshot inside it) the moment it later lost a
-- merge to someone else. Stage 1c's Task 1 added a sixth: opportunities.contact_id,
-- also ON DELETE CASCADE (opportunity_stage_events hangs off opportunity_id,
-- not contact_id, so it needs no separate handling — it follows its parent
-- opportunity automatically). Before editing this function, re-run
--   grep -n "REFERENCES public.contacts(id)" supabase/migrations/*.sql
-- and check every hit is either re-pointed below or explicitly exempt
-- (contact_merges.merged_id carries no FK by design; contact_suppressions is
-- keyed by identifier, not contact_id).
CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_survivor uuid,
  p_merged   uuid,
  p_business uuid,
  p_reason   text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_loser          public.contacts%ROWTYPE;
  v_survivor       public.contacts%ROWTYPE;
  v_existing_merge uuid;
BEGIN
  SELECT * INTO v_loser    FROM public.contacts
    WHERE id = p_merged   AND business_id = p_business;
  SELECT * INTO v_survivor FROM public.contacts
    WHERE id = p_survivor AND business_id = p_business;

  -- Nothing to merge. Idempotent: a retry after a completed merge is a no-op.
  IF v_loser.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.contact_timeline_events SET contact_id = p_survivor WHERE contact_id = p_merged;
  UPDATE public.contact_consents        SET contact_id = p_survivor WHERE contact_id = p_merged;
  UPDATE public.sequence_messages       SET contact_id = p_survivor WHERE contact_id = p_merged;

  -- Runs are re-pointed last among the children and need conflict handling:
  -- sequence_runs_one_active_per_sequence would reject moving a loser's
  -- active run into a sequence the survivor is already active in. One of the
  -- two has to be exited so the merge cannot fail on a unique violation.
  --
  -- WHICH one is not a free choice. This used to always keep the SURVIVOR's
  -- run, regardless of progress. With the survivor's run at position 0 and
  -- the loser's at position 4, the person then received steps 0..3 a SECOND
  -- time, days apart, from the same sequence. sequence_messages_idem is
  -- (run_id, step_id) and cannot stop that: the run ids differ, so every
  -- replayed step looks like a first send.
  --
  -- The rule is therefore: KEEP WHICHEVER RUN IS FURTHER ALONG. A higher
  -- current_position has, by definition, already delivered everything the
  -- lower one still would. Ties fall back to enrolled_at (older survives) and
  -- then to id, matching siblingRunDefer in lib/lead-engine/guardrails.ts,
  -- where the older run is the one entitled to send.
  WITH contested AS (
    SELECT l.id AS loser_run,
           CASE
             WHEN l.current_position > s.current_position THEN s.id
             WHEN l.current_position < s.current_position THEN l.id
             WHEN l.enrolled_at      < s.enrolled_at      THEN s.id
             WHEN l.enrolled_at      > s.enrolled_at      THEN l.id
             WHEN l.id               < s.id               THEN s.id
             ELSE l.id
           END AS lagging_run
      FROM public.sequence_runs l
      JOIN public.sequence_runs s
        ON  s.sequence_id = l.sequence_id
        AND s.contact_id  = p_survivor
        AND s.status      = 'active'
     WHERE l.contact_id = p_merged
       AND l.status     = 'active'
  )
  UPDATE public.sequence_runs r
     SET status      = 'exited',
         exit_reason = CASE WHEN r.id = c.loser_run
                            THEN 'merged_into_survivor'
                            ELSE 'superseded_by_merged_run' END,
         updated_at  = now()
    FROM contested c
   WHERE r.id = c.lagging_run;

  UPDATE public.sequence_runs SET contact_id = p_survivor WHERE contact_id = p_merged;

  -- Fifth child: a contact that survived an earlier merge is itself
  -- referenced as survivor_id on that historical contact_merges row. If this
  -- contact now loses a later merge, that row must move with it or the
  -- cascade delete below destroys it (merged_snapshot included).
  UPDATE public.contact_merges SET survivor_id = p_survivor WHERE survivor_id = p_merged;

  -- "A user always has a contact" only holds if a merge never drops the link.
  IF v_survivor.user_id IS NULL AND v_loser.user_id IS NOT NULL THEN
    UPDATE public.contacts SET user_id = v_loser.user_id WHERE id = p_survivor;
  ELSIF v_survivor.user_id IS NOT NULL
    AND v_loser.user_id IS NOT NULL
    AND v_survivor.user_id <> v_loser.user_id THEN
    INSERT INTO public.contact_timeline_events (business_id, contact_id, kind, source, metadata)
    VALUES (p_business, p_survivor, 'user_id_conflict', 'system_merge',
            jsonb_build_object('survivor_user_id', v_survivor.user_id,
                               'loser_user_id',    v_loser.user_id,
                               'merged_contact_id', p_merged));
  END IF;

  SELECT id INTO v_existing_merge FROM public.contact_merges
    WHERE survivor_id = p_survivor AND merged_id = p_merged;
  IF v_existing_merge IS NULL THEN
    INSERT INTO public.contact_merges (business_id, survivor_id, merged_id, merged_snapshot, reason)
    VALUES (p_business, p_survivor, p_merged, to_jsonb(v_loser), p_reason);
  END IF;

  -- Sixth cascading child (Stage 1c). Contested open deals: the partial unique
  -- index allows one open opportunity per (contact, pipeline), so moving the
  -- loser's open card into a pipeline the survivor is already open in would
  -- fail. Keep whichever is FURTHER ALONG — a higher stage position has already
  -- consumed the earlier stages — tie-broken by earlier created_at then id,
  -- mirroring the rule already applied to sequence_runs above.
  WITH contested AS (
    SELECT l.id AS loser_opp,
           CASE
             WHEN ls.position > ss.position THEN s.id
             WHEN ls.position < ss.position THEN l.id
             WHEN l.created_at < s.created_at THEN s.id
             WHEN l.created_at > s.created_at THEN l.id
             WHEN l.id < s.id THEN s.id
             ELSE l.id
           END AS lagging_opp
      FROM public.opportunities l
      JOIN public.pipeline_stages ls ON ls.id = l.stage_id
      JOIN public.opportunities s
        ON  s.pipeline_id = l.pipeline_id
        AND s.contact_id  = p_survivor
        AND s.outcome IS NULL
      JOIN public.pipeline_stages ss ON ss.id = s.stage_id
     WHERE l.contact_id = p_merged
       AND l.outcome IS NULL
  )
  UPDATE public.opportunities o
     SET outcome        = 'lost',
         outcome_reason = 'merged_into_survivor',
         closed_at      = now(),
         closed_trigger = 'merge',
         updated_at     = now()
    FROM contested c
   WHERE o.id = c.lagging_opp;

  UPDATE public.opportunities SET contact_id = p_survivor WHERE contact_id = p_merged;

  -- First touch must be the EARLIEST of the two, not the survivor's by default.
  -- Stage 1c makes this column the root of campaign-to-revenue; keeping the wrong
  -- one misattributes every dollar of that contact's revenue to the wrong campaign.
  IF v_loser.first_touch_session_id IS NOT NULL THEN
    IF v_survivor.first_touch_session_id IS NULL THEN
      UPDATE public.contacts
         SET first_touch_session_id = v_loser.first_touch_session_id, updated_at = now()
       WHERE id = p_survivor;
    ELSE
      DECLARE
        v_surv_touch timestamptz;
        v_lose_touch timestamptz;
      BEGIN
        SELECT COALESCE(MIN(ma.first_seen_at), v_survivor.created_at) INTO v_surv_touch
          FROM public.marketing_attribution ma
         WHERE ma.session_id = v_survivor.first_touch_session_id;
        SELECT COALESCE(MIN(ma.first_seen_at), v_loser.created_at) INTO v_lose_touch
          FROM public.marketing_attribution ma
         WHERE ma.session_id = v_loser.first_touch_session_id;
        IF v_lose_touch < v_surv_touch THEN
          UPDATE public.contacts
             SET first_touch_session_id = v_loser.first_touch_session_id, updated_at = now()
           WHERE id = p_survivor;
        END IF;
      END;
    END IF;
  END IF;

  DELETE FROM public.contacts WHERE id = p_merged AND business_id = p_business;
END;
$$;
