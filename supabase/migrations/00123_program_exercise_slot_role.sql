-- Migration 00123: Add slot_role to program_exercises
-- Replaces order_index inference in dedup-verify with explicit role storage.
-- Backfill mirrors current inference: 0 = warm_up, 1-2 = primary_compound, else accessory.

ALTER TABLE program_exercises
  ADD COLUMN IF NOT EXISTS slot_role TEXT;

-- Backfill existing rows using the same inference dedup-verify currently uses.
UPDATE program_exercises
SET slot_role = CASE
  WHEN order_index = 0 THEN 'warm_up'
  WHEN order_index BETWEEN 1 AND 2 THEN 'primary_compound'
  ELSE 'accessory'
END
WHERE slot_role IS NULL;

-- Index for fast role-scoped dedup lookups.
CREATE INDEX IF NOT EXISTS idx_program_exercises_program_role
  ON program_exercises (program_id, slot_role);

COMMENT ON COLUMN program_exercises.slot_role IS
  'Slot role from skeleton (warm_up | primary_compound | secondary_compound | accessory | isolation | cool_down | power | conditioning | activation | testing). Backfilled from order_index for legacy rows.';
