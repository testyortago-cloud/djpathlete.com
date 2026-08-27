-- Migration 00232: Exercise blocklist for AI generation
--
-- A coach-curated set of exercises the AI must never program. Studio-wide when
-- client_id IS NULL, otherwise scoped to that one client. Read at generation
-- time and unioned into the excludeIds hard-prune both orchestrators already
-- apply — see docs/superpowers/specs/2026-08-28-exercise-blocklist-design.md.
--
-- Blocks affect AI SELECTION ONLY. The exercise stays in the library, stays
-- manually pickable, and stays in programs already built.

CREATE TABLE IF NOT EXISTS exercise_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  reason      TEXT,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TWO partial unique indexes, not one constraint. A plain
-- UNIQUE (coach_id, client_id, exercise_id) does NOT stop duplicate
-- studio-wide blocks, because NULL never equals NULL in a unique index —
-- every press of the block button would insert another row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercise_blocks_studio
  ON exercise_blocks (coach_id, exercise_id) WHERE client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_exercise_blocks_client
  ON exercise_blocks (coach_id, client_id, exercise_id) WHERE client_id IS NOT NULL;

-- The generation-time read is always (coach_id, client_id IS NULL OR client_id = $1).
CREATE INDEX IF NOT EXISTS idx_exercise_blocks_lookup
  ON exercise_blocks (coach_id, client_id);
