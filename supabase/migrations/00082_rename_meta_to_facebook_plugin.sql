-- supabase/migrations/00082_rename_meta_to_facebook_plugin.sql
-- Align platform_connections.plugin_name with SocialPlatform type.
-- Replace 'meta' with 'facebook' in both the CHECK constraint and the seeded row.
-- Order: DROP existing CHECK first so the UPDATE can proceed (old CHECK rejects 'facebook').

ALTER TABLE platform_connections DROP CONSTRAINT platform_connections_plugin_name_check;

UPDATE platform_connections SET plugin_name = 'facebook' WHERE plugin_name = 'meta';

ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_plugin_name_check
  CHECK (plugin_name IN (
    'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin'
  ));
