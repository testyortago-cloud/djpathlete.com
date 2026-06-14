-- 00172_form_review_program_link.sql
-- Re-link form reviews to program context as NULLABLE columns (a deliberate,
-- safe partial reversal of 00043). Lets a client upload a form-check video from
-- inside a workout exercise and have it land in the admin Form Reviews inbox
-- tagged with program / exercise / week. Existing standalone reviews keep working
-- (all columns nullable). FK ON DELETE SET NULL preserves the review as a
-- historical record even if the program/exercise is later deleted; program_name
-- and exercise_name are denormalized snapshots captured at submission time.

ALTER TABLE form_reviews
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES program_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS program_exercise_id uuid REFERENCES program_exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exercise_id uuid REFERENCES exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS week_number int,
  ADD COLUMN IF NOT EXISTS program_name text,
  ADD COLUMN IF NOT EXISTS exercise_name text;

CREATE INDEX IF NOT EXISTS idx_form_reviews_assignment_pe
  ON form_reviews (assignment_id, program_exercise_id);
