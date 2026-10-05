/**
 * Creates one of the hand-written funnel pages that replace the GHL pages on
 * athletequiz.darrenjpaul.com.
 *
 *   npx tsx scripts/seed-funnel-pages.ts <page> .env.local [--business=<uuid>]             # dry run
 *   npx tsx scripts/seed-funnel-pages.ts <page> .env.local [--business=<uuid>] --execute
 *
 *   rpi         /go/rotational-performance-index (+ /quiz)  replaces /home-page
 *   gap-map     /go/performance-gap-map (+ /quiz)           replaces /take-the-quiz
 *   onboarding  /go/onboarding                              replaces /onboarding
 *
 * DRY-RUN IS THE DEFAULT. --execute is the only way to write.
 *
 * WHOSE PAGE. A page with a quiz is created under that quiz's own business, found
 * by the quiz's key. A page without one (onboarding) has no row to take a
 * business from, so `--business` is required for it; it is never defaulted.
 *
 * Re-running against a DRAFT rewrites its pages; a published funnel is refused,
 * because changing a live page belongs in the admin UI.
 *
 * Before writing, every page goes through the checks publish runs: the section
 * grammar, `reassemble` (render + size caps) and `publishGate(resolveDoc(...))`
 * against this database's catalogues. A blocker stops the write.
 *
 * IT DOES NOT PUBLISH. Publish from /admin/funnels (or /admin/pages), which runs
 * the one real compile-and-freeze path.
 */
import { config } from "dotenv"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const args = process.argv.slice(2)
const pageName = args.find((a) => !a.startsWith(".env") && !a.startsWith("--")) ?? ""
const envPath = args.find((a) => a.startsWith(".env")) ?? ".env.local"
const execute = args.includes("--execute")
const businessArg = args.find((a) => a.startsWith("--business="))?.split("=")[1] ?? null
config({ path: envPath })

type PageSpec = {
  slug: string
  name: string
  kind: "funnel" | "page"
  /** The quiz the page's quiz step runs; also whose business the page is created under. */
  quizKey?: string
  steps: (ctx: { businessName: string; quizId: string | null }) => Promise<{ slug: string; name: string; doc: SectionDoc }[]>
}

const PAGES: Record<string, PageSpec> = {
  rpi: {
    slug: "rotational-performance-index",
    name: "Rotational Performance Index",
    kind: "funnel",
    quizKey: "rotational-performance-index",
    steps: async ({ businessName, quizId }) => {
      const { buildRpiLandingDoc, RPI_QUIZ_STEP_SLUG } = await import("./lib/rpi-landing-doc")
      const { buildQuizFunnelDoc } = await import("@/lib/funnels/quiz-funnel-doc")
      return [
        { slug: "index", name: "Landing page", doc: buildRpiLandingDoc({ businessName }) },
        { slug: RPI_QUIZ_STEP_SLUG, name: "Quiz", doc: buildQuizFunnelDoc({ quizId: quizId!, businessName }) },
      ]
    },
  },
  "gap-map": {
    slug: "performance-gap-map",
    name: "Performance Gap Map",
    kind: "funnel",
    quizKey: "rpi_athlete_quiz",
    steps: async ({ businessName, quizId }) => {
      const { buildGapMapLandingDoc, GAP_MAP_QUIZ_STEP_SLUG } = await import("./lib/gap-map-landing-doc")
      const { buildQuizFunnelDoc } = await import("@/lib/funnels/quiz-funnel-doc")
      return [
        { slug: "index", name: "Landing page", doc: buildGapMapLandingDoc({ businessName }) },
        { slug: GAP_MAP_QUIZ_STEP_SLUG, name: "Quiz", doc: buildQuizFunnelDoc({ quizId: quizId!, businessName }) },
      ]
    },
  },
  onboarding: {
    slug: "onboarding",
    name: "Pre-visit onboarding",
    kind: "page",
    steps: async ({ businessName }) => {
      const { buildOnboardingDoc } = await import("./lib/onboarding-doc")
      return [{ slug: "index", name: "Landing page", doc: buildOnboardingDoc({ businessName }) }]
    },
  },
}

