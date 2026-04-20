-- supabase/migrations/00078_platform_connections.sql
CREATE TABLE platform_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_name       text NOT NULL UNIQUE CHECK (plugin_name IN (
                      'meta', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin'
                    )),
  status            text NOT NULL DEFAULT 'not_connected' CHECK (status IN (
                      'not_connected', 'connected', 'paused', 'error'
                    )),
  credentials       jsonb NOT NULL DEFAULT '{}',
  account_handle    text,
  last_sync_at      timestamptz,
  last_error        text,
  connected_at      timestamptz,
  connected_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_connections_status ON platform_connections(status);

CREATE TRIGGER trg_platform_connections_updated_at
  BEFORE UPDATE ON platform_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;

create policy "Admins manage all platform_connections"
  on public.platform_connections for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- Seed one row per supported plugin, all in not_connected state
INSERT INTO platform_connections (plugin_name, status) VALUES
  ('meta', 'not_connected'),
  ('instagram', 'not_connected'),
  ('tiktok', 'not_connected'),
  ('youtube', 'not_connected'),
  ('youtube_shorts', 'not_connected'),
  ('linkedin', 'not_connected')
ON CONFLICT (plugin_name) DO NOTHING;
