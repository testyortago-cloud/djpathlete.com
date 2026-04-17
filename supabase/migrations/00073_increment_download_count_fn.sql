-- supabase/migrations/00073_increment_download_count_fn.sql
-- Atomic "consume one download" guarded by max_downloads + expiry.
-- Returns the updated row or NULL if policy denies.

CREATE OR REPLACE FUNCTION consume_shop_download(download_id uuid)
RETURNS shop_order_downloads
LANGUAGE plpgsql
AS $$
DECLARE
  updated shop_order_downloads;
BEGIN
  UPDATE shop_order_downloads
     SET download_count = download_count + 1,
         last_downloaded_at = now()
   WHERE id = download_id
     AND (access_expires_at IS NULL OR access_expires_at > now())
     AND (max_downloads IS NULL OR download_count < max_downloads)
   RETURNING * INTO updated;
  -- UPDATE ... RETURNING INTO leaves `updated` as an all-null composite when
  -- no row matched. Translate that to a SQL NULL so the client sees null.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN updated;
END;
$$;
