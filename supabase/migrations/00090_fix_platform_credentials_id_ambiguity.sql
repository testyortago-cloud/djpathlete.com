-- supabase/migrations/00090_fix_platform_credentials_id_ambiguity.sql
-- Fix column-reference ambiguity in fn_connect_platform and fn_disconnect_platform:
-- RETURNS TABLE(id uuid, ...) declares `id` as a plpgsql output variable, which
-- collides with vault.secrets.id in the UPDATE/DELETE statements. Qualify with
-- an alias so PostgreSQL knows we mean the table column.

CREATE OR REPLACE FUNCTION public.fn_connect_platform(
  p_plugin_name     text,
  p_credentials     jsonb,
  p_account_handle  text,
  p_connected_by    uuid
)
RETURNS TABLE (
  id                    uuid,
  plugin_name           text,
  status                text,
  credentials           jsonb,
  account_handle        text,
  last_sync_at          timestamptz,
  last_error            text,
  connected_at          timestamptz,
  connected_by          uuid,
  created_at            timestamptz,
  updated_at            timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
  v_secret_name text;
BEGIN
  SELECT pc.credentials_secret_id INTO v_existing_secret_id
    FROM public.platform_connections pc
   WHERE pc.plugin_name = p_plugin_name;

  v_secret_name := 'platform_connections:' || p_plugin_name;

  IF v_existing_secret_id IS NOT NULL THEN
    UPDATE vault.secrets s
       SET secret = p_credentials::text
     WHERE s.id = v_existing_secret_id;
  ELSE
    v_new_secret_id := vault.create_secret(p_credentials::text, v_secret_name);
  END IF;

  UPDATE public.platform_connections pc
     SET status              = 'connected',
         credentials_secret_id = COALESCE(v_existing_secret_id, v_new_secret_id),
         account_handle      = p_account_handle,
         connected_at        = now(),
         connected_by        = p_connected_by,
         last_error          = NULL
   WHERE pc.plugin_name = p_plugin_name;

  RETURN QUERY SELECT * FROM public.fn_get_platform_connection(p_plugin_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_disconnect_platform(p_plugin_name text)
RETURNS TABLE (
  id                    uuid,
  plugin_name           text,
  status                text,
  credentials           jsonb,
  account_handle        text,
  last_sync_at          timestamptz,
  last_error            text,
  connected_at          timestamptz,
  connected_by          uuid,
  created_at            timestamptz,
  updated_at            timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_existing_secret_id uuid;
BEGIN
  SELECT pc.credentials_secret_id INTO v_existing_secret_id
    FROM public.platform_connections pc
   WHERE pc.plugin_name = p_plugin_name;

  IF v_existing_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets s WHERE s.id = v_existing_secret_id;
  END IF;

  UPDATE public.platform_connections pc
     SET status                = 'not_connected',
         credentials_secret_id = NULL,
         account_handle        = NULL,
         connected_at          = NULL,
         connected_by          = NULL,
         last_error            = NULL
   WHERE pc.plugin_name = p_plugin_name;

  RETURN QUERY SELECT * FROM public.fn_get_platform_connection(p_plugin_name);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_connect_platform(text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_disconnect_platform(text)                 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_connect_platform(text, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_disconnect_platform(text)                 TO service_role;
