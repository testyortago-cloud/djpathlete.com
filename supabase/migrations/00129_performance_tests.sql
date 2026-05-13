-- Performance Tests: standalone single-test logs with PR + % change
-- =====================================================================

CREATE TABLE IF NOT EXISTS performance_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,

  test_type TEXT NOT NULL CHECK (test_type IN (
    'drop_jump','cmj','squat_jump','broad_jump','sprint_10m','sprint_20m','sprint_40m',
    'sprint_5_10_5','t_test','beep_test','sit_reach','bench_press_1rm','back_squat_1rm',
    'deadlift_1rm','pull_up_max','push_up_max','plank_hold','custom'
  )),
  custom_name TEXT,
  result_value NUMERIC(8,3) NOT NULL,
  result_unit TEXT NOT NULL,
  trial_values JSONB,
  best_method TEXT NOT NULL CHECK (best_method IN ('highest','lowest','mean','median')),
  test_date DATE NOT NULL,
  body_weight_kg NUMERIC(5,2),
  notes TEXT,
  video_url TEXT,
  is_pr BOOLEAN NOT NULL DEFAULT FALSE,
  pct_change_from_prev NUMERIC(6,2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT custom_name_required CHECK (test_type <> 'custom' OR custom_name IS NOT NULL)
);

CREATE INDEX idx_performance_tests_user ON performance_tests(client_user_id);
CREATE INDEX idx_performance_tests_user_type_date
  ON performance_tests(client_user_id, test_type, test_date DESC);

CREATE TRIGGER set_performance_tests_updated_at
  BEFORE UPDATE ON performance_tests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE performance_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage performance tests"
  ON performance_tests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own tests"
  ON performance_tests FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own tests"
  ON performance_tests FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own tests"
  ON performance_tests FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
