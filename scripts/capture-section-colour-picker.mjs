// Drives the REAL app and captures the REAL section inspector on the REAL
// funnel builder route, showing the background-colour picker that replaced a
// select whose four options ("Default / Muted / Accent / Dark") named a rhythm
// and described no colour.
//
//   npm run dev                                        # port 3050
//   node scripts/capture-section-colour-picker.mjs
//
// Nothing here is a harness or a scratch mount: it signs in, opens
// /admin/funnels/<id>/edit/<stepId>, clicks a real section in the real canvas
// iframe, and photographs the real inspector — then clicks a real swatch and
// photographs the canvas repainting.
//
// LIGHT ONLY: the admin components were never built against the `.dark` class
// variant, so there is no second rendering to capture.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/section-colour-picker"
const WIDTH = 1600
const HEIGHT = 950
const DSF = 2 // annotate() places markers in RAW pixels
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const FUNNEL = "a7450381-3042-4f0b-9236-abf3bf8e10ad"
const STEP = "7f5da342-aa37-42aa-bed3-020842893da9"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

/** Marker on a real element, CSS px -> raw pixels. WARNS LOUDLY, never degrades quietly. */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx =
    place === "center"
      ? box.x + box.width / 2
      : place === "right"
        ? box.x + box.width - 22
        : place === "after"
          ? box.x + box.width + 22
          : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

/** Throw unless the element's box sits entirely inside the viewport. */
async function assertFullyVisible(page, locator, label) {
  const box = await locator.first().boundingBox()
  const vh = page.viewportSize().height
  const vw = page.viewportSize().width
  if (!box) throw new Error(`${label} has no box`)
  const ok = box.y >= 0 && box.y + box.height <= vh && box.x >= 0 && box.x + box.width <= vw
  if (!ok) {
    throw new Error(
      `${label} is not fully on screen (y=${Math.round(box.y)}..${Math.round(box.y + box.height)} of ${vh}) — the shot would clip it`,
    )
  }
}

