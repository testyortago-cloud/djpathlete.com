// Photographs the REAL "Search" panel in the REAL funnel builder, on a local
// dev server, with the callouts burned into each PNG.
//
//   node scripts/capture-funnel-seo-panel.mjs --port=3050
//
// EVERY SHOT IS THE PRODUCT. `/admin/funnels/<id>/edit/<stepId>` is the actual
// builder route an owner opens — not a storybook, not a scratch mount of
// `<SeoPanel>`. The panel is photographed inside the builder shell, beside the
// real canvas, with the real rail and the real header, because that is the
// only way the shot answers "can he find it?" as well as "does it work?".
//
// TWO SUBJECTS, AND THE EMPTY ONE IS THE POINT.
//   - `off-season-speed-camp-dxf8` has NO seo copy, which is the state every
//     one of the ten production rows is in. It is the only subject that can
//     show the fallback preview and the "we are using the funnel name" note;
//     a subject that already HAS copy silently demonstrates the other branch.
//   - `athlete-quiz` has the real copy applied, and is the only one that can
//     show the counters reading against a genuine 44-character title.
//
// LIGHT ONLY, deliberately. The admin UI has no dark variant — `.dark` is a
// class these components were never built against — so a "dark mode" shot
// would be a photograph of a bug rather than of this feature.
//
// DEV CLONE ONLY. Refuses any other Supabase ref. It READS, and the only write
// it makes is typing into a form it never saves.

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const PORT = argOf("port", "3050")
const APP = `http://localhost:${PORT}`
const OUT = join("screenshots", "funnel-seo-panel")
// Intermediates go beside the deliverables as `.raw-*.png`, which is the
// pattern `.gitignore` already excludes (`screenshots/**/.raw-*.png`). A
// `raw/` subfolder would not match it, and three unannotated duplicates would
// be committed alongside the three real shots.
const rawPath = (name) => join(OUT, `.raw-${name}.png`)
const DSF = 2
// 1280 tall, not 1000. The panel runs from the preview card down to the
// "no need to publish again" line under Save, and at 1000 that last sentence
// sat below the fold — so callout 4 pointed at text the shot had cropped.
const VIEWPORT = { width: 1600, height: 1280 }

// The two dev rows, by id. Ids are fine HERE and nowhere else in this change:
// this script never runs against production, and it refuses if the env does
// not point at the dev clone.
const FILLED = {
  funnelId: "3109f9aa-c90f-4520-be29-e0953d4a9ce1",
  stepId: "8d75b423-dfa5-4452-bf31-0ddd2733c3d1",
}
const EMPTY = {
  funnelId: "dc35d215-c2a4-46ac-a0bb-2a4c18159de6",
  stepId: "0e26ab6f-5d95-4815-b2a5-b8589a3994dc",
}

/**
 * A marker at the centre of a real element, in RAW pixels.
 *
 * `annotate()` places discs in raw image pixels, but `boundingBox()` returns
 * CSS pixels — so every coordinate has to be multiplied by the device scale
 * factor or the markers land in the top-left quadrant.
 *
 * WARNS LOUDLY on a miss rather than degrading. A helper that quietly returns
 * a default turns a broken callout into a silent no-op, and the shot still
 * looks plausible.
 */