async function main() {
  const spec = PAGES[pageName]
  if (!spec) throw new Error(`Name a page: ${Object.keys(PAGES).join(" | ")}`)

  const { createClient } = await import("@supabase/supabase-js")
  const { sectionDocSchema } = await import("@/lib/funnels/sections/registry")
  const { reassemble } = await import("@/lib/funnels/sections/doc")
  const { loadCatalogues, resolveDoc, publishGate } = await import("@/lib/funnels/sections/resolve")
  const { createFunnel } = await import("@/lib/db/funnels")
  const { getBusinessSettings } = await import("@/lib/db/businesses")

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
  console.log(`${execute ? "EXECUTE" : "DRY RUN"} /go/${spec.slug} against ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

  // ---- whose page -----------------------------------------------------------
  let businessId = businessArg
  let quizId: string | null = null
  if (spec.quizKey) {
    const { data: quizzes, error } = await supabase
      .from("quizzes")
      .select("id, business_id, name, status")
      .eq("key", spec.quizKey)
    if (error) throw new Error(`quizzes: ${error.message}`)
    if (!quizzes || quizzes.length !== 1) {
      throw new Error(`Expected exactly one quiz with key "${spec.quizKey}", found ${quizzes?.length ?? 0}.`)
    }
    const quiz = quizzes[0]
    if (businessId && businessId !== quiz.business_id) {
      throw new Error(`--business ${businessId} is not the quiz's business (${quiz.business_id}).`)
    }
    businessId = quiz.business_id as string
    quizId = quiz.id as string
    console.log(`Quiz      ${quiz.name} (${quiz.status}) ${quiz.id}`)
    if (quiz.status !== "active") console.log(`  NOTE  the quiz is ${quiz.status}; the publish gate will refuse the quiz step.`)
  }
  if (!businessId) throw new Error(`"${pageName}" has no quiz to take a business from. Pass --business=<uuid>.`)

  // The footer names the page's own business, read the way the create route
  // reads it (G47); the footer's schema needs 1-120 characters.
  const businessName = ((await getBusinessSettings(businessId)).display_name ?? "").trim().slice(0, 120)
  if (!businessName) throw new Error(`Business ${businessId} has no display name for the footer.`)
  console.log(`Business  ${businessName} ${businessId}\n`)

  const steps = await spec.steps({ businessName, quizId })

  // ---- the checks publish runs, before anything is written ----------------
  const catalogues = await loadCatalogues(businessId)
  const stepRefs = steps.map(({ slug, name }) => ({ slug, name }))
  let blocked = false
  for (const step of steps) {
    sectionDocSchema.parse(step.doc)
    const ids = step.doc.sections.map((s) => s.id)
    if (new Set(ids).size !== ids.length) throw new Error(`${step.slug}: duplicate section ids`)
    const { problems } = reassemble(step.doc, { funnelBasePath: `/go/${spec.slug}` })
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
    .ilike("slug", spec.slug)
    .maybeSingle()
  if (existingError) throw new Error(`funnels: ${existingError.message}`)

  if (!existing) {
    console.log(`\n  CREATE ${spec.kind} /go/${spec.slug} with steps ${steps.map((s) => s.slug).join(", ")}`)
    if (execute) {
      const funnel = await createFunnel(businessId, {
        slug: spec.slug,
        name: spec.name,
        kind: spec.kind,
        goal: "leads",
        steps: steps.map((s) => ({ slug: s.slug, name: s.name, goal: "leads", projectData: s.doc })),
      })
      console.log(`  created ${funnel.id}`)
    }
  } else {
    if (existing.status !== "draft") {
      throw new Error(`/go/${spec.slug} exists and is ${existing.status}. Edit a live page in the admin UI.`)
    }
    if (existing.kind !== spec.kind) {
      throw new Error(`/go/${spec.slug} exists as a ${existing.kind}, not a ${spec.kind}. Fix it by hand.`)
    }
    const { data: rows, error: rowsError } = await supabase
      .from("funnel_steps")
      .select("id, slug")
      .eq("funnel_id", existing.id)
    if (rowsError) throw new Error(`funnel_steps: ${rowsError.message}`)
    for (const step of steps) {
      const row = (rows ?? []).find((r) => r.slug === step.slug)
      if (!row) throw new Error(`Draft ${existing.id} has no /${step.slug} step. Fix it by hand.`)
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

  console.log(
    execute
      ? `\n✓ Done. Draft only. Preview at /preview/${spec.slug}, publish from the admin.`
      : "\nDRY RUN: nothing written. Re-run with --execute.",
  )
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
