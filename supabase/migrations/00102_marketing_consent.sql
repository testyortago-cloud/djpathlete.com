-- Phase 1.5a — Marketing consent column + audit log

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_consent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_source  text;

CREATE INDEX IF NOT EXISTS idx_users_marketing_consent ON users(marketing_consent_at)
  WHERE marketing_consent_at IS NOT NULL;

CREATE TABLE marketing_consent_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted     boolean NOT NULL,
  source      text NOT NULL,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_consent_log_user ON marketing_consent_log(user_id, created_at DESC);

ALTER TABLE marketing_consent_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on marketing_consent_log"
  ON marketing_consent_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all marketing_consent_log"
  ON marketing_consent_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