/** The visible canvas iframe ELEMENT, in page coordinates. */
function visibleCanvas(page) {
  return page.locator('iframe[src*="funnel-preview"]:visible').first()
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  // Park the pointer: Playwright's mouse stays where it last clicked, and a
  // hovered chip reads as a styling bug that is not there.
  await page.mouse.move(4, 4)
  await page.waitForTimeout(200)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  // Assert the session BEFORE anything else: a refused login reports
  // downstream as a feature failure that mimics the real bug.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

/** The visible canvas iframe — PreviewPane double-buffers, so there are two. */
async function canvasFrame(page) {
  const frames = page.frames().filter((f) => f.url().includes("/funnel-preview/"))
  if (frames.length === 0) throw new Error("no /funnel-preview iframe on the page")
  for (const f of frames) {
    const n = await f
      .locator("[data-sec]")
      .count()
      .catch(() => 0)
    if (n > 0) return f
  }
  throw new Error("found preview iframes but none had rendered sections")
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)
  // Load-bearing: with no djp_business cookie the tenant resolver falls back to
  // a seeded business with no funnels, and an empty screen reads as breakage.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()
  await page.goto(`${APP}/admin/funnels/${FUNNEL}/edit/${STEP}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(3000)

  const frame = await canvasFrame(page)
  console.log(`  canvas ready: ${await frame.locator("[data-sec]").count()} sections`)

  // ---- Select a real section by clicking it in the real canvas -------------
  //
  // THE SECTION'S OWN PADDING, NOT ITS TEXT. Every headline and body line in
  // the canvas is a `[data-edit]` node, and clicking one enters text-edit mode;
  // the next click anywhere is then consumed committing that edit, so the
  // swatch never fires and the run reports a working feature as broken. Cost
  // one confused capture to find. (6,6) is inside the band and outside every
  // editable child — the geometry is asserted below rather than assumed.
  const section = frame.locator('[data-sec="benefits"]').first()
  const clear = await section.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return [...el.querySelectorAll("[data-edit]")].every((n) => {
      const b = n.getBoundingClientRect()
      return !(b.left - r.left < 20 && b.top - r.top < 20)
    })
  })
  if (!clear) throw new Error("(6,6) is over an editable node — pick another point")
  await section.click({ position: { x: 6, y: 6 } })
  await page.waitForTimeout(1200)

  const swatchGreen = page.getByRole("button", { name: "Brand green" })
  if ((await swatchGreen.count()) === 0) throw new Error("inspector did not show the colour picker")
  // Bring the whole Style block into view, or the markers clamp to the last row
  // of pixels and the captions point at nothing. `scrollIntoViewIfNeeded` on the
  // LAST control scrolls whatever container actually scrolls — a hand-rolled
  // scrollTop sweep guessed the wrong element and silently did nothing.
  const clearTone = page.getByRole("button", { name: "Use the page default" })
  await clearTone.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  // A capture that cannot show the control is not evidence. Fail rather than
  // ship a shot whose captions point off the bottom edge.
  await assertFullyVisible(page, swatchGreen, "the Brand green chip")
  await assertFullyVisible(page, clearTone, "the 'Use the page default' link")
  const pressedBefore = await page.getByRole("button", { name: "Light grey" }).getAttribute("aria-pressed")
  console.log(`  selected "benefits"; the picker shows Muted as current: aria-pressed=${pressedBefore}`)

  await shoot(
    page,
    "01-colour-picker-in-the-inspector",
    "Manual editing — the section inspector now names the colours",
    "Real /admin/funnels/<id>/edit/<stepId> — real canvas, real inspector. The old select offered only: Default / Muted / Accent / Dark.",
    [
      await markerOn(
        page,
        page.getByText("Background colour", { exact: true }),
        "Each chip paints its REAL token, with the paired text colour behind the letter — so the contrast is visible before it is applied.",
        { place: "left" },
      ),
      await markerOn(
        page,
        swatchGreen,
        'The brand green is the tone called "dark" — the right-hand column shows that name, because it is the word the AI chat uses for the same colour.',
        { place: "left" },
      ),
      await markerOn(
        page,
        clearTone,
        "Clears the tone so the section inherits the page — the select's blank option was ALSO labelled “Default”, one word meaning two things.",
        { place: "left", dy: 4 },
      ),
    ],
  )

  // ---- Apply it, and photograph the canvas actually repainting -------------
  let sentOp = "(none)"
  page.on("request", (req) => {
    if (req.url().includes("/edit") && req.method() === "PUT") sentOp = (req.postData() ?? "").slice(0, 120)
  })
  await swatchGreen.click()
  await page.waitForTimeout(4000)
  const pressedAfter = await swatchGreen.getAttribute("aria-pressed")
  console.log(`  op sent: ${sentOp}`)
  console.log(`  green swatch now aria-pressed=${pressedAfter}`)
  if (pressedAfter !== "true")
    throw new Error("the tone did not apply — refusing to caption a shot that shows otherwise")

  await shoot(
    page,
    "02-applied-to-the-real-page",
    "One click repaints the real section",
    'Tone "dark" is background var(--primary) — the brand green — with its paired white text, applied to the live draft in one click.',
    [
      await markerOn(page, swatchGreen, "The chosen chip is ringed, so the current colour is readable at a glance.", {
        place: "left",
      }),
      // The canvas lives in an iframe, so the marker is placed on the IFRAME
      // ELEMENT (page coordinates). A frame-relative box would be measured
      // against the frame's own origin and land somewhere else entirely.
      await markerOn(page, visibleCanvas(page), "The real page repaints immediately — no publish, no reload.", {
        place: "center",
        dy: 40,
      }),
    ],
  )

  console.log(`\n  wrote ${OUT}/`)
} finally {
  await browser.close()
}
