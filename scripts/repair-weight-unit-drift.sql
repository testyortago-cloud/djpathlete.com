-- Repair for the lbs -> kg -> lbs rounding drift.
--
-- NOT a migration, and deliberately so. Files in supabase/migrations/ are
-- applied to production automatically on merge to main; this rewrites athlete
-- training history, so it must be run deliberately by a human who has read the
-- dry-run output first.
--
-- Cause: lib/weight-utils.ts `toKg` rounded STORAGE to 2 decimal places, so a
-- coach typing 40 lbs persisted 18.14 kg, which renders back as 39.99 lbs.
-- The code fix stops new drift; this repairs values already written.
--
-- Safety: only values within 0.02 lb of a half-pound increment are touched.
-- That is the signature of a drifted lbs entry. Genuine kg-native entries
-- (e.g. 31.5 kg = 69.45 lbs) are further than that from any half-pound mark and
-- are left alone -- 115 such rows in exercise_progress, 13 in program_exercises.
-- Largest correction observed: 0.0175 lb (about 8 grams).
--
-- Idempotent: a repaired row lands exactly on a half-pound mark, so the
-- `> 0.0000001` guard excludes it from any later run.
--
-- USAGE: run section 1 alone first and read the counts. Only then run section 2
-- inside an explicit transaction.

-- ─── 1. DRY RUN — change nothing, just report ────────────────────────────────

SELECT 'exercise_progress.weight_kg' AS target,
       COUNT(*) FILTER (WHERE ABS((weight_kg*2.20462) - ROUND((weight_kg*2.20462)*2,0)/2) BETWEEN 0.0000001 AND 0.02) AS will_repair,
       COUNT(*) FILTER (WHERE ABS((weight_kg*2.20462) - ROUND((weight_kg*2.20462)*2,0)/2) >= 0.02) AS left_alone
FROM exercise_progress WHERE weight_kg IS NOT NULL
UNION ALL
SELECT 'program_exercises.suggested_weight_kg',
       COUNT(*) FILTER (WHERE ABS((suggested_weight_kg*2.20462) - ROUND((suggested_weight_kg*2.20462)*2,0)/2) BETWEEN 0.0000001 AND 0.02),
       COUNT(*) FILTER (WHERE ABS((suggested_weight_kg*2.20462) - ROUND((suggested_weight_kg*2.20462)*2,0)/2) >= 0.02)
FROM program_exercises WHERE suggested_weight_kg IS NOT NULL;

-- ─── 2. REPAIR — run inside a transaction, verify, then COMMIT ───────────────
--
-- BEGIN;
--
-- -- 2a. exercise_progress.weight_kg
-- UPDATE exercise_progress
-- SET weight_kg = ROUND((ROUND((weight_kg*2.20462)*2,0)/2) / 2.20462, 6)
-- WHERE weight_kg IS NOT NULL
--   AND ABS((weight_kg*2.20462) - ROUND((weight_kg*2.20462)*2,0)/2) BETWEEN 0.0000001 AND 0.02;
--
-- -- 2b. program_exercises.suggested_weight_kg
-- UPDATE program_exercises
-- SET suggested_weight_kg = ROUND((ROUND((suggested_weight_kg*2.20462)*2,0)/2) / 2.20462, 6)
-- WHERE suggested_weight_kg IS NOT NULL
--   AND ABS((suggested_weight_kg*2.20462) - ROUND((suggested_weight_kg*2.20462)*2,0)/2) BETWEEN 0.0000001 AND 0.02;
--
-- -- 2c. exercise_progress.set_details -- per-set weights inside the JSONB array.
-- -- This is the surface the client actually reads on the workout screen.
-- -- Rebuilds each array element, preserving every other key on it.
-- UPDATE exercise_progress ep
-- SET set_details = rebuilt.arr
-- FROM (
--   SELECT e.id,
--          jsonb_agg(
--            CASE
--              WHEN elem->>'weight_kg' ~ '^[0-9.]+$'
--               AND ABS(((elem->>'weight_kg')::numeric*2.20462)
--                     - ROUND(((elem->>'weight_kg')::numeric*2.20462)*2,0)/2)
--                   BETWEEN 0.0000001 AND 0.02
--              THEN jsonb_set(elem, '{weight_kg}',
--                     to_jsonb(ROUND((ROUND(((elem->>'weight_kg')::numeric*2.20462)*2,0)/2) / 2.20462, 6)))
--              ELSE elem
--            END
--            ORDER BY ord
--          ) AS arr
--   FROM exercise_progress e, jsonb_array_elements(e.set_details) WITH ORDINALITY AS t(elem, ord)
--   WHERE e.set_details IS NOT NULL AND jsonb_typeof(e.set_details) = 'array'
--   GROUP BY e.id
-- ) AS rebuilt
-- WHERE ep.id = rebuilt.id AND ep.set_details IS DISTINCT FROM rebuilt.arr;
--
-- -- 2d. Verify BEFORE committing: every count below must be 0.
-- SELECT COUNT(*) AS remaining_progress_drift FROM exercise_progress
--  WHERE weight_kg IS NOT NULL
--    AND ABS((weight_kg*2.20462) - ROUND((weight_kg*2.20462)*2,0)/2) BETWEEN 0.0000001 AND 0.02;
--
-- COMMIT;
