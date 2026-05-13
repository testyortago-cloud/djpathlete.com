CREATE TABLE IF NOT EXISTS athlete_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_kind TEXT NOT NULL CHECK (metric_kind IN ('test','readiness','weekly_load')),
  test_type TEXT,
  target_value NUMERIC(8,3) NOT NULL,
  target_unit TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('higher','lower')),
  start_value NUMERIC(8,3),
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','achieved','missed','archived')),
  achieved_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT test_type_required_for_test_kind
    CHECK (metric_kind <> 'test' OR test_type IS NOT NULL),
  CONSTRAINT lower_direction_only_for_test
    CHECK (direction <> 'lower' OR metric_kind = 'test')
);

CREATE INDEX idx_athlete_goals_user ON athlete_goals(client_user_id);
CREATE INDEX idx_athlete_goals_user_status ON athlete_goals(client_user_id, status);

CREATE TRIGGER set_athlete_goals_updated_at
  BEFORE UPDATE ON athlete_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE athlete_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage athlete goals"
  ON athlete_goals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own goals"
  ON athlete_goals FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own goals"
  ON athlete_goals FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own goals"
  ON athlete_goals FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
