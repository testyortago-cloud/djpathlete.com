-- Add AI-suggested weight for next session
ALTER TABLE exercise_progress
  ADD COLUMN IF NOT EXISTS ai_next_weight_kg numeric;

COMMENT ON COLUMN exercise_progress.ai_next_weight_kg
  IS 'Weight suggested by AI Coach for the next session of this exercise';
