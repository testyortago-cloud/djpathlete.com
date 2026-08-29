// Drives the REAL admin app and photographs attendance arrangements end to end,
// with the callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   PORT=3051 npm run dev            # in another terminal
//   APP=http://localhost:3051 npx tsx scripts/capture-attendance-arrangements.ts .env.local
//   ... --clean                      # removes everything it created
//
// WHAT IT PROVES
//
//   1. A CLIENT WITH NO PACK CAN BE CHECKED IN. The arrangement is created
//      through the real dialog on the real client page, and the check-in is a
//      real click on the real Quick Actions button — not a seeded row.
//   2. THE CHECK-IN BURNED NO CREDIT. The session_checkins row it left is read
//      back OUT OF THE DATABASE and its credit_delta / arrangement_id /
//      client_package_id are asserted. A row that merely "came back" would pass
//      for one that quietly deducted a credit.
//   3. THE MONTHLY ROLL-UP ADDS UP. Three clients are put on arrangements and
//      checked in, and /admin/attendance is photographed showing the total.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE — see CLONE_REF.
//
// LIGHT ONLY, AND THAT IS NOT AN OMISSION: `.dark` is a class variant the admin
// components were never built against.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3051"
const OUT = "screenshots/attendance-arrangements"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1080
const DSF = 2
const CLEAN = process.argv.includes("--clean")

const FACILITY = "Riverside Tennis Club"

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function hideDevChrome(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }` +
      // Smooth scrolling animates scrollIntoView, so a boundingBox() read
      // straight afterwards is measured MID-FLIGHT and every marker lands
      // short of its target. Two shots shipped that way before this line.
      ` html { scroll-behavior: auto !important; }`,
  })
}

/**
 * Markers are built by a CALLBACK, not passed in, so they are measured after
 * the dev chrome is hidden and the page has settled — measuring before either
 * is what put every callout ~180px off its target once already.
 *
 * DRIFT IS CHECKED, NOT ASSUMED: one target is re-measured after the capture
 * and the shot is rejected if it moved. A callout pointing at blank space is
 * worse than no callout, because it still looks authoritative.
 */
async function shoot(
  page: Page,
  name: string,
  title: string,
  subtitle: string,
  buildMarkers: () => Promise<Marker[]>,
  driftProbe?: Locator,
): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await hideDevChrome(page)
  await page.waitForTimeout(700)
  const before = await driftProbe?.first().boundingBox()
  const markers = await buildMarkers()
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  if (before) {
    const after = await driftProbe!.first().boundingBox()
    const moved = after ? Math.abs(after.y - before.y) + Math.abs(after.x - before.x) : 999
    if (moved > 4) throw new Error(`LAYOUT MOVED ${Math.round(moved)}px during ${name} — markers would be wrong`)
  }
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  rmSync(raw, { force: true })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

/** A marker on a real element, in image pixels. Throws rather than degrading —
 *  a callout that silently lands at 0,0 still ships in the artefact. */
async function markerAt(
  page: Page,
  selector: string | Locator,
  caption: string,
  nudge: { x?: number; y?: number } = {},
): Promise<Marker> {
  const el = typeof selector === "string" ? page.locator(selector).first() : selector.first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${selector}`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE (zero box): ${selector}`)
  const view = page.viewportSize()
  if (view && (box.y > view.height || box.y + box.height < 0)) {
    throw new Error(`MARKER TARGET OFF SCREEN: ${selector} at y=${Math.round(box.y)}`)
  }
  return { x: Math.round((box.x + (nudge.x ?? 0)) * DSF), y: Math.round((box.y + (nudge.y ?? 0)) * DSF), caption }
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch {
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
    throw new Error("No usable Chromium. Run: npx playwright install chromium chromium-headless-shell")
  }
}

async function signInAsAdmin(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/clients`, { waitUntil: "domcontentloaded" })
  // ASSERT THE SESSION BEFORE ANYTHING ELSE. A minted JWT the app refuses
  // presents downstream as "the feature is broken".
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  if ((await page.locator("text=/Unauthorized|Forbidden/i").count()) > 0) {
    throw new Error("landed on /admin but the page reports no session")
  }
  await page.close()
  console.log("  signed in as admin, session asserted")
}

/**
 * The "Attendance only" section of Sessions & Billing, scrolled so the WHOLE
 * section fits — heading, the arrangement card, and the ledger below it.
 *
 * scrollIntoViewIfNeeded() is not enough: it stops as soon as the heading is
 * technically visible, which left the ledger 30px past the fold and made
 * markerAt throw. Pin the heading near the top instead, so everything below it
 * has the rest of the viewport to live in.
 */
async function attendanceSection(page: Page, headroom = 110): Promise<Locator> {
  const heading = page.getByRole("heading", { name: "Attendance only" })
  await heading.waitFor({ timeout: 20_000 })
  await hideDevChrome(page)
  await heading.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior }))
  // `headroom` buys space ABOVE the heading, for shots whose caption refers to
  // the Session Packs section this one sits under. A caption that names
  // something off-frame is a caption the reader cannot check.
  await page.evaluate((h) => window.scrollBy({ top: -h, behavior: "instant" as ScrollBehavior }), headroom)
  await page.waitForTimeout(900)
  return heading
}

