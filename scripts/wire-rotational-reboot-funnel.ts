/**
 * Wires the `rotational-reboot-score` funnel to the Rotational Performance
 * Index, and trims the steps that were never built.
 *
 *   npx tsx scripts/wire-rotational-reboot-funnel.ts .env.prod                        # dry run
 *   npx tsx scripts/wire-rotational-reboot-funnel.ts .env.prod --execute
 *
 * DRY-RUN IS THE DEFAULT. --execute is the only way to write.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   1. Deletes the funnel's EMPTY steps — Offer, Check out, Confirmation, each
 *      with `project_data` NULL because nobody ever built them. Guarded twice:
 *      a step is only dropped if its document is null AND it has no
 *      `funnel_submissions`. A step with either is left alone and reported.
 *      Publishing with them in place is the live-funnel-whose-own-buttons-404
 *      state this repo has already shipped once.
 *
 *   2. Repoints the Quiz step's `quiz` section at the new quiz. The funnel
 *      pointed at a CLONE of the athlete quiz — four avatar branches, no
 *      movement tests — which is not what the page promises.
 *
 *   3. Activates the quiz, but ONLY after running the real `quizGate` against
 *      the definition as READ BACK FROM THIS DATABASE. Gating the local seed
 *      would prove nothing about the rows that actually landed; this is the
 *      same check `/api/admin/quizzes/[id]` runs before it will flip the
 *      status, executed against the same bytes.
 *
 *   IT DOES NOT PUBLISH. Publishing compiles and freezes a version row through
 *      `loadCatalogues -> resolveDoc -> publishGate -> reassemble ->
 *      compileFunnelStep`. Hand-rolling a second copy of that sequence is this
 *      subsystem's worst failure mode — preview and publish disagreeing about
 *      one document — so the final click stays in the admin UI, where the one
 *      real implementation lives.
 */
import { config } from "dotenv"

const args = process.argv.slice(2)
const envPath = args.find((a) => a.startsWith(".env")) ?? ".env.local"
const execute = args.includes("--execute")
config({ path: envPath })

const FUNNEL_SLUG = "rotational-reboot-score"
const QUIZ_NAME = "Rotational Performance Index"

async function main() {
  const { createClient } = await import("@supabase/supabase-js")
  const { quizGate } = await import("@/lib/quizzes/gate")
  const { getQuizDefinition } = await import("@/lib/db/quizzes")

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  )
  const mode = execute ? "EXECUTE" : "DRY RUN"
  console.log(`${mode} against ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, key, name, status")
    .eq("name", QUIZ_NAME)
    .maybeSingle()
  if (!quiz) throw new Error(`No quiz named "${QUIZ_NAME}". Seed it first.`)

  const { data: funnel } = await supabase
    .from("funnels")
    .select("id, name, slug, status, kind")
    .eq("slug", FUNNEL_SLUG)
    .maybeSingle()
  if (!funnel) throw new Error(`No funnel with slug "${FUNNEL_SLUG}".`)

  const { data: steps } = await supabase
    .from("funnel_steps")
    .select("id, name, slug, position, project_data")
    .eq("funnel_id", funnel.id)
    .order("position")
  const rows = steps ?? []

  console.log(`Funnel  ${funnel.name} (${funnel.status}, ${funnel.kind}) — ${rows.length} step(s)`)
  console.log(`Quiz    ${quiz.name} (${quiz.status}, key "${quiz.key}")\n`)

  // ---- 1. the never-built steps -------------------------------------------
  for (const step of rows) {
    if (step.project_data !== null) continue
    const { count } = await supabase
      .from("funnel_submissions")
      .select("id", { count: "exact", head: true })
      .eq("step_id", step.id)
    if ((count ?? 0) > 0) {
      console.log(`  KEEP   "${step.name}" — empty, but has ${count} submission(s). Not touching it.`)
      continue
    }
    console.log(`  DELETE "${step.name}" (/${step.slug}) — never built, no submissions`)
    if (execute) {
      const { error } = await supabase.from("funnel_steps").delete().eq("id", step.id)
      if (error) throw error
    }
  }

  // ---- 2. repoint the quiz block ------------------------------------------
  for (const step of rows) {
    const doc = step.project_data as { sections?: { kind?: string; props?: { quizId?: string } }[] } | null
    const section = doc?.sections?.find((s) => s.kind === "quiz")
    if (!section?.props) continue
    if (section.props.quizId === quiz.id) {
      console.log(`  OK     "${step.name}" already points at ${quiz.id}`)
      continue
    }
    console.log(`  REPOINT "${step.name}": ${section.props.quizId} -> ${quiz.id}`)
    if (execute) {
      section.props.quizId = quiz.id
      const { error } = await supabase
        .from("funnel_steps")
        .update({ project_data: doc })
        .eq("id", step.id)
      if (error) throw error
    }
  }

  // ---- 3. gate, then activate ---------------------------------------------
  // AGAINST THE DATABASE'S OWN COPY. Gating the local seed module would pass
  // trivially and prove nothing about the rows that landed.
  const definition = await getQuizDefinition(quiz.id)
  if (!definition) throw new Error(`Could not read quiz ${quiz.id} back.`)
  const gate = quizGate(definition)
  console.log(`\n  Gate (against the rows in this database): ${gate.ok ? "PASS" : "FAIL"}`)
  for (const b of gate.blockers) console.log(`    BLOCKER  ${b}`)
  for (const w of gate.warnings) console.log(`    warning  ${w}`)
  if (!gate.ok) throw new Error("Quiz does not pass the gate; refusing to activate it.")

  if (quiz.status !== "active") {
    console.log(`  ACTIVATE quiz ${quiz.id}`)
    if (execute) {
      const { error } = await supabase.from("quizzes").update({ status: "active" }).eq("id", quiz.id)
      if (error) throw error
    }
  }

  console.log(
    execute
      ? "\n✓ Done. The funnel is still a DRAFT — publish it from /admin/funnels, which runs publishGate."
      : "\nDRY RUN — nothing written. Re-run with --execute.",
  )
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
