-- ============================================================================
-- Migration 00018: Key Lift Tracking & Celebrations
-- Adds PR detection columns to exercise_progress, tracked exercises per
-- assignment, and an achievements/celebrations table.
-- ============================================================================

-- ============================================================================
-- A. Exercise Progress — PR tracking columns
-- ============================================================================

ALTER TABLE exercise_progress
  ADD COLUMN IF NOT EXISTS is_pr boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pr_type text CHECK (pr_type IN ('weight', 'reps', 'volume', 'estimated_1rm'));

-- Fast PR lookups: find all PRs for a given user + exercise
CREATE INDEX IF NOT EXISTS idx_exercise_progress_user_exercise_pr
  ON exercise_progress (user_id, exercise_id, is_pr)
  WHERE is_pr = true;

-- ============================================================================
-- B. Tracked Exercises — admin flags key lifts per program assignment
-- ============================================================================

CREATE TABLE IF NOT EXISTS tracked_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES program_assignments(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  target_metric text NOT NULL DEFAULT 'weight' CHECK (target_metric IN ('weight', 'reps', 'time')),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT unique_tracked_exercise UNIQUE (assignment_id, exercise_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tracked_exercises_assignment
  ON tracked_exercises (assignment_id);

CREATE INDEX IF NOT EXISTS idx_tracked_exercises_exercise
  ON tracked_exercises (exercise_id);

-- RLS
ALTER TABLE tracked_exercises ENABLE ROW LEVEL SECURITY;

-- Clients can see tracked exercises for their own assignments
CREATE POLICY tracked_exercises_client_select ON tracked_exercises
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM program_assignments pa
      WHERE pa.id = tracked_exercises.assignment_id
        AND pa.user_id = auth.uid()
    )
  );

-- Admins have full access
CREATE POLICY tracked_exercises_admin ON tracked_exercises
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

-- Auto-update updated_at via the shared trigger function from migration 00012
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tracked_exercises
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- C. Achievements — PR celebrations, streaks, milestones
-- ============================================================================

CREATE TABLE IF NOT EXISTS achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_type text NOT NULL CHECK (achievement_type IN ('pr', 'streak', 'milestone', 'completion')),
  title text NOT NULL,
  description text,
  exercise_id uuid REFERENCES exercises(id) ON DELETE SET NULL,
  metric_value numeric,
  icon text DEFAULT 'star',
  celebrated boolean DEFAULT false,
  earned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_achievements_user
  ON achievements (user_id);

CREATE INDEX IF NOT EXISTS idx_achievements_user_exercise
  ON achievements (user_id, exercise_id);

-- RLS
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;

-- Clients can view their own achievements
CREATE POLICY achievements_client_select ON achievements
  FOR SELECT USING (user_id = auth.uid());

-- Clients can update their own achievements (mark as celebrated)
CREATE POLICY achievements_client_update ON achievements
  FOR UPDATE USING (user_id = auth.uid());

-- Admins have full access
CREATE POLICY achievements_admin ON achievements
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );
