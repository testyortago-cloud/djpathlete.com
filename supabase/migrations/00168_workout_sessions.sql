-- Workout Sessions: one row per client per program day (the program-flow session anchor).
-- Anchors PRS (start), session RPE (end), volume load, and completion for streaks.
-- =====================================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES program_assignments(id) ON DELETE CASCADE,
  week_number INT NOT NULL,
  day_of_week INT NOT NULL,
  session_date DATE NOT NULL,
  prs INT CHECK (prs BETWEEN 0 AND 10),
  prs_recorded_at TIMESTAMPTZ,
  session_rpe INT CHECK (session_rpe BETWEEN 1 AND 10),
  volume_load_kg NUMERIC,
  duration_seconds INT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workout_sessions_user_assignment_week_day_unique
    UNIQUE (user_id, assignment_id, week_number, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_status ON workout_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_assignment ON workout_sessions(assignment_id);

CREATE TRIGGER set_workout_sessions_updated_at
  BEFORE UPDATE ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage workout sessions"
  ON workout_sessions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Clients can view own workout sessions"
  ON workout_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Clients can insert own workout sessions"
  ON workout_sessions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Clients can update own workout sessions"
  ON workout_sessions FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Link per-set logs to a session (additive; existing rows stay NULL).
ALTER TABLE exercise_progress
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_exercise_progress_session ON exercise_progress(session_id);

-- Coach-configurable weight entry convention per exercise (drives the client label
-- and the volume-load multiplier). See lib/workout/load-type.ts.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS load_type TEXT NOT NULL DEFAULT 'total'
  CHECK (load_type IN ('total','per_dumbbell','per_side'));

-- Coach flag: this exercise must be video-recorded by the client.
ALTER TABLE program_exercises
  ADD COLUMN IF NOT EXISTS requires_video BOOLEAN NOT NULL DEFAULT false;
