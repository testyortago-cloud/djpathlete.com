// scripts/capture-island-placeholder.ts — what the art director now sees where
// an interactive region used to be a blank band.
//
//   export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
//   npx tsx scripts/capture-island-placeholder.ts            # defaults to step 7f5da342
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A HAND-CROPPED TILE
// ---------------------------------------------------------------------------
// It renders THE SAME DOCUMENT through THE SAME `buildRenderDocument` the review
// stage screenshots, so the picture in the repo is the picture the model was
// handed — not a re-staging of it. The two crops are located by MEASURING the
// island elements in the browser (`getBoundingClientRect`), never by reading
// pixel offsets off a previous capture: a marker placed from a guessed offset
// drifts between takes and then labels the wrong thing with total confidence.
//
// It warns loudly and exits non-zero if an island it expects is missing, rather
// than writing a clean-looking picture of nothing.
//
// DEV CLONE ONLY. Reads one `funnel_steps` row and writes nothing back.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

import { mkdirSync, writeFileSync } from "node:fs"

import { annotate } from "./_annotate-lib.mjs"

import { resolveBrandKit } from "@/lib/funnels/brand-kit"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import { buildRenderDocument } from "@/lib/funnels/render-image"
import { reassemble } from "@/lib/funnels/sections/doc"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const DEV_REF = "anjvztjiokcgiyhobknq"
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const OUT = "screenshots/builder-self-render"
const STEP = process.argv.find((a) => a.startsWith("--step="))?.slice(7) ?? "7f5da342-aa37-42aa-bed3-020842893da9"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!supabaseUrl || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")
const ref = new URL(supabaseUrl).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

interface IslandBox {
  name: string
  x: number
  y: number
  width: number
  height: number
  /** The <section> the island sits in, so the crop shows the whole band. */
  sectionY: number
  sectionHeight: number
}

