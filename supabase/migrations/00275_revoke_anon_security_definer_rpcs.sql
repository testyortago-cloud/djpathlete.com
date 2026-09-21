-- 00275 — Take five SECURITY DEFINER functions off the anonymous RPC surface.
--
-- Companion to 00274. That migration closed thirteen tables an anonymous
-- caller could read and write directly; this one closes five functions an
-- anonymous caller could INVOKE, which RLS does not cover at all because
-- SECURITY DEFINER runs as the definer.
--
-- WHAT WAS MEASURED, on production, 2026-09-21, by reading the function
-- bodies out of `pg_get_functiondef` rather than assuming from the names.
-- Supabase's linter flags all five as callable by `anon` via /rest/v1/rpc/.
--
--   create_message(conversation_id, sender_user_id, sender_role, body, ...)
--       Inserts into `messages` with a CALLER-SUPPLIED sender id AND sender
--       role, then updates the conversation's last-message preview. It never
--       checks that the caller is that user, or a participant. An anonymous
--       caller with a conversation id could post a message attributed to the
--       coach.
--   confirm_event_signup(signup_id, business_id)
--   cancel_event_signup(signup_id, business_id)
--       Flip a signup between pending/confirmed/cancelled and move
--       `events.signup_count`. No caller check: cancelling someone else's camp
--       place, or burning an event's capacity.
--   create_form_review_message_with_attachment(review_id, user_id, ...)
--       Same shape, into a form review thread.
--   is_messaging_admin()
--       Leaks an authorization answer.
--
-- HONEST SEVERITY: each needs a UUID the caller has no legitimate way to
-- obtain, so in practice these are gated by UUID entropy. That is obscurity,
-- not an authorization control, and it is why this is filed as a real finding
-- -- but it IS a smaller live risk than 00274's thirteen tables, which need no
-- identifier at all, only the publishable key that ships in the page bundle.
--
-- THE TRAP. Three of the five carry `=X/postgres` in `proacl`, which is an
-- EXECUTE grant to PUBLIC:
--
--   cancel_event_signup   {=X/postgres,postgres=X/postgres,anon=X/postgres,...}
--   confirm_event_signup  {=X/postgres,...}
--   is_messaging_admin    {=X/postgres,...}
--
-- Both `anon` and `authenticated` inherit EXECUTE through PUBLIC. A revoke
-- naming only those two roles leaves all three fully callable -- a migration
-- that looks like a fix, verifies green against a naive check, and changes
-- nothing. Every revoke below names PUBLIC first.
--
-- `is_messaging_admin` MUST KEEP `authenticated`, AND THIS IS LOAD-BEARING.
-- It is called inside SIX RLS policy expressions, all `TO authenticated`:
-- four in `public` (`messages`, `message_reactions`, `message_attachments`,
-- `conversations`) and TWO MORE outside it, on `realtime.messages`
-- (`participants read conversation channel`, `participants write conversation
-- channel`). The two in `realtime` are easy to miss because every other query
-- in this migration is scoped to `nspname = 'public'`; they are named here so
-- that a future audit of this lockdown has the true inventory rather than the
-- one a public-only search returns. Postgres checks EXECUTE on a function
-- invoked from a policy as the QUERYING role, so revoking it from
-- `authenticated` does not tighten those policies, it makes them raise. That
-- would break every logged-in read of the messaging tables. It is revoked from
-- PUBLIC and from `anon` only, and the grant to `authenticated` is restated
-- explicitly so the intent survives the next reader.
--
-- `service_role` KEEPS EXECUTE on all five. That is how the application
-- actually calls them -- lib/db/messages.ts, lib/db/form-reviews.ts and
-- lib/db/event-signups.ts all go through `createServiceRoleClient()`.
--
-- SCOPE. Grants only. The missing authorization checks INSIDE `create_message`
-- and friends are a separate piece of work: this migration stops the internet
-- reaching them, it does not make the functions safe to expose.

