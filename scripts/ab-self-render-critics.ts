// scripts/ab-self-render-critics.ts — the controlled A/B behind the whole feature.
//
//   export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
//   npx tsx scripts/ab-self-render-critics.ts                       # the spec's 10-section page
//   npx tsx scripts/ab-self-render-critics.ts --step=<uuid> --rounds=2
//
// ---------------------------------------------------------------------------
// WHAT THIS PROVES, AND WHY NO FIXTURE CAN PROVE IT
// ---------------------------------------------------------------------------
// The claim the whole build rests on is: "the art director catches a visual
// defect it could not have seen in the document alone." That is a claim about
// a MODEL LOOKING AT A PICTURE, so it can only be shown by running the real
// renderer and the real critic panel and comparing what comes back.
//
// It is run as a CONTROLLED A/B because the alternative — running the panel
// once, with pictures, and admiring the findings — proves nothing. A critic
// that infers "the pricing bullets look ragged" from five strings of wildly
// different length is reading the JSON, not the picture. So ONE stored
// document is put through `runCritics` TWICE: once handed `renderDocToImages`'
// output and once handed nothing, same doc, same deterministic audit findings,
// same model, same prompt. The findings that appear ONLY in the with-pictures
// run are the feature.
//
// This spends real model calls (3 Sonnet critics per arm, ~9k vision tokens on
// the art arm). That is the price of the evidence.
//
// ---------------------------------------------------------------------------
// WHAT IT REFUSES TO DO
// ---------------------------------------------------------------------------
// It will not report a pass it did not get.
//   - If the render came back with no images it THROWS, because the "with"
//     arm would then be byte-identical to the "without" arm and the whole
//     comparison would be a coin toss dressed up as a result.
//   - If the with-pictures arm returned no art-source findings AT ALL it
//     THROWS, because an empty art lens is a broken run, not a clean page:
//     the point of the exercise is to read what the art director said.
//   - It does NOT decide for you whether a finding is "picture-only". It
//     prints every finding from both arms in full and flags the ones whose
//     wording uses visual vocabulary, and a human reads them. A script that
//     graded its own evidence would be marking its own homework.
//
// DEV CLONE ONLY. It reads one `funnel_steps` row and writes nothing back.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

import { mkdirSync, writeFileSync } from "node:fs"

import { resolveBrandKit } from "@/lib/funnels/brand-kit"
import { RENDER_IMAGE_WIDTH, renderDocToImages, type RenderedPage } from "@/lib/funnels/render-image"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { auditDoc } from "@/lib/funnels/sections/review/audit"
import { runCritics } from "@/lib/funnels/sections/review/critics"
import type { Finding } from "@/lib/funnels/sections/review/findings"

const DEV_REF = "anjvztjiokcgiyhobknq"
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const OUT = "screenshots/builder-self-render"

/**
 * The page §1a of the spec names: ten sections, and two layout defects that
 * are invisible in its JSON. Overridable, because "try one more document"
 * is part of the honest-negative protocol in the brief.
 */
const DEFAULT_STEP = "7f5da342-aa37-42aa-bed3-020842893da9"

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!supabaseUrl || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")
const ref = new URL(supabaseUrl).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing — the critics are real model calls")

const argOf = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const stepId = argOf("step") ?? DEFAULT_STEP
const rounds = Number(argOf("rounds") ?? "1")

const rest = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

// ---------------------------------------------------------------------------
// The document, read from the database — never minted, never hand-edited.
//
// A PLANTED DEFECT PROVES NOTHING. If the page under test only has a visual
// problem because this script put one there, then all the run shows is that a
// model can see a thing that was drawn deliberately large for it.
// ---------------------------------------------------------------------------

