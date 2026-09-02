-- supabase/migrations/00238_merge_contacts_carries_tags.sql
-- Phase 1: merge_contacts learns about contact_tags.
--
-- CREATE OR REPLACE, not a hand-edit of 00220 (already applied to production),
-- for the same reason 00220 did not hand-edit 00217. The function body below is
-- 00220's verbatim, plus one new block -- search for "SEVENTH cascading child".
--
-- Migration 00237 added public.contact_tags with contact_id ON DELETE CASCADE.
-- That makes it the seventh child this function must re-point BEFORE deleting
-- the loser, and 00220's header says why in as many words: any table with a
-- cascading FK onto contacts(id) that is not re-pointed here has its rows for
-- the loser "destroyed by cascade instead of being carried to the survivor".
--
-- Ran the check 00220's header prescribes, against the LIVE schema rather than
-- the migration files (a grep cannot see an FK added by an ALTER):
--
--   select c.conrelid::regclass, a.attname, c.confdeltype from pg_constraint c ...
--
-- Nine FKs reference contacts(id). Seven cascade -- contact_timeline_events,
-- contact_consents, sequence_messages, sequence_runs, contact_merges.survivor_id,
-- opportunities, and now contact_tags -- and all seven are re-pointed below.
-- The remaining two, chat_conversations.contact_id and quiz_attempts.contact_id,
-- are ON DELETE SET NULL: they are not destroyed by the merge, so they are out
-- of scope here, but note they are also not CARRIED -- a merged contact's chat
-- and quiz rows are orphaned rather than moved. That predates this migration and
-- is left alone deliberately; changing it needs its own backfill decision.

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

  -- SEVENTH cascading child (Phase 1, migration 00237). contact_tags.contact_id
  -- is ON DELETE CASCADE like the six above, so without this the loser's tags
  -- are destroyed by the DELETE at the end of this function. Verified as a real
  -- failure before this migration was written: merging a loser tagged
  -- {shared-tag, loser-only} into a survivor tagged {shared-tag, survivor-only}
  -- left the survivor with {shared-tag, survivor-only} and silently lost
  -- `loser-only`.
  --
  -- THE OVERLAP IS THE CASE THAT BREAKS, and it is why this is not a bare
  -- UPDATE: contact_tags_unique UNIQUE (contact_id, tag) rejects moving a tag
  -- the survivor already carries, which would abort the whole merge on a
  -- duplicate-key error. Postgres has NO `ON CONFLICT` clause on UPDATE -- that
  -- is INSERT-only -- so the guard is a NOT EXISTS against the target instead.
  --
  -- The rows the guard skips are exactly the duplicates, and they are left to
  -- the cascade DELIBERATELY: the survivor already carries that tag, so the tag
  -- SET is preserved intact, and the row that survives is the survivor's own --
  -- whose created_by records who first applied it to the record being kept.
  UPDATE public.contact_tags l
     SET contact_id = p_survivor
   WHERE l.contact_id = p_merged
     AND NOT EXISTS (
       SELECT 1 FROM public.contact_tags s
        WHERE s.contact_id = p_survivor
          AND s.tag        = l.tag
     );

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
