/**
 * Writes real search copy onto published funnel steps.
 *
 *   npx tsx scripts/apply-funnel-seo-copy.ts .env.prod
 *   npx tsx scripts/apply-funnel-seo-copy.ts .env.prod --execute
 *
 * WHY A SCRIPT AND NOT THE ADMIN PANEL. The panel (Search tab in the builder)
 * is the answer from here on and is the actual deliverable — this exists to
 * apply the FIRST set, written against the audit, without asking the owner to
 * retype 150 characters of measured copy into a box. Anything the panel writes
 * afterwards is his and this script will not touch it (see --force below).
 *
 * KEYED ON SLUGS, NEVER ON IDS. A funnel id read out of the dev clone does not
 * exist in production, and a script keyed on one "succeeds" against prod
 * having matched nothing at all. `funnels.slug` + `funnel_steps.slug` are the
 * business values that mean the same thing in both databases.
 *
 * EVERY SELECT'S `error` IS CHECKED BEFORE ITS `data`. PostgREST answers a bad
 * column with `{ data: null, error }`, which reads exactly like "no rows
 * matched" — this repo has already shipped a confident, wrong "refusing, count
 * mismatch" built on exactly that.
 *
 * REFUSES TO OVERWRITE. A step whose `seo_title` or `seo_description` is
 * already set is skipped and named. Once the owner has typed his own copy the
 * script must not silently replace it with the version in this file. `--force`
 * is there for a deliberate re-apply and says so on every line it changes.
 *
 * `og_image_url` IS DELIBERATELY LEFT NULL. There is no purpose-made 1200x630
 * share card in this repo — only three general gym photos — and
 * `resolveFunnelStepSeo` already falls back to the site-wide image, so the
 * page serves a real og:image either way. Writing that same path into the
 * column would be a second copy of a default that then stops tracking it. A
 * proper quiz share card is a design task, noted in the audit.
 */
import { config } from "dotenv"

const args = process.argv.slice(2)
const envPath = args.find((a) => a.startsWith(".env")) ?? ".env.local"
const execute = args.includes("--execute")
const force = args.includes("--force")
config({ path: envPath })

interface SeoCopy {
  funnelSlug: string
  stepSlug: string
  /** Page-level title. No brand — the layout template appends " | DJP Athlete". */
  seoTitle: string
  seoDescription: string
  /** Every factual claim, and where on the live page it is verifiable. */
  provenance: string
}

/**
 * The copy, written with `marketing-skills:copywriting` against
 * `.agents/slug-and-metadata-convention.md` and measured before being pasted
 * here: title <= 47 (58 rendered), description 150-160 with the primary
 * keyword inside the first 50 characters.
 *
 * Only ONE entry, because only one funnel is published. The other nine steps
 * are drafts; giving them copy now would be writing for pages whose content
 * can still change, and the panel is how they get it when they go live.
 */
const COPY: SeoCopy[] = [
  {
    funnelSlug: "athlete-quiz",
    stepSlug: "start",
    seoTitle: "Athlete Performance Quiz — 5 Questions, Free",
    seoDescription:
      "Free athlete performance quiz for ages 13-25. Answer five questions and see the one gap limiting your speed and power — and what to fix first. No email.",
    provenance:
      'free + "No email required" (hero paragraph); five questions ("Get your performance gap, in five questions"); ages 13-25 ("Ages 13 to 25, in-season or off"); the gap and what to fix ("your biggest weak point in plain English, plus the first thing to fix in training this month")',
  },
]

const TITLE_BUDGET = 47
const DESCRIPTION_MIN = 150
const DESCRIPTION_MAX = 160

async function main() {
  const { createClient } = await import("@supabase/supabase-js")

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (!url || !key) throw new Error(`Missing Supabase credentials in ${envPath}.`)

  const db = createClient(url, key)
  console.log(`${execute ? "EXECUTE" : "DRY RUN"} against ${url}`)
  console.log(`${force ? "FORCE: existing copy WILL be overwritten\n" : ""}`)

  // Measured here, not trusted from the comment above. A budget stated in
  // prose is a claim; this is the check.
  for (const entry of COPY) {
    if (entry.seoTitle.length > TITLE_BUDGET) {
      throw new Error(
        `${entry.funnelSlug}/${entry.stepSlug}: title is ${entry.seoTitle.length} chars, budget is ${TITLE_BUDGET}.`,
      )
    }
    const length = entry.seoDescription.length
    if (length < DESCRIPTION_MIN || length > DESCRIPTION_MAX) {
      throw new Error(
        `${entry.funnelSlug}/${entry.stepSlug}: description is ${length} chars, budget is ${DESCRIPTION_MIN}-${DESCRIPTION_MAX}.`,
      )
    }
  }

  let changed = 0
  let skipped = 0

  for (const entry of COPY) {
    const label = `/go/${entry.funnelSlug} (${entry.stepSlug})`

    const { data: funnel, error: funnelError } = await db
      .from("funnels")
      .select("id, name, status")
      .eq("slug", entry.funnelSlug)
      .maybeSingle()
    if (funnelError) throw new Error(`reading funnel ${entry.funnelSlug}: ${funnelError.message}`)
    if (!funnel) {
      console.log(`  MISS   ${label} — no funnel with that slug`)
      skipped++
      continue
    }

    const { data: step, error: stepError } = await db
      .from("funnel_steps")
      .select("id, name, seo_title, seo_description, noindex, published_version_id")
      .eq("funnel_id", funnel.id)
      .eq("slug", entry.stepSlug)
      .maybeSingle()
    if (stepError) throw new Error(`reading step ${label}: ${stepError.message}`)
    if (!step) {
      console.log(`  MISS   ${label} — funnel found, but no step with that slug`)
      skipped++
      continue
    }

    const occupied = step.seo_title !== null || step.seo_description !== null
    if (occupied && !force) {
      console.log(`  KEEP   ${label} — already has copy; not overwriting`)
      console.log(`           title: ${JSON.stringify(step.seo_title)}`)
      skipped++
      continue
    }

    console.log(`  ${occupied ? "REPLACE" : "WRITE  "} ${label}`)
    console.log(`           status: funnel=${funnel.status}, published=${Boolean(step.published_version_id)}`)
    console.log(`           title (${entry.seoTitle.length}): ${entry.seoTitle}`)
    console.log(`           desc  (${entry.seoDescription.length}): ${entry.seoDescription}`)

    if (!execute) {
      changed++
      continue
    }

    const { error: writeError } = await db
      .from("funnel_steps")
      .update({
        seo_title: entry.seoTitle,
        seo_description: entry.seoDescription,
        updated_at: new Date().toISOString(),
      })
      .eq("id", step.id)
    if (writeError) throw new Error(`writing ${label}: ${writeError.message}`)

    // READ IT BACK. A PostgREST update reports no error when it matches zero
    // rows, so "no error" is not "it happened" — the only proof is the row.
    const { data: after, error: afterError } = await db
      .from("funnel_steps")
      .select("seo_title, seo_description")
      .eq("id", step.id)
      .maybeSingle()
    if (afterError) throw new Error(`verifying ${label}: ${afterError.message}`)
    if (after?.seo_title !== entry.seoTitle || after?.seo_description !== entry.seoDescription) {
      throw new Error(`verifying ${label}: the row does not hold what was written. Got ${JSON.stringify(after)}`)
    }
    console.log(`           verified in the database`)
    changed++
  }

  console.log(
    `\n${execute ? "Wrote" : "Would write"} ${changed}; skipped ${skipped}.` +
      (execute ? "" : "\nRe-run with --execute to apply."),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