async function main() {
  const rows = (await (
    await fetch(`${supabaseUrl}/rest/v1/funnel_steps?select=project_data&id=eq.${STEP}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
  ).json()) as Array<{ project_data: SectionDoc }>
  const doc = rows[0]?.project_data
  if (!doc?.sections?.length) throw new Error(`no readable section document on step ${STEP}`)

  const brandKit = await resolveBrandKit(PRIMARY_BUSINESS_ID)
  const { html, css } = reassemble(doc, { brandKit })

  const puppeteer = (await import("puppeteer-core")).default
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  const browser = await puppeteer.launch({ executablePath, headless: true, args: [] })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
    await page.setContent(buildRenderDocument(html, css), { waitUntil: "load" })

    // MEASURE AFTER THE WEBFONTS SETTLE, NOT BEFORE. `load` fires before a
    // font swap finishes, and the swap moves the page: the first take of this
    // capture measured the form island at y=4731, then Lexend arrived, the page
    // reflowed, and every marker in the crop landed ~80px off the thing it was
    // labelling. `renderDocToImages` is already safe from this — it calls
    // `fontsInUseLoaded`, which awaits `document.fonts.ready`, before it asks
    // for the page height or takes a single screenshot.
    await page.evaluate(`document.fonts.ready.then(() => true)`)

    // A STRING, not a function literal — esbuild rewrites a named function
    // inside an evaluate callback into a `__name` helper the browser does not
    // have, and the whole evaluate throws.
    const boxes = (await page.evaluate(`
      [...document.querySelectorAll("[data-djp-island]")].map((el) => {
        const rect = el.getBoundingClientRect()
        const section = el.closest("section")
        const band = (section ?? el).getBoundingClientRect()
        return {
          name: el.getAttribute("data-djp-island"),
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
          sectionY: band.y + window.scrollY,
          sectionHeight: band.height,
        }
      })
    `)) as IslandBox[]

    for (const wanted of ["testimonials", "form"]) {
      if (!boxes.some((b) => b.name === wanted)) {
        console.error(`[capture] NOTHING MATCHED: no "${wanted}" island in this document. Refusing to write a lie.`)
        process.exitCode = 1
        return
      }
    }
    for (const box of boxes) {
      if (box.height <= 0) {
        console.error(`[capture] the "${box.name}" island rendered ${box.height}px tall — the sheet did not apply.`)
        process.exitCode = 1
        return
      }
      console.log(`[capture] ${box.name}: ${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.y)}`)
    }

    mkdirSync(OUT, { recursive: true })

    // One crop per island, each covering its whole band plus a little of the
    // neighbours, so the placeholder is seen in the page's own rhythm.
    // Marker positions are given as offsets from the MEASURED box, not as
    // absolute pixels: `fx`/`fy` are fractions of its width/height, `dx`/`dy`
    // are pixels from its top-left. Placing a disc over the label would hide
    // the very words the annotation is pointing at, which is how the first
    // take of this capture came out.
    type Point = { fx?: number; fy?: number; dx?: number; dy?: number }
    const shots: Array<{
      box: IslandBox
      file: string
      title: string
      subtitle: string
      captions: string[]
      points: Point[]
    }> = [
      {
        box: boxes.find((b) => b.name === "testimonials")!,
        file: `${OUT}/06-the-band-that-used-to-look-empty.png`,
        title: "The testimonial band, as the art director now sees it",
        subtitle:
          "Same document, same renderer. The band is a live feed, so it is genuinely not drawn in a " +
          "scripts-off screenshot — it used to be a solid clay rectangle with nothing in it, which the " +
          "critic filed as a high-severity empty band and the reviser then filled with a testimonial it " +
          "invented, under a real person's name.",
        captions: [
          "The dashed outline marks where the live testimonial feed goes. Nothing about it looks like page design, so no critic spends a finding on its styling.",
          "The label says, in plain words, what fills this space and when — so there is no blank band left to report as empty.",
          "The second line says outright that the box itself is not part of the design. This CSS is injected only into the renderer's own document; no published page or preview route can reach it.",
        ],
        // Left of the centred label, so neither line is covered.
        points: [
          { dx: 34, dy: 26 },
          { fx: 0.23, fy: 0.33 },
          { fx: 0.23, fy: 0.66 },
        ],
      },
      {
        box: boxes.find((b) => b.name === "form")!,
        file: `${OUT}/07-the-form-placeholder.png`,
        title: "The sign-up form, in the same treatment",
        subtitle:
          "Every interactive region gets this, not just the one that caused the incident. The form " +
          "placeholder sits inside the card the real form sits in, so the split layout still reads truthfully.",
        captions: [
          "The form is React, hydrated in a real browser, so it is empty in every screenshot this stage takes.",
          "The placeholder names it and stays card-sized. Call-to-action islands (checkout, event, booking) are drawn button-sized instead, so a placeholder never distorts the proportions the art director is judging.",
        ],
        // The card is narrow and the label fills it, so the second marker goes
        // outside the box, on the band beside it, rather than on top of the words.
        points: [
          { dx: 34, fy: 1, dy: -26 },
          { dx: -58, fy: 0.55 },
        ],
      },
    ]

    for (const shot of shots) {
      const top = Math.max(0, Math.round(shot.box.sectionY - 40))
      const height = Math.round(shot.box.sectionHeight + 80)
      const raw = await page.screenshot({ type: "png", clip: { x: 0, y: top, width: 1200, height } })
      const rawPath = `/tmp/island-placeholder-${shot.box.name}.png`
      writeFileSync(rawPath, Buffer.from(raw))

      // Marker coordinates are the MEASURED element's, translated into the
      // crop's own space. Nothing here is an eyeballed offset.
      const bx = shot.box.x
      const by = shot.box.y - top
      if (shot.points.length !== shot.captions.length) {
        throw new Error(`${shot.file}: ${shot.points.length} markers for ${shot.captions.length} captions`)
      }
      const markers = shot.points.map((point, i) => ({
        x: bx + (point.fx ?? 0) * shot.box.width + (point.dx ?? 0),
        y: by + (point.fy ?? 0) * shot.box.height + (point.dy ?? 0),
        caption: shot.captions[i],
      }))

      const written = await annotate(rawPath, shot.file, {
        title: shot.title,
        subtitle: shot.subtitle,
        markers,
        // The capture is 1200 CSS px at deviceScaleFactor 1, not the 1440 the
        // library assumes, so the type would otherwise be drawn slightly small.
        scale: 1,
      })
      console.log(`[capture] wrote ${shot.file} (${written.width}x${written.height})`)
    }
    console.log(`[capture] root id in the document: #${FUNNEL_ROOT_ID}`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
