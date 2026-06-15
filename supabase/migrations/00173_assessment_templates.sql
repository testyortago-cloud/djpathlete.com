-- Reusable performance-assessment templates.
-- A template is an assessment with is_template=TRUE and no specific client; it is
-- copied into a real per-client assessment via the "assign" flow. client_user_id
-- becomes nullable so templates can exist without an athlete.

ALTER TABLE performance_assessments
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_name TEXT;

ALTER TABLE performance_assessments
  ALTER COLUMN client_user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_perf_assessments_templates
  ON performance_assessments (is_template, created_at DESC)
  WHERE is_template = TRUE;
