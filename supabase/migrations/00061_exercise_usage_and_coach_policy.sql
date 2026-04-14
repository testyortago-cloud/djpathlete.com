-- Migration 00061: Exercise usage tracking + coach AI policy
-- Adds data layer for cross-client and per-client exercise variety,
-- and per-coach technique/policy overrides for AI generation.

-- ─── Exercise usage tracking ──────────────────────────────────────────────
-- Append-only log of every exercise assigned in a successful AI-generated program.
-- Queried by the AI semantic filter to down-rank recently-used exercises.

CREATE TABLE IF NOT EXISTS generated_exercise_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number INT NOT NULL,
  day_number INT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geu_coach_assigned
  ON generated_exercise_usage (coach_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_geu_client_assigned
  ON generated_exercise_usage (client_id, assigned_at DESC)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_geu_exercise_assigned
  ON generated_exercise_usage (exercise_id, assigned_at DESC);

-- ─── Coach AI policy ──────────────────────────────────────────────────────
-- Per-coach policy overrides. Injected into Agent 1 prompt as augmented
-- COACH INSTRUCTIONS so the AI respects studio-wide preferences.

CREATE TABLE IF NOT EXISTS coach_ai_policy (
  coach_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  disallowed_techniques JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_techniques JSONB NOT NULL DEFAULT '[]'::jsonb,
  technique_progression_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  programming_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure techniques listed are from the known enum.
-- Uses the JSONB <@ (contained-by) operator: every element of the left-hand
-- array must appear in the right-hand allowed set. CHECK constraints cannot
-- contain subqueries (SQLSTATE 0A000), so we avoid jsonb_array_elements.
ALTER TABLE coach_ai_policy ADD CONSTRAINT coach_ai_policy_disallowed_valid
  CHECK (
    jsonb_typeof(disallowed_techniques) = 'array'
    AND disallowed_techniques <@ '["straight_set","superset","dropset","giant_set","circuit","rest_pause","amrap","cluster_set","complex","emom","wave_loading"]'::jsonb
  );

ALTER TABLE coach_ai_policy ADD CONSTRAINT coach_ai_policy_preferred_valid
  CHECK (
    jsonb_typeof(preferred_techniques) = 'array'
    AND preferred_techniques <@ '["straight_set","superset","dropset","giant_set","circuit","rest_pause","amrap","cluster_set","complex","emom","wave_loading"]'::jsonb
  );

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION set_coach_ai_policy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coach_ai_policy_updated_at ON coach_ai_policy;
CREATE TRIGGER trg_coach_ai_policy_updated_at
  BEFORE UPDATE ON coach_ai_policy
  FOR EACH ROW EXECUTE FUNCTION set_coach_ai_policy_updated_at();
