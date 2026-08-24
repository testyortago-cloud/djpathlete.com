/**
 * Builds a REAL published funnel around the seeded Athlete Quiz, so the quiz
 * can be driven at /go/<slug> exactly as a visitor reaches it.
 *
 *   npx tsx scripts/seed-athlete-quiz-funnel.ts                 # dry run, dev clone
 *   npx tsx scripts/seed-athlete-quiz-funnel.ts --execute
 *
 * DRY-RUN IS THE DEFAULT and it REFUSES ANY PROJECT THAT IS NOT THE DEV CLONE.
 * This publishes a public page; doing that to production by fat-fingering an
 * env path is a live URL nobody asked for.
 *
 * It runs the REAL publish sequence — `reassemble` then `compileFunnelStep` —
 * rather than hand-writing a node tree, because a screenshot of a page built a
 * different way from the real one proves nothing about the real one.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { reassemble } from "@/lib/funnels/sections/doc"
import { compileFunnelStep } from "@/lib/funnels/compile"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const CLONE_REF = "anjvztjiokcgiyhobknq"
const SLUG = "athlete-quiz"

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

function doc(quizId: string): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          eyebrow: "Three minutes",
          headline: "What is quietly limiting your performance?",
          sub: "Answer a few questions about your sport and how your body is holding up, and get a readout of where the gaps are.",
          primaryCta: { label: "Start the quiz", target: { kind: "anchor", sectionId: "quiz1" } },
        },
      },
      {
        id: "quiz1",
        kind: "quiz",
        variant: "boxed",
        style: {},
        props: {
          heading: "The Athlete Quiz",
          sub: "Built from the same profile we use in a full assessment.",
          quizId,
          submitLabel: "See my result",
        },
      },
      {
        id: "foot1",
        kind: "footer",
        variant: "simple",
        style: {},
        props: { businessName: "DJP Athlete", lines: ["Tampa Bay, FL"], links: [], legal: "All rights reserved." },
      },
    ],
  }
}

async function main() {
  const args = process.argv.slice(2)
  const execute = args.includes("--execute")
  const envPath = args.filter((a) => !a.startsWith("--"))[0] ?? ".env.local"
  const env = loadEnv(envPath)
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error(`${envPath} is missing Supabase credentials`)

  const ref = new URL(url).host.split(".")[0]
  console.log(`project : ${ref}${ref === CLONE_REF ? "  (dev clone)" : "  (NOT the clone)"}`)
  console.log(`mode    : ${execute ? "EXECUTE" : "dry run"}`)
  if (ref !== CLONE_REF) {
    console.error("REFUSING: this script publishes a public page and only ever targets the dev clone.")
    process.exit(1)
  }

  const sb = createClient(url, key, { auth: { persistSession: false } })

  const { data: quiz, error: quizError } = await sb
    .from("quizzes")
    .select("id,key,status")
    .eq("key", "rpi_athlete_quiz")
    .maybeSingle()
  if (quizError) throw new Error(`reading quizzes: ${quizError.message}`)
  if (!quiz) throw new Error("rpi_athlete_quiz is not seeded — run scripts/seed-athlete-quiz.ts first")
  console.log(`quiz    : ${quiz.id} (${quiz.status})`)

  const built = doc(quiz.id as string)
  const { html, css } = reassemble(built)
  const compiled = compileFunnelStep({ html, css })
  // CompileResult is a discriminated union: `ok: false` carries only fatal
  // errors, `ok: true` carries nodes plus non-fatal warnings.
  if (!compiled.ok) {
    for (const e of compiled.errors) console.error(`  compile error: ${JSON.stringify(e)}`)
    console.error("REFUSING: the page does not compile clean.")
    process.exit(1)
  }
  console.log(`compiled: ${compiled.nodes.length} nodes, ${compiled.css.length} bytes css, ${compiled.warnings.length} warnings`)
  for (const w of compiled.warnings) console.log(`  warning: ${JSON.stringify(w)}`)

  if (!execute) {
    console.log("\nDry run. Nothing written. Re-run with --execute.")
    return
  }

  const { data: existing } = await sb.from("funnels").select("id").eq("slug", SLUG).maybeSingle()
  let funnelId = existing?.id as string | undefined
  if (!funnelId) {
    const { data, error } = await sb
      .from("funnels")
      .insert({ slug: SLUG, name: "Athlete Quiz", description: "The RPI quiz funnel.", status: "published" })
      .select("id")
      .single()
    if (error) throw new Error(`inserting funnel: ${error.message}`)
    funnelId = data.id as string
  } else {
    await sb.from("funnels").update({ status: "published" }).eq("id", funnelId)
  }
  console.log(`funnel  : ${funnelId}`)

  const { data: existingStep } = await sb
    .from("funnel_steps")
    .select("id")
    .eq("funnel_id", funnelId)
    .eq("slug", "start")
    .maybeSingle()
  let stepId = existingStep?.id as string | undefined
  if (!stepId) {
    const { data, error } = await sb
      .from("funnel_steps")
      .insert({ funnel_id: funnelId, slug: "start", name: "Start", position: 0, is_entry: true, project_data: built })
      .select("id")
      .single()
    if (error) throw new Error(`inserting step: ${error.message}`)
    stepId = data.id as string
  } else {
    await sb.from("funnel_steps").update({ project_data: built }).eq("id", stepId)
  }
  console.log(`step    : ${stepId}`)

  const { data: last } = await sb
    .from("funnel_step_versions")
    .select("version")
    .eq("step_id", stepId)
    .order("version", { ascending: false })
    .limit(1)
  const nextVersion = ((last?.[0]?.version as number | undefined) ?? 0) + 1

  const { data: version, error: versionError } = await sb
    .from("funnel_step_versions")
    .insert({ step_id: stepId, version: nextVersion, nodes: compiled.nodes, css: compiled.css, project_data: built })
    .select("id")
    .single()
  if (versionError) throw new Error(`inserting version: ${versionError.message}`)

  await sb.from("funnel_steps").update({ published_version_id: version.id }).eq("id", stepId)
  console.log(`version : v${nextVersion} (${version.id})`)
  console.log(`\nPublished. Reach it at /go/${SLUG}`)
}

main().catch((e: unknown) => {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
