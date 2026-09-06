// scripts/repair-weight-unit-drift.ts
//
// Repairs the lbs -> kg -> lbs rounding drift described in lib/weight-utils.ts.
//
// Cause: `toKg` used to round STORAGE to 2dp, so a coach typing 40 lbs
// persisted 18.14 kg, which renders back as 39.99 lbs. The code fix stops new
// drift; this repairs values already written.
//
// Deliberately NOT a migration: files in supabase/migrations/ apply to
// production automatically on merge to main, and this rewrites athlete
// training history.
//
// Only values within 0.02 lb of a half-pound increment are touched -- that is
// the signature of a drifted lbs entry. Genuine kg-native entries (e.g. 31.5 kg
// = 69.45 lbs) sit further from any half-pound mark and are left alone.
// Idempotent: a repaired value lands exactly on a half-pound mark, so the
// `> EPSILON` guard excludes it from any later run.
//
// USAGE:
//   npx tsx scripts/repair-weight-unit-drift.ts            # dry run
//   npx tsx scripts/repair-weight-unit-drift.ts --apply    # writes

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.prod" })

import { writeFileSync } from "node:fs"

const KG_TO_LBS = 2.20462
const EPSILON = 1e-7
/** Widest gap we will treat as drift rather than a real value. */
const MAX_DRIFT_LBS = 0.02

const APPLY = process.argv.includes("--apply")

/**
 * Returns the corrected kg value, or null when the value is not drifted.
 * A drifted value is one that is *close to but not exactly* a half-pound mark.
 */
function repairKg(kg: number): number | null {
  if (!Number.isFinite(kg) || kg <= 0) return null
  const lbs = kg * KG_TO_LBS
  const nearestHalf = Math.round(lbs * 2) / 2
  const delta = Math.abs(lbs - nearestHalf)
  if (delta <= EPSILON || delta >= MAX_DRIFT_LBS) return null
  return Math.round((nearestHalf / KG_TO_LBS) * 1e6) / 1e6
}

type SetDetail = { weight_kg?: number | null; [k: string]: unknown }

async function main() {
  const { createServiceRoleClient } = await import("@/lib/supabase")
  const supabase = createServiceRoleClient()

  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)")
  console.log(`Target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

  // ─── Read everything first, so the backup is written before any write ──────
  const progress: { id: string; weight_kg: number | null; set_details: SetDetail[] | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("exercise_progress")
      .select("id, weight_kg, set_details")
      .order("id")
      .range(from, from + 999)
    if (error) throw new Error(`read exercise_progress: ${error.message}`)
    if (!data?.length) break
    progress.push(...(data as typeof progress))
    if (data.length < 1000) break
  }

  const progEx: { id: string; suggested_weight_kg: number | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("program_exercises")
      .select("id, suggested_weight_kg")
      .order("id")
      .range(from, from + 999)
    if (error) throw new Error(`read program_exercises: ${error.message}`)
    if (!data?.length) break
    progEx.push(...(data as typeof progEx))
    if (data.length < 1000) break
  }

  console.log(`Read ${progress.length} exercise_progress, ${progEx.length} program_exercises rows.`)

  // ─── Plan the changes ─────────────────────────────────────────────────────
  const epUpdates: { id: string; weight_kg?: number; set_details?: SetDetail[] }[] = []
  let topLevelFixed = 0
  let setValuesFixed = 0

  for (const row of progress) {
    const patch: { id: string; weight_kg?: number; set_details?: SetDetail[] } = { id: row.id }
    let changed = false

    if (row.weight_kg != null) {
      const fixed = repairKg(Number(row.weight_kg))
      if (fixed !== null) {
        patch.weight_kg = fixed
        topLevelFixed++
        changed = true
      }
    }

    if (Array.isArray(row.set_details)) {
      let arrChanged = false
      const rebuilt = row.set_details.map((s) => {
        if (s == null || typeof s !== "object") return s
        const w = s.weight_kg
        if (w == null) return s
        const fixed = repairKg(Number(w))
        if (fixed === null) return s
        arrChanged = true
        setValuesFixed++
        // Spread preserves rpe / reps / set_number and any other key.
        return { ...s, weight_kg: fixed }
      })
      if (arrChanged) {
        patch.set_details = rebuilt
        changed = true
      }
    }

    if (changed) epUpdates.push(patch)
  }

  const peUpdates: { id: string; suggested_weight_kg: number }[] = []
  for (const row of progEx) {
    if (row.suggested_weight_kg == null) continue
    const fixed = repairKg(Number(row.suggested_weight_kg))
    if (fixed !== null) peUpdates.push({ id: row.id, suggested_weight_kg: fixed })
  }

  console.log("\n─── Plan ───")
  console.log(`exercise_progress rows to touch:      ${epUpdates.length}`)
  console.log(`  · top-level weight_kg values fixed: ${topLevelFixed}`)
  console.log(`  · per-set weight_kg values fixed:   ${setValuesFixed}`)
  console.log(`program_exercises rows to touch:      ${peUpdates.length}`)
  console.log(`TOTAL values corrected:               ${topLevelFixed + setValuesFixed + peUpdates.length}`)

  if (!APPLY) {
    console.log("\nDry run -- nothing written. Re-run with --apply to write.")
    return
  }

  // ─── Backup only the rows we are about to change ──────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = `/tmp/weight-drift-backup-${stamp}.json`
  const touchedEp = new Set(epUpdates.map((u) => u.id))
  const touchedPe = new Set(peUpdates.map((u) => u.id))
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        exercise_progress: progress.filter((r) => touchedEp.has(r.id)),
        program_exercises: progEx.filter((r) => touchedPe.has(r.id)),
      },
      null,
      2,
    ),
  )
  console.log(`\nBackup of pre-change rows: ${backupPath}`)

  // ─── Write ────────────────────────────────────────────────────────────────
  let done = 0
  for (const u of epUpdates) {
    const { id, ...fields } = u
    const { error } = await supabase.from("exercise_progress").update(fields).eq("id", id)
    if (error) throw new Error(`update exercise_progress ${id}: ${error.message}`)
    if (++done % 100 === 0) console.log(`  exercise_progress ${done}/${epUpdates.length}`)
  }
  console.log(`exercise_progress: ${done} rows updated.`)

  done = 0
  for (const u of peUpdates) {
    const { error } = await supabase
      .from("program_exercises")
      .update({ suggested_weight_kg: u.suggested_weight_kg })
      .eq("id", u.id)
    if (error) throw new Error(`update program_exercises ${u.id}: ${error.message}`)
    done++
  }
  console.log(`program_exercises: ${done} rows updated.`)
  console.log("\nDone. Re-run without --apply to confirm 0 remaining.")
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
