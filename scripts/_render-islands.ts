// scripts/_render-islands.ts — which sections are BLANK in the copy the
// reviewer is shown?
//
//   npx tsx scripts/_render-islands.ts <stepId>
//   -> {"proof":["testimonials"],"signup":["form"]}
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A LIST OF SECTION KINDS
// ---------------------------------------------------------------------------
// `render-image.ts` screenshots the output of `reassemble()` with `setContent`
// and NO SCRIPTS. `renderIsland()` (render.ts) emits an EMPTY
// `<div data-djp-island=…>` that only the real page ever fills, so every one of
// those is a blank rectangle in the picture the art director is handed and full
// of content on the page a visitor sees.
//
// Which sections hold one is not guessable from the document: it depends on a
// `source: "live"` discriminant on two kinds, on a CTA's target kind on
// several more, and on validation passing inside `renderIslandIfValid`. A
// hand-written table of "kinds that contain islands" in a capture script would
// be correct on the day it was written and quietly wrong afterwards.
//
// So this calls THE SAME `reassemble` the renderer calls and reads the answer
// out of the markup. It cannot drift, because it is not a copy of anything.
//
// NOTE THE ROUTE IT DOES NOT USE. `/preview` and `/go` run the compiled tree
// (`compileFunnelStep`), which turns most islands into real server-rendered
// components — so loading the preview with JavaScript off does NOT reproduce
// what the reviewer sees, and a first version of this probe that did exactly
// that found one island where there are two.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

import { islandsBySection } from "@/lib/funnels/render-image"
import { reassemble } from "@/lib/funnels/sections/doc"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const stepId = process.argv[2]
if (!stepId) throw new Error("usage: npx tsx scripts/_render-islands.ts <stepId>")

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!supabaseUrl || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")

const rows = (await (
  await fetch(`${supabaseUrl}/rest/v1/funnel_steps?select=project_data&id=eq.${stepId}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
).json()) as Array<{ project_data: SectionDoc }>
const doc = rows[0]?.project_data
if (!Array.isArray(doc?.sections)) throw new Error(`step ${stepId} has no readable section document`)

const { html } = reassemble(doc, { brandKit: null })

// THE SAME SCAN THE RENDERER USES. `islandsBySection` is what fills
// `RenderedPage.dynamicRegions`, the list the art critic is told not to report
// as empty — so this probe and the prompt cannot disagree about which bands are
// blank, which is the only way this script's verdicts stay worth anything.
console.log(JSON.stringify(islandsBySection(html)))
