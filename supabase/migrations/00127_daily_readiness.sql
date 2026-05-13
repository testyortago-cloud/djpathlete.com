-- Daily Readiness: time-series wellness check-in per athlete per day
-- =====================================================================

CREATE TABLE IF NOT EXISTS daily_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  sleep_hours NUMERIC(4,2),
  sleep_quality INT NOT NULL CHECK (sleep_quality BETWEEN 1 AND 5),
  soreness_overall INT NOT NULL CHECK (soreness_overall BETWEEN 1 AND 5),
  soreness_by_region JSONB NOT NULL DEFAULT '{}'::jsonb,
  fatigue INT NOT NULL CHECK (fatigue BETWEEN 1 AND 5),
  mood INT NOT NULL CHECK (mood BETWEEN 1 AND 5),
  stress INT NOT NULL CHECK (stress BETWEEN 1 AND 5),
  hydration INT NOT NULL CHECK (hydration BETWEEN 1 AND 5),
  resting_hr INT CHECK (resting_hr IS NULL OR resting_hr BETWEEN 20 AND 200),
  hrv_ms INT CHECK (hrv_ms IS NULL OR hrv_ms BETWEEN 0 AND 500),
  notes TEXT,

  readiness_score NUMERIC(5,2) GENERATED ALWAYS AS (
    ROUND(
      (((sleep_quality - 1)::numeric / 4) * 25) +
      (((5 - soreness_overall)::numeric / 4) * 20) +
      (((5 - fatigue)::numeric / 4) * 20) +
      (((mood - 1)::numeric / 4) * 15) +
      (((5 - stress)::numeric / 4) * 10) +
      (((hydration - 1)::numeric / 4) * 10),
      2
    )
  ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_readiness_user_date_unique UNIQUE (client_user_id, date)
);

CREATE INDEX idx_daily_readiness_user ON daily_readiness(client_user_id);
CREATE INDEX idx_daily_readiness_user_date ON daily_readiness(client_user_id, date DESC);

CREATE TRIGGER set_daily_readiness_updated_at
  BEFORE UPDATE ON daily_readiness
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE daily_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage daily readiness"
  ON daily_readiness FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own readiness"
  ON daily_readiness FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own readiness"
  ON daily_readiness FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own readiness"
  ON daily_readiness FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
