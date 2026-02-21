-- Add set_details JSONB column for per-set tracking
-- Each entry: { set_number, weight_kg, reps, rpe }
-- Nullable for backward compatibility with existing rows
ALTER TABLE exercise_progress ADD COLUMN set_details jsonb;
