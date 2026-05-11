-- Extend platform_connections to support a Gmail OAuth connection so the
-- admin can read and reply to leads directly from /admin/inbox. Refresh
-- tokens piggyback on the existing vault-encrypted credentials column;
-- the connection row stores the connected email address as account_handle.

ALTER TABLE platform_connections
  DROP CONSTRAINT IF EXISTS platform_connections_plugin_name_check;

ALTER TABLE platform_connections
  ADD CONSTRAINT platform_connections_plugin_name_check
  CHECK (plugin_name IN (
    'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin',
    'google_ads',
    'gmail'
  ));

INSERT INTO platform_connections (plugin_name, status)
VALUES ('gmail', 'not_connected')
ON CONFLICT (plugin_name) DO NOTHING;
