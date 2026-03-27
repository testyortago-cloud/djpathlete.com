-- ============================================================================
-- Migration 00057: Exercise Metadata Enhancements
-- Adds sport_tags, plane_of_motion, joints_loaded, and aliases to exercises
-- for improved AI session generation (sport-specific selection, plane balance,
-- injury-aware filtering, and exercise name recognition).
-- ============================================================================

-- 1. Sport-specific tags (which sports an exercise transfers to)
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS sport_tags text[] NOT NULL DEFAULT '{}';

-- 2. Plane of motion (sagittal, frontal, transverse)
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS plane_of_motion text[] NOT NULL DEFAULT '{}';

-- 3. Joint loading data (which joints are stressed and how heavily)
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS joints_loaded jsonb NOT NULL DEFAULT '[]';

-- 4. Exercise aliases (alternative names for search and recognition)
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

-- ============================================================================
-- Indexes for AI querying (active exercises only)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_exercises_sport_tags
  ON exercises USING gin (sport_tags)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_exercises_plane_of_motion
  ON exercises USING gin (plane_of_motion)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_exercises_joints_loaded
  ON exercises USING gin (joints_loaded)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_exercises_aliases
  ON exercises USING gin (aliases)
  WHERE is_active = true;