async function markerAt(page, locator, caption, { align = "gutter" } = {}) {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) {
    throw new Error(`MARKER TARGET NOT FOUND: "${caption}" — refusing to ship a shot with a missing callout.`)
  }
  // "gutter" IS THE DEFAULT, and it is the whole reason this helper takes a
  // mode. Centring a disc on a block of text buries the sentence the caption
  // is about — the first pass of these shots put marker 3 squarely over "No
  // description set", which is the single string that shot exists to show.
  // The panel has 12px of padding, so sitting the disc just outside the text's
  // left edge keeps it beside its target and on top of nothing.
  const x = align === "gutter" ? box.x - 13 : align === "left" ? box.x + 18 : box.x + box.width / 2
  return { x: Math.round(x * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

/** The rail's tab. `exact` matters: the admin chrome carries a global
 * "Search… ⌘K" button, and Playwright's name filter is a SUBSTRING match, so a
 * bare "Search" resolves to two elements and throws on strict mode. */
const seoTab = (page) => page.getByRole("button", { name: "Search", exact: true })

/**
 * Next's dev overlay and the floating "Messages" help dock. Neither is part of
 * this feature and the dock sits bottom-right, directly over the panel's Save
 * button. Hidden FROM THE RECORDER with an injected stylesheet — never by
 * editing the app, which would photograph a product nobody ships.
 */
async function hideDevChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [data-messaging-dock], [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
}

async function openBuilder(page, { funnelId, stepId }) {
  await page.goto(`${APP}/admin/funnels/${funnelId}/edit/${stepId}`, { waitUntil: "networkidle" })
  if (page.url().includes("/login")) {
    throw new Error(`bounced to /login at ${page.url()} — the session did not take.`)
  }
  // THE SESSION IS ASSERTED BEFORE ANYTHING IS PHOTOGRAPHED. An expired or
  // missing session renders a redirect or an empty shell, and a shot of that
  // reports as a feature failure that mimics the scariest real one.
  await page.getByRole("button", { name: "Search", exact: true }).waitFor({ state: "visible", timeout: 30_000 })
  await hideDevChrome(page)
}

async function main() {
  const { config } = await import("dotenv")
  config({ path: ".env.local" })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  if (!url.includes(DEV_REF)) {
    throw new Error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is ${url}, not the dev clone (${DEV_REF}).`)
  }

  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF })
  const page = await context.newPage()

  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "networkidle" })
  if (!page.url().includes("/admin")) {
    throw new Error(`dev login did not land on /admin — now at ${page.url()}.`)
  }

  // ---------------------------------------------------------------- shot 1
  // The empty state: what every production row looks like today.
  await openBuilder(page, EMPTY)
  await page.getByRole("button", { name: "Search", exact: true }).click()
  await page.getByLabel("Page title").waitFor({ state: "visible" })
  // Park the pointer. Playwright leaves the mouse where it last clicked, and a
  // hover ring on the tab reads as part of the design.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 4)
  await page.waitForTimeout(400)

  let shot = rawPath("01-empty")
  await page.screenshot({ path: shot })
  await annotate(shot, join(OUT, "01-fallback-state.png"), {
    scale: VIEWPORT.width / 1440,
    title: "1 — What every published page looks like today",
    subtitle:
      "All four SEO columns have been writable since migration 00202 and are NULL on all ten production rows, because nothing ever rendered an input for them. This is that state, in the real builder.",
    markers: [
      await markerAt(
        page,
        page.getByRole("button", { name: "Search", exact: true }),
        "The new tab, beside Section and Page design. Reached identically from /admin/funnels and /admin/pages, which matters because a landing page has no settings screen to put it on.",
      ),
      await markerAt(
        page,
        page.getByText("How it will look").locator("xpath=following-sibling::div[1]"),
        "The preview runs the SAME resolver the public page does, so an empty row shows the FALLBACK rather than a blank box — the funnel's name, not the step's internal one.",
      ),
      await markerAt(
        page,
        page.getByText(/Google will pick a sentence from the page itself/),
        "No description is a deliberate choice, not an error: Google writes a better one from the page than the internal builder note that used to be served here.",
      ),
      await markerAt(
        page,
        page.getByText(/Empty, so we are using the/),
        "Says plainly that this is a fallback, and whose name it borrowed.",
      ),
    ],
  })
  console.log("  wrote 01-fallback-state.png")

  // ---------------------------------------------------------------- shot 2
  // The filled state, with the counters doing their job.
  await openBuilder(page, FILLED)
  await page.getByRole("button", { name: "Search", exact: true }).click()
  await page.getByLabel("Page title").waitFor({ state: "visible" })
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 4)
  await page.waitForTimeout(400)

  shot = rawPath("02-filled")
  await page.screenshot({ path: shot })
  await annotate(shot, join(OUT, "02-real-copy-and-counters.png"), {
    scale: VIEWPORT.width / 1440,
    title: "2 — The live quiz page, with the copy that is now in production",
    subtitle:
      "/go/athlete-quiz served “Start | DJP Athlete” and “The RPI quiz funnel.” until this row was filled in. Both counters measure against the house convention in .agents/slug-and-metadata-convention.md.",
    markers: [
      await markerAt(
        page,
        page.getByText(/^44\/47/),
        "44 of a 47-character budget. 47 and not 60 because the layout template appends “ | DJP Athlete” — a counter set to 60 walks you past the truncation point while reading green.",
      ),
      await markerAt(
        page,
        page.getByText(/Shows as 58 characters/),
        "So the RENDERED length is shown too. That is the number Google truncates, and it is the one the owner cannot otherwise see.",
      ),
      await markerAt(
        page,
        page.getByText(/^152\/160/),
        "The description counter flags both ends — “short” under 150, “long” over 160.",
      ),
      await markerAt(
        page,
        page.getByText(/updates the live page straight away/),
        "The one sentence that prevents a support question: these four columns are read per request, outside the frozen published version, so unlike everything else in this builder they need no re-publish.",
      ),
    ],
  })
  console.log("  wrote 02-real-copy-and-counters.png")

  // ---------------------------------------------------------------- shot 3
  // The two states worth seeing that are not the happy path.
  await page.getByLabel("Sharing picture").fill("/images/hero.jpg")
  await page.getByRole("switch", { name: /Hide from Google/ }).click()
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 4)
  await page.waitForTimeout(400)

  shot = rawPath("03-guards")
  await page.screenshot({ path: shot })
  await annotate(shot, join(OUT, "03-the-two-guards.png"), {
    scale: VIEWPORT.width / 1440,
    title: "3 — The two states that are not the happy path",
    subtitle:
      "Neither was saved; the form is showing what it refuses and what it warns about. Nothing on this shot was written to the database.",
    markers: [
      await markerAt(
        page,
        page.getByText(/Needs the full web address/),
        "og_image_url is z.string().url() on the API and the route answers a bare “Invalid request” naming no field. A path starting with “/” is the obvious thing to type — every other image field in this app takes one — so the panel refuses it here, with the reason.",
      ),
      await markerAt(
        page,
        page.getByRole("button", { name: "Save" }),
        "Save is disabled while the address is wrong, rather than letting it fail at the server.",
      ),
      await markerAt(
        page,
        page.getByText(/will not appear in search results at all/),
        "“Hide from Google” restates itself in the preview, in the strongest words the panel uses. It also drops the page from the sitemap — listing a URL and then telling the crawler to ignore it are contradictory instructions.",
      ),
    ],
  })
  console.log("  wrote 03-the-two-guards.png")

  await browser.close()
  console.log(`\nDone. ${OUT}/`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
