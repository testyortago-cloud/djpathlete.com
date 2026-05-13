-- Risk Flags: auto-generated alerts from rule evaluator (coach-only)
-- =====================================================================

CREATE TABLE IF NOT EXISTS risk_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  flag_type TEXT NOT NULL CHECK (flag_type IN (
    'load_spike','fatigue','overtraining','high_strain','rpe_creep'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  message TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','dismissed')),
  triggered_at DATE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_risk_flags_user ON risk_flags(client_user_id);
CREATE INDEX idx_risk_flags_user_status ON risk_flags(client_user_id, status);
CREATE INDEX idx_risk_flags_dedupe
  ON risk_flags(client_user_id, flag_type, triggered_at);

ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage risk flags"
  ON risk_flags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
