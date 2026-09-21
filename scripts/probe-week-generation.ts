/**
 * Runs the REAL week orchestrator against the dev clone and the real Anthropic
 * API, so it exercises the code that would actually run in the Firebase
 * Function.
 *
 * THIS IS THE ONLY WAY TO TEST A GENERATION CHANGE LOCALLY. `npm run dev` does
 * NOT do it: the Next route only writes a Firestore `ai_jobs` doc and returns
 * 202, and the DEPLOYED function picks that up — still running whatever is on
 * main. Clicking Generate in a dev server tells you nothing about your branch.
 *
 *   npx tsx scripts/probe-week-generation.ts <label> \
 *     [--week 3] [--day 1..7] [--override "yoga_mat,resistance_band" | "" | NONE]
 *     [--instructions "..."]
 *
 *   --day    generate ONE day of that week instead of the whole week. Same
 *            orchestrator, same budget; it is the scope the coach picks in
 *            the Generate Day dialog.
 *
 *   --override NONE   no override at all (uses the client's stored profile)
 *   --override ""     an EMPTY override — "nothing at all", the hotel case
 *
 * IT WRITES A REAL TRAINING WEEK to whatever program PROGRAM points at, and
 * refuses to run against anything but the dev clone. Delete the week between
 * runs if you want two runs to share the same prior-week history:
 *   delete from program_exercises where program_id = '<PROGRAM>' and week_number = <N>;
 *
 * The three ids below are the 2026-09-21 travel-equipment probe fixtures
 * (testyortago@gmail.com, given a 23-item gym so that restricting it is a
 * meaningful change). Repoint them at whatever you are actually testing.
 */
import { config } from "dotenv"
import path from "node:path"

config({ path: path.resolve(process.cwd(), ".env.local") })

// Firebase Admin is initialised at import time by some of the modules in this
// graph; without a project it throws. The probe never touches Firestore (no
// firebaseJobId is passed), so a placeholder is enough.
process.env.GOOGLE_CLOUD_PROJECT ||= "probe-local"
process.env.GCLOUD_PROJECT ||= "probe-local"

// functions/ reads SUPABASE_URL; the app's .env.local only defines the
// NEXT_PUBLIC_ name. Same database either way — this is the dev clone.
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
if (!process.env.SUPABASE_URL.includes("anjvztjiokcgiyhobknq")) {
  // Hard stop rather than a warning: this probe WRITES a training week.
  throw new Error(`Refusing to run: SUPABASE_URL is not the dev clone (${process.env.SUPABASE_URL})`)
}

const args = process.argv.slice(2)
const label = args[0] ?? "unlabelled"
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

const PROGRAM_ID = "22d3ed57-4254-4c75-9ed8-eee8217236e4"
const CLIENT_ID = "eccb16a2-e658-4770-9186-532eddde7845"
const ASSIGNMENT_ID = "9c5e9136-d0e6-49c8-8c1d-5a7eebd8370a"

const rawOverride = flag("override")
const equipment_override =
  rawOverride === undefined || rawOverride === "NONE"
    ? undefined
    : rawOverride === ""
      ? []
      : rawOverride
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)

const instructions = flag("instructions")
const targetWeek = Number(flag("week") ?? 3)
/** --day 1..7 generates that ONE day instead of the whole week. */
const rawDay = flag("day")
const targetDay = rawDay === undefined ? undefined : Number(rawDay)

async function main() {
  const { generateWeekSync } = await import("../functions/src/ai/week-orchestrator.js")
  const { createDeadline } = await import("../functions/src/lib/deadline.js")

  console.log(`\n=== PROBE ${label} ===`)
  console.log(`  target week:  ${targetWeek}`)
  console.log(`  target day:   ${targetDay ?? "(whole week)"}`)
  console.log(
    `  override:     ${equipment_override === undefined ? "(none — use profile)" : JSON.stringify(equipment_override)}`,
  )
  console.log(`  instructions: ${instructions ? JSON.stringify(instructions) : "(none)"}`)

  const started = Date.now()
  try {
    const result = await generateWeekSync(
      {
        program_id: PROGRAM_ID,
        client_id: CLIENT_ID,
        assignment_id: ASSIGNMENT_ID,
        target_week_number: targetWeek,
        ...(targetDay !== undefined ? { target_day_of_week: targetDay } : {}),
        admin_instructions: instructions,
        ...(equipment_override !== undefined ? { equipment_override } : {}),
      },
      CLIENT_ID,
      undefined,
      createDeadline(450_000, `probe:${label}`),
    )
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`\n--- RESULT (${elapsed}s) ---`)
    console.log(`  week:      ${result.new_week_number}`)
    console.log(`  exercises: ${result.exercises_added}`)
    console.log(`  tokens:    architect=${result.token_usage.architect} selector=${result.token_usage.selector}`)
    console.log(`  warnings:  ${result.warnings.length}`)
    for (const w of result.warnings) console.log(`    - ${w}`)
  } catch (e) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.error(`\n--- FAILED after ${elapsed}s ---`)
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e)
    process.exitCode = 1
  }
}

main()
