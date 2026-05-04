-- Phase 1.1 — extend platform_connections with 'google_ads' plugin
-- The previous CHECK was added in 00082 (rename meta -> facebook). Drop & re-add
-- to add the new option without losing any existing rows.

ALTER TABLE platform_connections
  DROP CONSTRAINT IF EXISTS platform_connections_plugin_name_check;

ALTER TABLE platform_connections
  ADD CONSTRAINT platform_connections_plugin_name_check
  CHECK (plugin_name IN (
    'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin',
    'google_ads'
  ));

INSERT INTO platform_connections (plugin_name, status)
VALUES ('google_ads', 'not_connected')
ON CONFLICT (plugin_name) DO NOTHING;
