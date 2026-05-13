-- Training Sessions: per-athlete daily training load log
-- =====================================================================

CREATE TABLE IF NOT EXISTS training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  session_type TEXT NOT NULL CHECK (session_type IN (
    'gym','sport','field','conditioning','mobility','other'
  )),
  rpe INT NOT NULL CHECK (rpe BETWEEN 1 AND 10),
  duration_min INT NOT NULL CHECK (duration_min > 0 AND duration_min <= 600),
  session_load INT GENERATED ALWAYS AS (rpe * duration_min) STORED,
  notes TEXT,
  program_assignment_id UUID REFERENCES program_assignments(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT training_sessions_user_date_type_unique UNIQUE (client_user_id, date, session_type)
);

CREATE INDEX idx_training_sessions_user ON training_sessions(client_user_id);
CREATE INDEX idx_training_sessions_user_date ON training_sessions(client_user_id, date DESC);
CREATE INDEX idx_training_sessions_assignment ON training_sessions(program_assignment_id);

CREATE TRIGGER set_training_sessions_updated_at
  BEFORE UPDATE ON training_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage training sessions"
  ON training_sessions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own training sessions"
  ON training_sessions FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own training sessions"
  ON training_sessions FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own training sessions"
  ON training_sessions FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
