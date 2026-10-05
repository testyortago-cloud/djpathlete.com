/**
 * Creates the "Rotational Performance Index" funnel: a landing page, then the
 * RPI quiz with its demo and "Common mistakes" clips.
 *
 *   npx tsx scripts/seed-rpi-landing-funnel.ts .env.local             # dry run
 *   npx tsx scripts/seed-rpi-landing-funnel.ts .env.local --execute
 *
 * DRY-RUN IS THE DEFAULT. --execute is the only way to write.
 *
 *   /go/rotational-performance-index        landing page (scripts/lib/rpi-landing-doc.ts)
 *   /go/rotational-performance-index/quiz   the quiz (lib/funnels/quiz-funnel-doc.ts)
 *
 * The quiz is found by its key, `rotational-performance-index`, and the funnel
 * is created under that quiz's own business. Re-running against a DRAFT funnel
 * rewrites both pages; a published funnel is refused, because changing a live
 * page belongs in the admin UI.
 *
 * Before writing, both pages go through the same checks publish runs:
 * the section grammar, `reassemble` (render + size caps) and
 * `publishGate(resolveDoc(...))` against this database's catalogues. A blocker
 * stops the write.
 *
 * IT DOES NOT PUBLISH. Publish from /admin/funnels, which runs the one real
 * compile-and-freeze path (and freezes the CSS of that moment).
 */
import { config } from "dotenv"

const args = process.argv.slice(2)
const envPath = args.find((a) => a.startsWith(".env")) ?? ".env.local"
const execute = args.includes("--execute")
config({ path: envPath })

const FUNNEL_SLUG = "rotational-performance-index"
const FUNNEL_NAME = "Rotational Performance Index"
const QUIZ_KEY = "rotational-performance-index"

async function main() {
  const { createClient } = await import("@supabase/supabase-js")
  const { buildRpiLandingDoc, RPI_QUIZ_STEP_SLUG } = await import("./lib/rpi-landing-doc")
  const { buildQuizFunnelDoc } = await import("@/lib/funnels/quiz-funnel-doc")
  const { sectionDocSchema } = await import("@/lib/funnels/sections/registry")
  const { reassemble } = await import("@/lib/funnels/sections/doc")
  const { loadCatalogues, resolveDoc, publishGate } = await import("@/lib/funnels/sections/resolve")
  const { createFunnel } = await import("@/lib/db/funnels")
  const { ENTRY_STEP_SLUG } = await import("@/lib/funnels/templates")
  const { getBusinessSettings } = await import("@/lib/db/businesses")

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
  console.log(`${execute ? "EXECUTE" : "DRY RUN"} against ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

  const { data: quizzes, error: quizError } = await supabase
    .from("quizzes")
    .select("id, business_id, name, status")
    .eq("key", QUIZ_KEY)
  if (quizError) throw new Error(`quizzes: ${quizError.message}`)
  if (!quizzes || quizzes.length !== 1) {
    throw new Error(`Expected exactly one quiz with key "${QUIZ_KEY}", found ${quizzes?.length ?? 0}.`)
  }
  const quiz = quizzes[0]
  const businessId = quiz.business_id as string

  // The footer names the quiz's own business, read the way the create route
  // reads it (G47); the footer's schema needs 1-120 characters.
  const businessName = ((await getBusinessSettings(businessId)).display_name ?? "").trim().slice(0, 120)
  if (!businessName) throw new Error(`Business ${businessId} has no display name for the footer.`)

  console.log(`Quiz      ${quiz.name} (${quiz.status}) ${quiz.id}`)
  console.log(`Business  ${businessName} ${businessId}\n`)

  const steps = [
    { slug: ENTRY_STEP_SLUG, name: "Landing page", doc: buildRpiLandingDoc({ businessName }) },
    {
      slug: RPI_QUIZ_STEP_SLUG,
      name: "Quiz",
      doc: buildQuizFunnelDoc({ quizId: quiz.id as string, businessName }),
    },
  ]

  // ---- the checks publish runs, before anything is written ----------------
  const catalogues = await loadCatalogues(businessId)
  const stepRefs = steps.map(({ slug, name }) => ({ slug, name }))
  let blocked = false
  for (const step of steps) {
    sectionDocSchema.parse(step.doc)
    const ids = step.doc.sections.map((s) => s.id)
    if (new Set(ids).size !== ids.length) throw new Error(`${step.slug}: duplicate section ids`)
    const { problems } = reassemble(step.doc, { funnelBasePath: `/go/${FUNNEL_SLUG}` })
    const gate = publishGate(resolveDoc(step.doc, catalogues, stepRefs))
    console.log(`  /${step.slug}: ${gate.blockers.length === 0 && problems.length === 0 ? "PASS" : "FAIL"}`)
    for (const p of problems) console.log(`    PROBLEM  ${typeof p === "string" ? p : JSON.stringify(p)}`)
    for (const b of gate.blockers) console.log(`    BLOCKER  ${b}`)
    for (const w of gate.warnings) console.log(`    warning  ${w}`)
    if (problems.length > 0 || gate.blockers.length > 0) blocked = true
  }
  if (blocked) throw new Error("\nA page would not publish as written. Nothing was written.")

  // ---- write ---------------------------------------------------------------
  const { data: existing, error: existingError } = await supabase
    .from("funnels")
    .select("id, status, kind")
    .eq("business_id", businessId)
    .ilike("slug", FUNNEL_SLUG)
    .maybeSingle()
  if (existingError) throw new Error(`funnels: ${existingError.message}`)

  if (!existing) {
    console.log(`\n  CREATE funnel /go/${FUNNEL_SLUG} with steps ${steps.map((s) => s.slug).join(", ")}`)
    if (execute) {
      const funnel = await createFunnel(businessId, {
        slug: FUNNEL_SLUG,
        name: FUNNEL_NAME,
        kind: "funnel",
        goal: "leads",
        steps: steps.map((s) => ({ slug: s.slug, name: s.name, goal: "leads", projectData: s.doc })),
      })
      console.log(`  created ${funnel.id}`)
    }
  } else {
    if (existing.status !== "draft") {
      throw new Error(`/go/${FUNNEL_SLUG} exists and is ${existing.status}. Edit a live funnel in the admin UI.`)
    }
    const { data: rows, error: rowsError } = await supabase
      .from("funnel_steps")
      .select("id, slug")
      .eq("funnel_id", existing.id)
    if (rowsError) throw new Error(`funnel_steps: ${rowsError.message}`)
    for (const step of steps) {
      const row = (rows ?? []).find((r) => r.slug === step.slug)
      if (!row) throw new Error(`Draft funnel ${existing.id} has no /${step.slug} step. Fix it by hand.`)
      console.log(`\n  REWRITE draft /${step.slug} (${row.id})`)
      if (execute) {
        const { error } = await supabase
          .from("funnel_steps")
          .update({ project_data: step.doc, updated_at: new Date().toISOString() })
          .eq("id", row.id)
        if (error) throw new Error(`update /${step.slug}: ${error.message}`)
      }
    }
  }

  if (quiz.status !== "active") {
    console.log(`\n  NOTE  the quiz is ${quiz.status}. Publishing will refuse until it is activated in the quiz editor.`)
  }
  console.log(
    execute
      ? `\n✓ Done. Draft only. Preview at /preview/${FUNNEL_SLUG}, publish from /admin/funnels.`
      : "\nDRY RUN: nothing written. Re-run with --execute.",
  )
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
