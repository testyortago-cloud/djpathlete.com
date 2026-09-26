// G32: a backfilled business's starter set, captured on the real routes of the
// real running app.
//
//   npx next dev --port 3079 > <scratchpad>/g32-dev.log 2>&1 &
//   APP=http://localhost:3079 node scripts/capture-g32-starter-set-screenshots.mjs
//
// TWO SHOTS, ONE BUSINESS. "Trailhead Strength & Conditioning"
// (82d5b238-1653-4a04-9d2d-2f65e5a8c225), a coach's business on the dev clone,
// backfilled by migration 00279's seed_business_starter_set().
//   01  /admin/sequences — eleven follow-up sequences, every one "Never turned
//       on" (status="draft"). Nobody has hand-authored any of them; they exist
//       because create_business() now seeds every business with the same
//       eleven, drafted.
//   02  /admin/pipeline — the board pills Coaching, Assessment, Camps &
//       Clinics, with Coaching selected (DEFAULT_PIPELINE_KEY, and the first
//       one this business's rows were created with).
//
// WHY THE GUARD CANNOT TRUST BOARD NAMES ALONE. The platform's own business,
// "Primary" (00000000-0000-0000-0000-000000000001), has the SAME three board
// names, also all active, also Coaching first — but not from 00279. Primary
// has had Coaching since migration 00219 and gained Assessment and Camps &
// Clinics from 00257; 00279's insert is a no-op for a key that already
// exists, so it left Primary's three untouched. A script that fell back to
// Primary because the tenant cookie was ignored would still show three pills
// named Coaching / Assessment / Camps & Clinics and pass a names-only check.
// The pipeline guard therefore reads the page's own
// sentence, which the server renders from THIS business's display name
// (`possessiveName(business.display_name)` in app/(admin)/admin/pipeline/
// page.tsx): "Trailhead Strength & Conditioning's Coaching pipeline." Primary
// can never produce that sentence.
//
// The sequences guard has a sharper tell: Primary has TWELVE sequences (six
// draft, four paused, two active) — one more than Trailhead, "SMS
// Re-permission Ask", that Trailhead does not have at all, plus six
// non-draft statuses. The guard checks the row count, that every row reads
// "Never turned on", and that "SMS Re-permission Ask" is not on screen.
//
// WRITES NOTHING. No insert, update or click on anything that saves. The
// sequence switches are read, never toggled.
//
// LIGHT ONLY. The admin surface has no working dark mode.
//
// DEV CLONE ONLY. It refuses any other project ref outright.

import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"

import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3079"
const OUT = "screenshots/g32-business-starter-set"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels
const TRAILHEAD = "82d5b238-1653-4a04-9d2d-2f65e5a8c225"
// `businesses.name` is "Trailhead Strength & Conditioning", but the pipeline
// page's sentence is built from `business_settings.display_name`, which for
// this business carries a longer tagline — checked against the dev clone
// (`select display_name from business_settings where business_id = ...`)
// rather than assumed.
const TRAILHEAD_DISPLAY_NAME = "Trailhead Strength & Conditioning — Personal Training"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_REF)) {
  console.error(`REFUSING TO RUN: .env.local does not point at the dev clone (${DEV_REF}).`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

function must(condition, message) {
  if (!condition) throw new Error(message)
}

/** A marker anchored to a real element. Warns loudly on every failure path. */
async function markerOn(locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx = box.x - 22
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  if (place === "above") {
    cx = box.x + box.width / 2
    cy = box.y - 22
  }
  if (place === "center") cx = box.x + box.width / 2
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

/** A marker at an absolute CSS-pixel position, for spots with no single
 * element to anchor to (e.g. the open background beside a row of pills). */
function markerAt(cx, cy, caption) {
  return { x: Math.round(cx * DSF), y: Math.round(cy * DSF), caption }
}

/**
 * A marker beside a crowded table row, guaranteed clear of every line of text
 * passed in `boxes` — not just the one target box.
 *
 * Fix round 1 found that placing a marker 22px to the right of just the
 * badge (the usual `markerOn(..., {place:"right"})` convention) clipped the
 * SEQUENCE NAME on the line above it: this cell stacks three lines (the
 * sequence name, its status badge, and a muted note), and the name line is
 * often wider than the badge. Verified empirically with
 * `document.elementFromPoint` + a text-node range check at 9 sample points
 * around the candidate disc (center + 8 points on its circumference) before
 * trusting any position — see task-5-report.md's fix-round-1 section. The
 * safe formula: past the RIGHTMOST edge of every text box in the cell, with
 * extra clearance (30px, not the usual 22) because the disc's vertical reach
 * still crosses the other lines' row-bands even when centered on one of them.
 */
function markerBesideRow(boxes, targetBox, caption) {
  const rightMost = Math.max(...boxes.filter(Boolean).map((b) => b.x + b.width))
  return markerAt(rightMost + 30, targetBox.y + targetBox.height / 2, caption)
}

async function hideDevChrome(page) {
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important } nextjs-portal { display: none !important }",
  })
}

