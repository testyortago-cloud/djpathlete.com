-- supabase/migrations/00153_fix_platform_credentials_vault_update.sql
-- Fix fn_connect_platform's re-connect branch. The original implementation
-- (00089) tried to UPDATE vault.secrets directly, which Supabase Vault denies
-- with "permission denied for table secrets" (SQLSTATE 42501) even for the
-- SECURITY DEFINER owner. Reconnecting any platform_connections row after the
-- first successful connect would fail. Switch to vault.update_secret(), which
-- is the supported entry point and executes inside the privileged vault
-- helper just like vault.create_secret() on the insert branch.

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
    PERFORM vault.update_secret(v_existing_secret_id, p_credentials::text);
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

REVOKE ALL ON FUNCTION public.fn_connect_platform(text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_connect_platform(text, jsonb, text, uuid) TO service_role;