async function readStep(): Promise<{ doc: SectionDoc; slug: string; funnelId: string; revision: number }> {
  const rows = (await (
    await fetch(
      `${supabaseUrl}/rest/v1/funnel_steps?select=project_data,slug,funnel_id,doc_revision&id=eq.${stepId}`,
      { headers: rest },
    )
  ).json()) as Array<{ project_data: unknown; slug: string; funnel_id: string; doc_revision: number }>
  const row = rows[0]
  if (!row) throw new Error(`no funnel_steps row with id ${stepId}`)
  const doc = row.project_data as SectionDoc
  if (!Array.isArray(doc?.sections) || doc.sections.length === 0) {
    throw new Error(`step ${stepId} has no readable section document`)
  }
  return { doc, slug: row.slug, funnelId: row.funnel_id, revision: row.doc_revision }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Words that can only be said about a rendering.
 *
 * A HINT FOR A HUMAN, NOT A VERDICT. It is here so a fifty-finding dump has
 * somewhere to start, and it is deliberately over-inclusive — "space" catches
 * "spacing", which is a style knob and derivable from the JSON. The script
 * prints the flag beside the finding and never acts on it.
 */
const VISUAL_VOCABULARY =
  /\b(empt(y|ier)|blank|whitespace|white space|dead space|gap|ragged|wrap(s|ped|ping)?|overflow|collid\w*|crop\w*|cut off|truncat\w*|unreadab\w*|illegib\w*|contrast|align\w*|misalign\w*|line up|lines up|stretch\w*|squash\w*|cramped|band|screen|scroll\w*|above the fold|below the fold|orphan\w*|marooned|stranded|uneven|jagged|column)\b/i

function line(finding: Finding): string {
  const flag = VISUAL_VOCABULARY.test(`${finding.issue} ${finding.suggestion}`) ? " [visual-vocabulary]" : ""
  return (
    `  - [${finding.source}/${finding.severity}] ${finding.code} (${finding.sectionIds.join(", ") || "whole page"})${flag}\n` +
    `      issue:      ${finding.issue}\n` +
    `      suggestion: ${finding.suggestion}`
  )
}

function block(title: string, findings: Finding[]): string {
  if (findings.length === 0) return `${title}\n  (none)`
  return `${title}\n${findings.map(line).join("\n")}`
}

// ---------------------------------------------------------------------------

const log: string[] = []
const say = (text: string) => {
  console.log(text)
  log.push(text)
}

async function main() {
  const { doc, slug, funnelId, revision } = await readStep()
  const brandKit = await resolveBrandKit(PRIMARY_BUSINESS_ID)

  say(`step ${stepId} ("${slug}", funnel ${funnelId}, doc_revision ${revision})`)
  say(`sections: ${doc.sections.map((s) => `${s.kind}:${(s as { variant?: string }).variant ?? "-"}`).join(", ")}`)
  say(`brandKit: ${JSON.stringify(brandKit)}   theme.palette: ${JSON.stringify(doc.theme?.palette ?? null)}`)

  // --- the render, once. Both arms of every round share it, so a difference
  // between rounds can never be a difference between two renders. --------------
  const funnelSlugRows = (await (
    await fetch(`${supabaseUrl}/rest/v1/funnels?select=slug,name&id=eq.${funnelId}`, { headers: rest })
  ).json()) as Array<{ slug: string; name: string }>
  const funnelBasePath = funnelSlugRows[0] ? `/go/${funnelSlugRows[0].slug}` : undefined

  const startedRender = Date.now()
  const render: RenderedPage = await renderDocToImages(doc, { ...(funnelBasePath ? { funnelBasePath } : {}), brandKit })
  say(
    `\nrender: ${render.images.length} images, page ${RENDER_IMAGE_WIDTH}x${render.height}px, ` +
      `truncated=${render.truncated}, typographyFaithful=${render.typographyFaithful}, ` +
      `error=${render.error ?? "none"}, ${Date.now() - startedRender}ms`,
  )

  // REFUSAL 1. With no images the "with" arm IS the "without" arm.
  if (render.images.length === 0) {
    throw new Error(`the render produced no images (${render.error}) — there is no A/B to run. Refusing.`)
  }

  // The pictures the model was handed, on disk, at the size it was handed them.
  const tileDir = `${OUT}/render-tiles`
  mkdirSync(tileDir, { recursive: true })
  render.images.forEach((image, index) => {
    const name = index === 0 ? "00-overview" : `${String(index).padStart(2, "0")}-slice-${index}`
    const path = `${tileDir}/${slug}-${stepId.slice(0, 8)}-${name}.png`
    writeFileSync(path, Buffer.from(image.data, "base64"))
    say(`  wrote ${path} (${Math.round(image.data.length * 0.75 / 1024)}KB decoded)`)
    // BARE BASE64, NOT A DATA URL — the wire format the transport requires, and
    // a `data:` prefix would be accepted by the type and rejected by the
    // provider. Checked here because this script is the only place the payload
    // is ever written to disk.
    if (image.data.startsWith("data:")) throw new Error(`image ${index} carries a data: prefix`)
  })

  // --- the deterministic pass, once. Both arms get the SAME audit findings, so
  // the critics are not being handed different briefs. -------------------------
  const audit = auditDoc(doc)
  say(`\n${block("deterministic audit findings (identical in both arms):", audit)}`)

  for (let round = 1; round <= rounds; round += 1) {
    say(`\n${"=".repeat(78)}\nROUND ${round} of ${rounds}\n${"=".repeat(78)}`)

    // WITHOUT first, so the control is never the run that benefited from a warm
    // anything. `undefined`, not `{images: []}` — an empty list would still
    // switch the transport to the messages form.
    const withoutStarted = Date.now()
    const without = await runCritics(doc, audit)
    say(
      `\n--- ARM A: no pictures (today's behaviour) — ${without.tokensUsed} tokens, ${Date.now() - withoutStarted}ms ---`,
    )
    say(block("all findings:", without.findings))
    say(block("ART LENS ONLY:", without.findings.filter((f) => f.source === "art")))

    const withStarted = Date.now()
    const withPictures = await runCritics(doc, audit, render)
    say(
      `\n--- ARM B: ${render.images.length} pictures to the art lens — ${withPictures.tokensUsed} tokens, ${Date.now() - withStarted}ms ---`,
    )
    say(block("all findings:", withPictures.findings))
    say(block("ART LENS ONLY:", withPictures.findings.filter((f) => f.source === "art")))

    say(
      `\ntoken delta (B - A): ${withPictures.tokensUsed - without.tokensUsed}` +
        `  — the vision tokens, on a stage that already makes four calls.`,
    )

    // --- the diff. By `code`, because that is the slug the panel's own dedupe
    // keys on, so two arms naming the same problem collapse the way the product
    // would collapse them. -----------------------------------------------------
    const artA = without.findings.filter((f) => f.source === "art")
    const artB = withPictures.findings.filter((f) => f.source === "art")
    const codesA = new Set(artA.map((f) => f.code))
    const onlyB = artB.filter((f) => !codesA.has(f.code))

    say(`\n${"-".repeat(78)}`)
    say(block(`ART FINDINGS PRESENT ONLY WITH PICTURES (${onlyB.length} of ${artB.length}):`, onlyB))
    const codesB = new Set(artB.map((f) => f.code))
    say(block(`ART FINDINGS LOST WHEN PICTURES WERE ADDED (${artA.filter((f) => !codesB.has(f.code)).length}):`, artA.filter((f) => !codesB.has(f.code))))

    // REFUSAL 2. An empty art lens is a broken run, not a clean page.
    if (artB.length === 0) {
      throw new Error(`the with-pictures arm returned NO art-lens findings at all — that is a failed run, not a result`)
    }
  }

  const logPath = `${OUT}/ab-${slug}-${stepId.slice(0, 8)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.txt`
  mkdirSync(OUT, { recursive: true })
  writeFileSync(logPath, log.join("\n") + "\n")
  console.log(`\nwrote ${logPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
