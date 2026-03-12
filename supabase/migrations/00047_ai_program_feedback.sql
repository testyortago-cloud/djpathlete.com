-- AI Program Feedback
-- Stores structured coach feedback on AI-generated programs for learning loop

CREATE TABLE IF NOT EXISTS ai_program_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  generation_log_id uuid REFERENCES ai_generation_log(id) ON DELETE SET NULL,
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Quality ratings (1-5)
  overall_rating smallint NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  balance_quality smallint CHECK (balance_quality BETWEEN 1 AND 5),
  exercise_selection_quality smallint CHECK (exercise_selection_quality BETWEEN 1 AND 5),
  periodization_quality smallint CHECK (periodization_quality BETWEEN 1 AND 5),
  difficulty_appropriateness smallint CHECK (difficulty_appropriateness BETWEEN 1 AND 5),

  -- Denormalized for efficient vector search filtering
  split_type text,
  difficulty text,

  -- Structured issue tracking
  -- Each issue: { category: string, description: string, severity: "low"|"medium"|"high" }
  -- Categories: push_pull_imbalance, missing_movement_pattern, wrong_difficulty,
  --   bad_exercise_choice, too_many_exercises, periodization_issue, equipment_mismatch, other
  specific_issues jsonb NOT NULL DEFAULT '[]',

  -- What the coach changed after reviewing the AI output
  corrections_made jsonb NOT NULL DEFAULT '{}',

  -- Freeform notes
  notes text,

  -- Vector embedding for similarity search (384 dims = all-MiniLM-L6-v2)
  embedding vector(384),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique: one review per admin per program
CREATE UNIQUE INDEX idx_ai_prog_feedback_unique ON ai_program_feedback(program_id, reviewer_id);

-- Query indexes
CREATE INDEX idx_ai_prog_feedback_program ON ai_program_feedback(program_id);
CREATE INDEX idx_ai_prog_feedback_gen_log ON ai_program_feedback(generation_log_id);
CREATE INDEX idx_ai_prog_feedback_reviewer ON ai_program_feedback(reviewer_id);
CREATE INDEX idx_ai_prog_feedback_created ON ai_program_feedback(created_at DESC);
CREATE INDEX idx_ai_prog_feedback_split ON ai_program_feedback(split_type) WHERE split_type IS NOT NULL;

-- HNSW vector index for fast approximate nearest-neighbor search
CREATE INDEX idx_ai_prog_feedback_embedding
  ON ai_program_feedback USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Auto-update updated_at
CREATE TRIGGER set_ai_prog_feedback_updated_at
  BEFORE UPDATE ON ai_program_feedback
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Similarity search function
CREATE OR REPLACE FUNCTION match_ai_program_feedback(
  query_embedding vector(384),
  target_split_type text DEFAULT NULL,
  target_difficulty text DEFAULT NULL,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  program_id uuid,
  overall_rating smallint,
  balance_quality smallint,
  exercise_selection_quality smallint,
  periodization_quality smallint,
  difficulty_appropriateness smallint,
  split_type text,
  difficulty text,
  specific_issues jsonb,
  corrections_made jsonb,
  notes text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    f.id,
    f.program_id,
    f.overall_rating,
    f.balance_quality,
    f.exercise_selection_quality,
    f.periodization_quality,
    f.difficulty_appropriateness,
    f.split_type,
    f.difficulty,
    f.specific_issues,
    f.corrections_made,
    f.notes,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM ai_program_feedback f
  WHERE f.embedding IS NOT NULL
    AND (target_split_type IS NULL OR f.split_type = target_split_type)
    AND (target_difficulty IS NULL OR f.difficulty = target_difficulty)
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- RLS: admin-only access
ALTER TABLE ai_program_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_prog_feedback_admin_all ON ai_program_feedback
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );
