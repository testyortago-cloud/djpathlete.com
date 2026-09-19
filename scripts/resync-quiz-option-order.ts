/**
 * Re-orders a live quiz's options to match its seed module, by LABEL.
 *
 *   npx tsx scripts/resync-quiz-option-order.ts .env.prod
 *   npx tsx scripts/resync-quiz-option-order.ts .env.prod --execute
 *
 * WHY THIS EXISTS RATHER THAN A RE-SEED. The seeder refuses to overwrite an
 * existing quiz, deliberately — a re-seed would discard whatever the owner had
 * edited. But a quiz already in the database cannot pick up a pure ORDERING
 * change from the seed any other way, and ordering is not cosmetic here: it
 * decides whether clicking straight down the first button scores 100.
 *
 * MATCHED ON LABEL, NOT POSITION. Position is the thing being changed, so it
 * cannot also be the identity. Label is stable across a reorder and unique
 * within a question. A label the database has and the seed does not (or vice
 * versa) aborts that question rather than guessing — a half-applied reorder is
 * worse than none, because it can leave two options sharing a position.
 *
 * WEIGHTS ARE NEVER TOUCHED. Each option keeps the weight it already has; only
 * `position` moves. That is what makes this safe to run against a live quiz:
 * no past score changes meaning, because no answer changes value.
 */
import { config } from "dotenv"

const args = process.argv.slice(2)
const envPath = args.find((a) => a.startsWith(".env")) ?? ".env.local"
const execute = args.includes("--execute")
config({ path: envPath })

const QUIZ_NAME = "Rotational Performance Index"

async function main() {
  const { createClient } = await import("@supabase/supabase-js")
  const { ROTATIONAL_PERFORMANCE_INDEX: SEED } = await import(
    "@/lib/quizzes/seed/rotational-performance-index"
  )

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  )
  console.log(`${execute ? "EXECUTE" : "DRY RUN"} against ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

  const { data: quiz } = await db.from("quizzes").select("id, name").eq("name", QUIZ_NAME).maybeSingle()
  if (!quiz) throw new Error(`No quiz named "${QUIZ_NAME}".`)

  const { data: questions } = await db
    .from("quiz_questions")
    .select("id, prompt, quiz_options(id, label, position, weight)")
    .eq("quiz_id", quiz.id)
  if (!questions) throw new Error("Could not read questions.")

  let changed = 0
  for (const seedQuestion of SEED.questions) {
    const row = questions.find((q) => q.prompt === seedQuestion.prompt)
    if (!row) {
      console.log(`  SKIP   no question in the database matches "${seedQuestion.prompt.slice(0, 50)}"`)
      continue
    }
    const options = (row.quiz_options ?? []) as { id: string; label: string; position: number; weight: number }[]

    // Both directions, before writing anything for this question.
    const dbLabels = new Set(options.map((o) => o.label))
    const seedLabels = new Set(seedQuestion.options.map((o) => o.label))
    const mismatch =
      seedQuestion.options.some((o) => !dbLabels.has(o.label)) || options.some((o) => !seedLabels.has(o.label))
    if (mismatch) {
      console.log(`  ABORT  "${seedQuestion.prompt.slice(0, 46)}" — labels differ; not guessing`)
      continue
    }

    for (const [index, seedOption] of seedQuestion.options.entries()) {
      const wanted = index + 1
      const option = options.find((o) => o.label === seedOption.label)!
      if (option.position === wanted) continue
      console.log(
        `  MOVE   "${seedQuestion.prompt.slice(0, 34)}" :: "${seedOption.label.slice(0, 28)}" ${option.position} -> ${wanted} (weight ${option.weight}, untouched)`,
      )
      changed++
      if (execute) {
        // Positions are only unique by convention, not by constraint, so a
        // transient duplicate mid-shuffle is tolerated and resolved by the
        // time the loop finishes.
        const { error } = await db.from("quiz_options").update({ position: wanted }).eq("id", option.id)
        if (error) throw error
      }
    }
  }

  console.log(
    changed === 0
      ? "\nAlready in sync — nothing to do."
      : execute
        ? `\n✓ Reordered ${changed} option(s). No weight was changed, so no past score changes meaning.`
        : `\nDRY RUN — ${changed} option(s) would move. Re-run with --execute.`,
  )
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
