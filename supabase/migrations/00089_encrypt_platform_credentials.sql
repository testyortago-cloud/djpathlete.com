-- supabase/migrations/00089_encrypt_platform_credentials.sql
-- Move platform_connections.credentials (OAuth tokens) from plaintext jsonb into Supabase Vault.
-- The row keeps only a pointer (credentials_secret_id) to the vault.secrets entry.
-- All reads/writes go through SECURITY DEFINER RPCs so the DAL contract stays unchanged;
-- callers never see ciphertext, and the plaintext column is dropped.
--
-- Prereq: supabase_vault extension must be enabled. On Supabase, enable via
-- Database > Extensions > supabase_vault, or `CREATE EXTENSION supabase_vault;`.
-- This migration fails early with a clear message if it is not enabled.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault') THEN
    RAISE EXCEPTION 'supabase_vault extension is required. Enable it via the Supabase dashboard (Database > Extensions) before running this migration.';
  END IF;
END $$;

ALTER TABLE public.platform_connections
  ADD COLUMN IF NOT EXISTS credentials_secret_id uuid;

-- fn_list_platform_connections
-- Returns every row with credentials decrypted on the fly (empty object if no secret).
CREATE OR REPLACE FUNCTION public.fn_list_platform_connections()
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT
    pc.id,
    pc.plugin_name,
    pc.status,
    COALESCE(
      (SELECT ds.decrypted_secret::jsonb
         FROM vault.decrypted_secrets ds
         WHERE ds.id = pc.credentials_secret_id),
      '{}'::jsonb
    ) AS credentials,
    pc.account_handle,
    pc.last_sync_at,
    pc.last_error,
    pc.connected_at,
    pc.connected_by,
    pc.created_at,
    pc.updated_at
  FROM public.platform_connections pc
  ORDER BY pc.plugin_name ASC;
$$;

-- fn_get_platform_connection
-- Same shape, filtered by plugin_name. Returns zero rows if the plugin is unknown.
CREATE OR REPLACE FUNCTION public.fn_get_platform_connection(p_plugin_name text)
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT
    pc.id,
    pc.plugin_name,
    pc.status,
    COALESCE(
      (SELECT ds.decrypted_secret::jsonb
         FROM vault.decrypted_secrets ds
         WHERE ds.id = pc.credentials_secret_id),
      '{}'::jsonb
    ) AS credentials,
    pc.account_handle,
    pc.last_sync_at,
    pc.last_error,
    pc.connected_at,
    pc.connected_by,
    pc.created_at,
    pc.updated_at
  FROM public.platform_connections pc
  WHERE pc.plugin_name = p_plugin_name;
$$;

-- fn_connect_platform
-- Upserts a vault secret for this plugin, updates the row to 'connected' state.
-- Returns the row in the same shape as the list/get functions (with decrypted creds).
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

-- fn_disconnect_platform
-- Deletes the vault secret (if any) and resets the row to not_connected defaults.
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

REVOKE ALL ON FUNCTION public.fn_list_platform_connections()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_get_platform_connection(text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_connect_platform(text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_disconnect_platform(text)          FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_list_platform_connections()        TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_platform_connection(text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_connect_platform(text, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_disconnect_platform(text)          TO service_role;

-- Plaintext column is no longer the source of truth. No real tokens live here yet,
-- so dropping is safe. Anything that needs credentials must go through the RPCs.
ALTER TABLE public.platform_connections DROP COLUMN credentials;