async function startArrangement(page: Page, clientId: string, label: string, shots: boolean): Promise<void> {
  await page.goto(`${APP}/admin/clients/${clientId}`, { waitUntil: "domcontentloaded" })
  const heading = await attendanceSection(page, shots ? 330 : 110)

  if (shots) {
    await shoot(
      page,
      "01-no-arrangement",
      "A client with no pack, before anything is set up",
      'Sessions & Billing gained one section: "Attendance only". It is always there, so the option is discoverable.',
      async () => [
        await markerAt(page, heading, "The new section, directly under Session Packs", { x: -30, y: -6 }),
        await markerAt(page, page.getByRole("button", { name: "Start arrangement" }), "Starts the arrangement", { y: -26 }),
        await markerAt(page, page.locator("text=/billed somewhere else/i"), "Plain-English explanation of who this is for", { x: -30, y: -6 }),
      ],
      heading,
    )
  }

  await page.getByRole("button", { name: "Start arrangement" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.locator("#arrangement-label").fill(label)
  await page.locator("#arrangement-notes").fill("Coached Tuesdays and Thursdays. The club invoices him directly.")
  await page.waitForTimeout(300)

  if (shots) {
    await shoot(
      page,
      "02-start-dialog",
      "Starting the arrangement",
      "One question that matters: who bills this client. Nothing here charges anyone.",
      async () => [
        await markerAt(page, page.locator("#arrangement-label"), "The facility that bills them", { y: -26 }),
        await markerAt(page, dialog.locator("text=/without a pack/i"), "Says plainly that nothing will be charged", { x: -26, y: -6 }),
      ],
      page.locator("#arrangement-label"),
    )
  }

  // The dialog's submit shares its name with the trigger behind it, so scope to
  // the dialog — Playwright's name match is a substring, not an identity.
  await dialog.getByRole("button", { name: "Start arrangement" }).click()
  await page.waitForTimeout(2500)
}

async function checkIn(page: Page, clientId: string): Promise<void> {
  await page.goto(`${APP}/admin/clients/${clientId}`, { waitUntil: "domcontentloaded" })
  const btn = page.getByRole("button", { name: "Check in" })
  await btn.waitFor({ timeout: 20_000 })
  // Hydration: an enabled button whose handler is not attached yet swallows the
  // click and reports as a feature failure.
  await page.waitForTimeout(1500)
  await btn.click()
  await page.waitForTimeout(2500)
}

async function main(): Promise<void> {
  const env = loadEnv(process.argv[2] ?? ".env.local")
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  must(
    url.includes(CLONE_REF),
    `refusing to run: .env.local points at ${new URL(url).hostname}, not the dev clone ${CLONE_REF}`,
  )
  const supabase = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY)

  if (CLEAN) {
    const { data } = await supabase.from("attendance_arrangements").select("id")
    const ids = (data ?? []).map((r: { id: string }) => r.id)
    if (ids.length) {
      await supabase.from("session_checkins").delete().in("arrangement_id", ids)
      await supabase.from("attendance_arrangements").delete().in("id", ids)
    }
    console.log(`cleaned ${ids.length} arrangement(s) and their check-ins`)
    return
  }

  // Start from a clean slate so the run is repeatable.
  const { data: stale } = await supabase.from("attendance_arrangements").select("id")
  const staleIds = (stale ?? []).map((r: { id: string }) => r.id)
  if (staleIds.length) {
    await supabase.from("session_checkins").delete().in("arrangement_id", staleIds)
    await supabase.from("attendance_arrangements").delete().in("id", staleIds)
    console.log(`  cleared ${staleIds.length} arrangement(s) from a previous run`)
  }

  // Three demo clients who hold NO active pack. This matters: a client with
  // credits would (correctly) have those credits burned instead, and the shot
  // would quietly demonstrate the pack path while claiming to show attendance.
  // The first run of this script hit exactly that.
  const { data: holders, error: holderErr } = await supabase
    .from("client_packages")
    .select("client_user_id")
    .eq("status", "active")
  if (holderErr) throw new Error(`pack holders: ${holderErr.message}`)
  const excluded = new Set((holders ?? []).map((r: { client_user_id: string }) => r.client_user_id))

  const { data: allClients, error } = await supabase
    .from("users")
    .select("id,first_name,last_name")
    .eq("role", "client")
    .order("first_name")
  if (error) throw new Error(`clients: ${error.message}`)
  const pool = (allClients ?? []).filter((u: { id: string }) => !excluded.has(u.id))
  must(pool.length >= 3, `need 3 clients with no active pack, found ${pool.length}`)
  const [a, b, c] = pool.slice(0, 3) as { id: string; first_name: string; last_name: string }[]
  console.log(`  using ${a.first_name}, ${b.first_name}, ${c.first_name} (none holds a pack)`)

  const browser = await launchChromium()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
  await signInAsAdmin(ctx)
  const page = await ctx.newPage()

  // ── The featured client, photographed at every step ──────────────────────
  await startArrangement(page, a.id, FACILITY, true)

  await page.goto(`${APP}/admin/clients/${a.id}`, { waitUntil: "domcontentloaded" })
  const heading = await attendanceSection(page)
  await shoot(
    page,
    "03-arrangement-active",
    "The arrangement exists — no pack, no money",
    "Nothing was charged and nothing reached the books. The count starts at zero and the ledger is ready.",
    async () => [
      await markerAt(page, heading, "Now shows who bills this client", { x: -30, y: -6 }),
      await markerAt(page, page.locator("text=/sessions this month/i"), "The number to check the invoice against", { x: -34, y: -30 }),
      await markerAt(page, page.locator("text=/No sessions recorded yet/i"), "The attendance ledger, still empty", { x: -30, y: -6 }),
    ],
    heading,
  )

  // The button itself, before it is pressed. Shot 05's caption talks about
  // "Check in"; a caption naming a control the reader cannot see is unverifiable.
  await page.goto(`${APP}/admin/clients/${a.id}`, { waitUntil: "domcontentloaded" })
  const checkInBtn = page.getByRole("button", { name: "Check in" })
  await checkInBtn.waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1200)
  await shoot(
    page,
    "04-check-in-button",
    "The same Check in button the paid clients get",
    "It appears because this client now has an arrangement — previously it showed only for someone holding pack credits.",
    async () => [
      await markerAt(page, checkInBtn, "One tap records the session", { y: -28 }),
      await markerAt(page, page.getByRole("heading", { level: 1 }).first(), "The client this belongs to", { x: -30, y: -6 }),
    ],
    checkInBtn,
  )

  await checkIn(page, a.id)
  await page.goto(`${APP}/admin/clients/${a.id}`, { waitUntil: "domcontentloaded" })
  const heading2 = await attendanceSection(page)
  await shoot(
    page,
    "05-after-check-in",
    "One tap on Check in — attendance recorded",
    "Same button the paid clients use. It deducted nothing, because there is nothing to deduct.",
    async () => [
      await markerAt(page, page.locator("text=/sessions this month/i"), "The count moved to 1", { x: -34, y: -30 }),
      await markerAt(page, page.getByText("Attended").first(), "The session is on the ledger", { x: -30, y: -6 }),
      await markerAt(page, heading2, "Still the same arrangement", { x: -30, y: -6 }),
    ],
    heading2,
  )

  // Prove the row burned no credit, from the database, field by field.
  const { data: rows, error: rowErr } = await supabase
    .from("session_checkins")
    .select("id,arrangement_id,client_package_id,credit_delta,method,session_date")
    .eq("client_user_id", a.id)
    .not("arrangement_id", "is", null)
  if (rowErr) throw new Error(`read back: ${rowErr.message}`)
  must((rows ?? []).length === 1, `expected exactly 1 attendance row, got ${(rows ?? []).length}`)
  const row = rows![0]
  must(row.credit_delta === 0, `credit_delta should be 0, was ${row.credit_delta}`)
  must(row.client_package_id === null, "an attendance check-in must carry no pack")
  must(row.arrangement_id !== null, "an attendance check-in must name its arrangement")
  must(row.method === "coach_tap", `method should be coach_tap, was ${row.method}`)
  console.log(`  verified in the database: credit_delta=0, no pack, method=${row.method}`)

  // ── Two more, so the roll-up has something real to add up ────────────────
  await startArrangement(page, b.id, FACILITY, false)
  await checkIn(page, b.id)
  await startArrangement(page, c.id, "Eastside Racquet Centre", false)
  await checkIn(page, c.id)

  // ── The monthly roll-up ──────────────────────────────────────────────────
  await page.goto(`${APP}/admin/attendance`, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { name: "Attendance" }).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await shoot(
    page,
    "06-monthly-rollup",
    "The monthly total, to check the facility's invoice against",
    "Every client on an arrangement, the facility that bills them, and this month's session count.",
    async () => [
      await markerAt(page, page.getByRole("heading", { name: "Attendance" }), "New sidebar page, beside Schedule", { x: -30, y: -6 }),
      await markerAt(page, page.locator("#attendance-month"), "Pick any month", { y: -26 }),
      await markerAt(page, page.locator("text=/sessions total/i"), "The number to compare with their invoice", { x: -30, y: -26 }),
      await markerAt(page, page.locator("text=/Riverside Tennis Club/i").first(), "Who bills each client", { x: -34, y: -6 }),
    ],
    page.locator("#attendance-month"),
  )

  await browser.close()
  console.log(`\ndone — ${OUT}/`)
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`)
  process.exitCode = 1
})