/**
 * Markers are built by a callback invoked HERE, after the pointer is parked
 * and the page has settled, so they are measured on the frame that is
 * captured — not on a moving or since-scrolled page.
 *
 * `fitPage` grows the WINDOW to the document's own height instead of taking a
 * `fullPage` capture, so boundingBox() (viewport-relative) and the screenshot
 * (also viewport-sized once the window matches the page) agree on one
 * coordinate space with no scroll bookkeeping.
 */
async function shot(page, slug, title, subtitle, markersFn, { fitPage = false } = {}) {
  if (fitPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: 1440, height })
    await page.waitForTimeout(500)
    must((await page.evaluate(() => window.scrollY)) === 0, `${slug}: the page must be at the top`)
  }
  await page.mouse.move(4, 4)
  await page.waitForTimeout(400)
  const markers = await markersFn()
  const raw = `${OUT}/.raw-${slug}.png`
  await page.screenshot({ path: raw })
  const { width, height } = await annotate(raw, `${OUT}/${slug}.png`, { title, subtitle, markers })
  console.log(`   wrote ${OUT}/${slug}.png (${width}x${height})`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: DSF,
  colorScheme: "light",
})
const page = await ctx.newPage()

try {
  console.log("signing in")
  await page.goto(`${APP}/api/dev/login?callbackUrl=/api/auth/session`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  const session = await (await page.request.get(`${APP}/api/auth/session`)).json()
  must(session?.user?.role === "admin", `no admin session: ${JSON.stringify(session)}`)
  console.log(`   signed in as ${session.user.email}`)

  await ctx.addCookies([{ name: "djp_business", value: TRAILHEAD, domain: "localhost", path: "/", sameSite: "Lax" }])

  // ---- 01: /admin/sequences -------------------------------------------------
  console.log("\n01 the eleven sequences")
  await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle", timeout: 120_000 })
  await hideDevChrome(page)
  // The switch renders enabled before React attaches its handler, on this
  // screen exactly as on the businesses settings form; give hydration time
  // even though nothing here is clicked.
  await page.waitForTimeout(3000)

  must((await page.locator("h1", { hasText: "Sequences" }).count()) === 1, "the Sequences heading did not render")

  const rows = page.locator('[data-slot="data-table-row"]')
  const rowCount = await rows.count()
  console.log(`   sequence rows: ${rowCount}`)
  must(
    rowCount === 11,
    `expected exactly 11 sequence rows for Trailhead, found ${rowCount}. Primary has 12 — a wrong tenant would show that count.`,
  )

  const neverOn = page.getByText("Never turned on", { exact: true })
  const neverOnCount = await neverOn.count()
  console.log(`   "Never turned on" badges: ${neverOnCount}`)
  must(
    neverOnCount === rowCount,
    `expected every one of the ${rowCount} rows to read "Never turned on", found only ${neverOnCount}. A platform sequence (active/paused/archived) must have leaked in.`,
  )

  // Primary's twelfth sequence has no counterpart on Trailhead at all — its
  // presence on screen means the platform's own tenant rendered instead.
  const platformOnlySequence = page.getByText("SMS Re-permission Ask", { exact: true })
  must(
    (await platformOnlySequence.count()) === 0,
    `the platform's own sequence ("SMS Re-permission Ask") is on screen — this is Primary's data, not Trailhead's.`,
  )

  const lastRow = rows.nth(rowCount - 1)
  const lastRowName = (await lastRow.locator("a").first().textContent())?.trim()
  console.log(`   last row (11 of 11): ${lastRowName}`)

  // Fix round 1: a naive `place:"right"` off just the badge (22px gap) clipped
  // the sequence-name line above it. Compute a position clear of every line in
  // the cell instead — see markerBesideRow's doc comment.
  const row0 = rows.nth(0)
  const row0Link = row0.locator("a").first()
  const row0Badge = row0.getByText("Never turned on", { exact: true })
  const row0Muted = row0.getByText("Not switched on yet.", { exact: true })
  const [row0LinkBox, row0BadgeBox, row0MutedBox] = await Promise.all([
    row0Link.boundingBox(),
    row0Badge.boundingBox(),
    row0Muted.boundingBox(),
  ])

  await shot(
    page,
    "01-eleven-sequences-never-turned-on",
    "Every business now has eleven follow-up sequences",
    "They start switched off. Nothing is sent until the coach turns one on. A business created from today gets them the moment it is made; this one got them when the update ran.",
    async () => [
      await markerOn(
        lastRow.locator("a").first(),
        `This is row 11 of 11, "${lastRowName}" — the last one. All eleven are already set up, without anyone building one by hand.`,
      ),
      markerBesideRow(
        [row0LinkBox, row0BadgeBox, row0MutedBox],
        row0BadgeBox,
        'Every one of the eleven starts in this state, "Never turned on". Nothing is sent to anybody until the coach switches one on.',
      ),
    ],
    { fitPage: true },
  )

  // ---- 02: /admin/pipeline ---------------------------------------------------
  console.log("\n02 the three pipeline boards")
  // Shot 1 grew the window to its own (much taller) page height via `fitPage`;
  // reset it before the next navigation so this shot is the compact viewport
  // it is meant to be rather than a short board floating in a tall, mostly
  // empty window.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle", timeout: 120_000 })
  await hideDevChrome(page)
  await page.waitForTimeout(1500)

  // Server-rendered from THIS business's own display name — Primary can never
  // produce this sentence, so it is the guard against a wrong-tenant page,
  // independent of anything the three boards happen to be named.
  const ownSentence = page.getByText(`${TRAILHEAD_DISPLAY_NAME}’s Coaching pipeline.`, { exact: false })
  must(
    (await ownSentence.count()) === 1,
    `expected the page to say "${TRAILHEAD_DISPLAY_NAME}’s Coaching pipeline." — this is how the page proves whose board it is showing.`,
  )

  const pillsNav = page.locator('nav[aria-label="Pipeline boards"]')
  must((await pillsNav.count()) === 1, "the board switcher (three pills) did not render")
  const pills = pillsNav.locator("a")
  const pillCount = await pills.count()
  const pillNames = await pills.allTextContents()
  console.log(`   pills: ${pillNames.join(", ")}`)
  must(pillCount === 3, `expected exactly 3 board pills, found ${pillCount}: ${pillNames.join(", ")}`)
  must(
    pillNames.includes("Coaching") && pillNames.includes("Assessment") && pillNames.includes("Camps & Clinics"),
    `expected Coaching, Assessment and Camps & Clinics, found ${pillNames.join(", ")}`,
  )

  const activePill = pillsNav.locator('a[aria-current="page"]')
  const activeName = (await activePill.textContent())?.trim()
  console.log(`   active pill: ${activeName}`)
  must(activeName === "Coaching", `expected "Coaching" to be the selected board, found "${activeName}"`)

  // Fix round 1: markers "above" the pills sat on the paragraph's own second
  // line (there is only ~29px of clearance there, less than the disc's own
  // ~38px diameter — no vertical position in that gap can avoid touching
  // either the paragraph above or the board below it). The verified-clear
  // spot is the open background to the right of the whole pill group, at the
  // same height as the pills, spaced out left to right in the same order as
  // the pills themselves so the numbering reads unambiguously.
  const navBox = await pillsNav.boundingBox()
  const pillBoxes = await pills.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))

  await shot(
    page,
    "02-three-boards-coaching-first",
    "…and all three boards, with Coaching first",
    "A coach who wants to track assessments or camps and clinics separately from day-to-day coaching does not have to build these boards — they already exist, empty, ready to use.",
    async () => [
      markerAt(
        navBox.x + navBox.width + 40,
        pillBoxes[0].y + pillBoxes[0].height / 2,
        '"Coaching," highlighted — this is the board showing right now.',
      ),
      markerAt(
        navBox.x + navBox.width + 40 + 130,
        pillBoxes[1].y + pillBoxes[1].height / 2,
        '"Assessment," the second board, ready to use whenever the coach needs it.',
      ),
      markerAt(
        navBox.x + navBox.width + 40 + 260,
        pillBoxes[2].y + pillBoxes[2].height / 2,
        '"Camps & Clinics," the third board, also already set up.',
      ),
    ],
  )

  console.log("\nall assertions passed")
} finally {
  await browser.close()
}
