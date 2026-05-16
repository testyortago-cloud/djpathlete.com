-- 00152_audit_logs.sql
-- Append-only audit trail across the app. Written via service-role DAL only.
-- No RLS policies: reads/writes go through server code, never the browser client.

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,

  action TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'auth','admin_write','admin_read_sensitive','client_action','support',
    'commerce','billing','marketing','compliance','automation','system'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','denied'))
    DEFAULT 'success',

  target_type TEXT,
  target_id TEXT,
  target_label TEXT,

  ip_address INET,
  user_agent TEXT,
  request_id TEXT,
  request_method TEXT,
  request_path TEXT,

  error_code TEXT,
  error_message TEXT,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category_action ON audit_logs (category, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON audit_logs (outcome, created_at DESC)
  WHERE outcome IN ('failure','denied');
CREATE INDEX IF NOT EXISTS idx_audit_logs_metadata_gin ON audit_logs USING gin (metadata jsonb_path_ops);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

INSERT INTO system_settings (key, value, description) VALUES
  (
    'audit_log_retention_days',
    '365'::jsonb,
    'How many days of audit_logs to keep. The daily auditLogRetentionCron (03:00 UTC) deletes older rows.'
  ),
  (
    'cron_audit_log_retention_enabled',
    'true'::jsonb,
    'When true, auditLogRetentionCron prunes audit_logs nightly. Defaults TRUE (cost concern: unbounded growth). Disabling means the table grows forever — toggle off only for compliance investigations.'
  )
ON CONFLICT (key) DO NOTHING;
