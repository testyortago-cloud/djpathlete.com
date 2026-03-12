-- Performance Assessments: admin-initiated multi-exercise video reviews
-- =====================================================================

CREATE TABLE IF NOT EXISTS performance_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_perf_assessments_client ON performance_assessments(client_user_id);
CREATE INDEX idx_perf_assessments_status ON performance_assessments(status);
CREATE INDEX idx_perf_assessments_created ON performance_assessments(created_at DESC);

CREATE TRIGGER set_perf_assessments_updated_at
  BEFORE UPDATE ON performance_assessments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- One row per exercise in the assessment
-- exercise_id is nullable: if set, links to the exercise library; if null, custom_name is used
CREATE TABLE IF NOT EXISTS performance_assessment_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES performance_assessments(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  custom_name TEXT,
  youtube_url TEXT,
  video_path TEXT,
  admin_notes TEXT,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exercise_name_check CHECK (exercise_id IS NOT NULL OR custom_name IS NOT NULL)
);

CREATE INDEX idx_perf_assessment_exercises_assessment ON performance_assessment_exercises(assessment_id);

CREATE TRIGGER set_perf_assessment_exercises_updated_at
  BEFORE UPDATE ON performance_assessment_exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Messages/thread per exercise
CREATE TABLE IF NOT EXISTS performance_assessment_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_exercise_id UUID NOT NULL REFERENCES performance_assessment_exercises(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_perf_assessment_messages_exercise ON performance_assessment_messages(assessment_exercise_id);
CREATE INDEX idx_perf_assessment_messages_created ON performance_assessment_messages(created_at);

-- RLS
ALTER TABLE performance_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_assessment_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_assessment_messages ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "Admins can manage performance assessments"
  ON performance_assessments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can manage assessment exercises"
  ON performance_assessment_exercises FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can manage assessment messages"
  ON performance_assessment_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Clients: read own assessments (only non-draft), read exercises, read+create messages
CREATE POLICY "Clients can view own assessments"
  ON performance_assessments FOR SELECT TO authenticated
  USING (client_user_id = auth.uid() AND status != 'draft');

CREATE POLICY "Clients can view own assessment exercises"
  ON performance_assessment_exercises FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM performance_assessments
    WHERE performance_assessments.id = performance_assessment_exercises.assessment_id
      AND performance_assessments.client_user_id = auth.uid()
      AND performance_assessments.status != 'draft'
  ));

CREATE POLICY "Clients can update own assessment exercises"
  ON performance_assessment_exercises FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM performance_assessments
    WHERE performance_assessments.id = performance_assessment_exercises.assessment_id
      AND performance_assessments.client_user_id = auth.uid()
      AND performance_assessments.status = 'in_progress'
  ));

CREATE POLICY "Clients can view messages on own assessment exercises"
  ON performance_assessment_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM performance_assessment_exercises pae
    JOIN performance_assessments pa ON pa.id = pae.assessment_id
    WHERE pae.id = performance_assessment_messages.assessment_exercise_id
      AND pa.client_user_id = auth.uid()
      AND pa.status != 'draft'
  ));

CREATE POLICY "Clients can create messages on own assessment exercises"
  ON performance_assessment_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM performance_assessment_exercises pae
      JOIN performance_assessments pa ON pa.id = pae.assessment_id
      WHERE pae.id = performance_assessment_messages.assessment_exercise_id
        AND pa.client_user_id = auth.uid()
        AND pa.status = 'in_progress'
    )
  );