DO $$
DECLARE
  fn              record;
  full_revoke     text[] := ARRAY[
                      'create_message',
                      'create_form_review_message_with_attachment',
                      'confirm_event_signup',
                      'cancel_event_signup'
                    ];
  keep_authenticated text[] := ARRAY[
                      'is_messaging_admin'
                    ];
  revoked_count   int := 0;
  seen            text[] := '{}';
  leaked          text[];
  lost            text[];
BEGIN
  -- Identity arguments come from the catalog, so an overload is handled and a
  -- signature that drifts cannot silently miss its target.
  FOR fn IN
    SELECT p.oid,
           p.proname::text AS name,
           pg_get_function_identity_arguments(p.oid) AS args,
           (p.proname::text = ANY (full_revoke)) AS revoke_authenticated
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname::text = ANY (full_revoke || keep_authenticated)
  LOOP
    -- PUBLIC FIRST. Without this the rest is decoration.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', fn.name, fn.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn.name, fn.args);

    IF fn.revoke_authenticated THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated', fn.name, fn.args);
    ELSE
      -- Restated, not merely left alone: four RLS policies call this as the
      -- authenticated role and raise if it cannot.
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn.name, fn.args);
    END IF;

    -- DISTINCT NAMES, not loop iterations. The loop walks `pg_proc`, so an
    -- overloaded function yields two rows for one name; counting iterations
    -- would overshoot the expected total and make the all-or-nothing check
    -- below raise on a database that is perfectly fine.
    IF NOT (fn.name = ANY (seen)) THEN
      seen := seen || fn.name;
    END IF;
    revoked_count := revoked_count + 1;
  END LOOP;

  -- ALL OR NOTHING, not "at least one". `revoked_count = 0` catches only the
  -- case where every name is wrong. If ONE function is renamed or dropped
  -- upstream, the loop quietly covers the other four, and the `leaked`
  -- read-back below keys on the same name array -- so it cannot see the
  -- missing one either. The result would be a green migration with a
  -- SECURITY DEFINER writer still callable by the internet. Demand the full
  -- set, and name what is missing.
  IF cardinality(seen) <> cardinality(full_revoke || keep_authenticated) THEN
    RAISE EXCEPTION '00275: revoked nothing like the full set -- expected % functions, found %; missing: %',
      cardinality(full_revoke || keep_authenticated),
      cardinality(seen),
      (SELECT array_agg(want)
         FROM unnest(full_revoke || keep_authenticated) AS want
        WHERE NOT (want = ANY (seen)));
  END IF;

  -- Read the end state back from the catalog. `has_function_privilege`
  -- accounts for PUBLIC and role membership, so it is the check that would
  -- have caught a revoke that missed PUBLIC.
  SELECT array_agg(DISTINCT p.proname::text)
    INTO leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname::text = ANY (full_revoke || keep_authenticated)
     AND (
           has_function_privilege('anon', p.oid, 'EXECUTE')
           OR (p.proname::text = ANY (full_revoke) AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         );

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION '00275: still executable by anon/authenticated: %', leaked;
  END IF;

  -- The presence control for the absence check above. Asserting only that
  -- nobody can call these would pass a migration that locked the messaging
  -- policies out of the helper they depend on.
  SELECT array_agg(DISTINCT p.proname::text)
    INTO lost
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname::text = ANY (keep_authenticated)
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF lost IS NOT NULL THEN
    RAISE EXCEPTION '00275: % lost EXECUTE for authenticated -- the messaging RLS policies call it', lost;
  END IF;

  -- And service_role must still be able to call every one of them.
  SELECT array_agg(DISTINCT p.proname::text)
    INTO lost
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname::text = ANY (full_revoke || keep_authenticated)
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF lost IS NOT NULL THEN
    RAISE EXCEPTION '00275: % lost EXECUTE for service_role -- the app calls these', lost;
  END IF;

  RAISE NOTICE '00275: EXECUTE revoked from PUBLIC/anon on % functions', revoked_count;
END;
$$;
