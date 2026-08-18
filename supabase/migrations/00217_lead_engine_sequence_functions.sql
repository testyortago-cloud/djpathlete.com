-- supabase/migrations/00217_lead_engine_sequence_functions.sql
-- Lead Engine Stage 1b: the two operations Supabase REST cannot express.

-- Atomic claim. An overlapping tick must not double-send, so due runs are
-- claimed with FOR UPDATE SKIP LOCKED rather than read-then-write.
--
-- The stale-claim arm (claimed_at older than 10 minutes) is what stops a tick
-- that died mid-batch from stranding its runs forever. `attempts` climbing
-- without current_position moving is the signature of a poison run.
CREATE OR REPLACE FUNCTION public.claim_sequence_runs(
  p_business_id uuid,
  p_limit       int,
  p_claim_token text
)
RETURNS SETOF public.sequence_runs
LANGUAGE plpgsql
AS $$
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
      WHERE s.business_id = p_business_id
        AND s.status      = 'active'
        AND s.next_run_at <= now()
        AND (s.claimed_at IS NULL OR s.claimed_at < now() - interval '10 minutes')
      ORDER BY s.next_run_at
        FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING r.*;
END;
$$;

-- Atomic merge. Replaces three un-transacted REST round-trips.
--
-- ORDER IS LOAD-BEARING: every child is re-pointed BEFORE the loser is
-- deleted, because all four cascade. Stage 1a shipped a version that missed
-- contact_consents and silently destroyed consent evidence — in the subsystem
-- whose entire purpose is defensible consent. Stage 1b adds two more children.
-- Before editing this function, list every FK onto contacts(id) and check it
-- appears below.
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
  -- active run into a sequence the survivor is already active in. In that
  -- case the survivor's own run stands and the loser's is marked exited, so
  -- the merge cannot fail on a unique violation.
  UPDATE public.sequence_runs r
     SET status = 'exited', exit_reason = 'merged_into_survivor', updated_at = now()
   WHERE r.contact_id = p_merged
     AND r.status = 'active'
     AND EXISTS (
       SELECT 1 FROM public.sequence_runs s
        WHERE s.contact_id  = p_survivor
          AND s.sequence_id = r.sequence_id
          AND s.status      = 'active');
  UPDATE public.sequence_runs SET contact_id = p_survivor WHERE contact_id = p_merged;

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

  DELETE FROM public.contacts WHERE id = p_merged AND business_id = p_business;
END;
$$;
