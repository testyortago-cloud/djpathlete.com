/**
 * Seeds the Rotational Performance Index
 * (lib/quizzes/seed/rotational-performance-index.ts) into a database.
 *
 *   npx tsx scripts/seed-rotational-performance-index.ts                 # dry run, dev
 *   npx tsx scripts/seed-rotational-performance-index.ts --execute       # write to dev
 *   npx tsx scripts/seed-rotational-performance-index.ts .env.prod --execute --allow-non-clone
 *
 * DRY-RUN IS THE DEFAULT; --execute is the only way to write. Same convention
 * as scripts/seed-athlete-quiz.ts, and for the same reason: seeding a quiz
 * into production by fat-fingering an env path is a quiz appearing on the
 * owner's list uninvited.
 *
 * WHY .ts VIA `npx tsx`. The seed is a TypeScript module and importing it
 * directly is the entire point — a hand-copied .mjs version of the quiz would
 * drift from the one `quizGate` validates in CI, invisibly.
 *
 * ADDITIVE, NEVER DESTRUCTIVE. If a quiz with this key already exists the
 * script REFUSES rather than updating, because an update would silently
 * overwrite whatever the owner last edited in the admin editor. Replacing the
 * contents of an existing quiz is a deliberate act and is not this script.
 *
 * GATED BEFORE IT WRITES. `quizGate` runs against the seed first, so a seed
 * that could not be activated is never inserted in the first place.
 */
import { config } from "dotenv"

const args = process.argv.slice(2)
const envPath = args.find((a) => a.startsWith(".env")) ?? ".env.local"
const execute = args.includes("--execute")
const allowNonClone = args.includes("--allow-non-clone")

config({ path: envPath })

/** The dev clone. Any other project needs --allow-non-clone said out loud. */
const CLONE_HOST = "anjvztjiokcgiyhobknq"

async function main() {
  const { quizGate } = await import("@/lib/quizzes/gate")
  const { walkedQuestions } = await import("@/lib/quizzes/score")
  const { createQuizFrom } = await import("@/lib/db/quizzes")
  const { platformBusinessId } = await import("@/lib/tenancy/platform")
  const { ROTATIONAL_PERFORMANCE_INDEX, toDefinition } = await import(
    "@/lib/quizzes/seed/rotational-performance-index"
  )
  const { createClient } = await import("@supabase/supabase-js")

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  if (!url.includes(CLONE_HOST) && !allowNonClone) {
    throw new Error(`${envPath} points at ${url}, not the dev clone. Pass --allow-non-clone to mean it.`)
  }

  const definition = toDefinition(ROTATIONAL_PERFORMANCE_INDEX)

  // GATE FIRST. A seed that cannot be activated should never reach a row.
  const gate = quizGate(definition)
  console.log(`Gate: ${gate.ok ? "PASS" : "FAIL"}`)
  for (const blocker of gate.blockers) console.log(`  BLOCKER  ${blocker}`)
  for (const warning of gate.warnings) console.log(`  warning  ${warning}`)
  if (!gate.ok) throw new Error("Seed does not pass the activation gate; refusing to write it.")

  const scored = definition.questions.filter((q) => q.options.some((o) => o.weight > 0))

  // PER WALK, NOT PER QUIZ. Summing the best option over every scored question
  // in the table counts all five branches' copies of Q1 and reports 45, which
  // no visitor can ever score. `scoreQuiz` divides by the max of the walk they
  // actually took, so that is the number worth printing.
  const perBranch = definition.branches.map((branch) => {
    const walk = walkedQuestions(definition, branch.id)
    const max = walk.reduce((sum, q) => sum + Math.max(...q.options.map((o) => o.weight), 0), 0)
    return { key: branch.key, asked: walk.length, max }
  })
  const maxima = [...new Set(perBranch.map((b) => b.max))]

  console.log(
    `\n${definition.name}\n` +
      `  target      ${url}\n` +
      `  branches    ${definition.branches.length} (${perBranch.map((b) => b.key).join(", ")})\n` +
      `  questions   ${definition.questions.length} in total; ${scored.length} scored\n` +
      `  per walk    ${[...new Set(perBranch.map((b) => b.asked))].join("/")} asked, max raw ${maxima.join("/")}\n` +
      `  with media  ${definition.questions.filter((q) => q.mediaUrl).length}\n` +
      `  tiers       ${definition.tiers.map((t) => `${t.key} ${t.minScore}-${t.maxScore}`).join(", ")}`,
  )
  if (maxima.length > 1) {
    // Not fatal — `normalise` exists precisely so branches need not match — but
    // it is worth saying out loud, because an unintended difference here means
    // one archetype is being scored against a different denominator.
    console.log("  NOTE: branches do not share a maximum; scores are normalised, but check that is intended.")
  }

  if (!execute) {
    console.log("\nDRY RUN — nothing written. Re-run with --execute to write.")
    return
  }

  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
  const businessId = platformBusinessId()
  const { data: existing } = await supabase
    .from("quizzes")
    .select("id, key")
    .eq("business_id", businessId)
    .eq("key", definition.key)
    .maybeSingle()
  if (existing) {
    throw new Error(
      `A quiz with key "${definition.key}" already exists (${existing.id}). ` +
        "This script refuses to overwrite an existing quiz — retire it in the editor first.",
    )
  }

  const created = await createQuizFrom(businessId, { source: definition, name: definition.name })
  console.log(`\n✓ Created quiz ${created.id} (key "${created.key}") as a DRAFT.`)
  console.log("  Activation is still a deliberate act in /admin/quizzes — the gate runs again there.")
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
