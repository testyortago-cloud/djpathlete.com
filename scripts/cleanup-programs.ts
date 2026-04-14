/**
 * Cleanup script — Deletes all programs (and their exercises/assignments)
 * that are NOT part of the seed data.
 *
 * Run: npx tsx scripts/cleanup-programs.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Seed program IDs to keep
const SEED_PROGRAM_IDS = [
  "00000000-0000-0000-0000-000000000101", // Foundation Strength
  "00000000-0000-0000-0000-000000000102", // Elite Performance
  "00000000-0000-0000-0000-000000000103", // Sport-Specific
  "00000000-0000-0000-0000-000000000104", // Rotational Reboot
]

async function cleanup() {
  console.log("Fetching all programs...")

  const { data: allPrograms, error: fetchErr } = await supabase.from("programs").select("id, name")

  if (fetchErr) {
    console.error("Failed to fetch programs:", fetchErr.message)
    process.exit(1)
  }

  const toDelete = allPrograms.filter((p) => !SEED_PROGRAM_IDS.includes(p.id))

  if (toDelete.length === 0) {
    console.log("No non-seed programs found. Nothing to delete.")
    return
  }

  console.log(`\nFound ${toDelete.length} non-seed program(s) to delete:`)
  toDelete.forEach((p) => console.log(`  - ${p.name} (${p.id})`))

  const idsToDelete = toDelete.map((p) => p.id)

  // Nullify assessment_results references to these programs
  const { error: assessErr, count: assessCount } = await supabase
    .from("assessment_results")
    .update({ triggered_program_id: null })
    .in("triggered_program_id", idsToDelete)

  if (assessErr) {
    console.error("Failed to clear assessment_results refs:", assessErr.message)
  } else {
    console.log(`\nCleared ${assessCount ?? 0} assessment_results references`)
  }

  // Delete program_exercises for these programs
  const { error: exErr, count: exCount } = await supabase
    .from("program_exercises")
    .delete({ count: "exact" })
    .in("program_id", idsToDelete)

  if (exErr) {
    console.error("Failed to delete program_exercises:", exErr.message)
  } else {
    console.log(`\nDeleted ${exCount ?? 0} program_exercises rows`)
  }

  // Delete program_assignments for these programs
  const { error: assignErr, count: assignCount } = await supabase
    .from("program_assignments")
    .delete({ count: "exact" })
    .in("program_id", idsToDelete)

  if (assignErr) {
    console.error("Failed to delete program_assignments:", assignErr.message)
  } else {
    console.log(`Deleted ${assignCount ?? 0} program_assignments rows`)
  }

  // Delete the programs themselves
  const { error: progErr, count: progCount } = await supabase
    .from("programs")
    .delete({ count: "exact" })
    .in("id", idsToDelete)

  if (progErr) {
    console.error("Failed to delete programs:", progErr.message)
  } else {
    console.log(`Deleted ${progCount ?? 0} programs`)
  }

  console.log("\nCleanup complete!")
}

cleanup()
