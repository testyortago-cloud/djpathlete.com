// Real-app capture of the reworked Performance > Tests tab (2026-11-03): every test shows (not the newest
// 10 results), results come before the report preview, grouped by kind, left/right tests on one card with
// the gap between sides, the Output tag, and the two-line sync message; then a left/right test's history.
//
// WRITES TO THE DEV CLONE ONLY (anjvztjiokcgiyhobknq). It links Felix Boateng (17 typed-in results, all
// dated before Darren's Output results) to the Output athlete "darren paul" through the real Link button,
// and at the end removes the imported rows and the link. His own results and the connection are untouched.
//
// Run (dev server on 3050): node scripts/capture-tests-tab-ux.mjs
import { cpSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3050"
const ATHLETE = "darren paul"
// Written outside the project while the browser runs (a new file inside it makes the dev server rebuild).
const DEST = "screenshots/tests-tab-ux"
const OUT = process.env.CAPTURE_TMP ?? `${tmpdir()}/capture-tests-tab-ux`
mkdirSync(`${OUT}/raw`, { recursive: true })

const check = (name, ok, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name}`)
}
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x), y: Math.round(y), caption }
}

const { data: conns } = await db.from("output_connections").select("business_id")
if ((conns ?? []).length !== 1) throw Error("needs exactly one Output connection on the clone")
const { data: links } = await db.from("output_athlete_links").select("output_athlete_name, client_user_id")
if ((links ?? []).some((l) => l.output_athlete_name === ATHLETE))
  throw Error(`${ATHLETE} is already linked on the clone`)
const { data: client } = await db
  .from("users")
  .select("id, first_name, last_name")
  .eq("first_name", "Felix")
  .eq("last_name", "Boateng")
  .single()
if (!client) throw Error("Felix Boateng is not on the clone")
if ((links ?? []).some((l) => l.client_user_id === client.id)) throw Error("Felix is already linked")
const name = `${client.first_name} ${client.last_name}`
const { count: own } = await db
  .from("performance_tests")
  .select("id", { count: "exact", head: true })
  .eq("client_user_id", client.id)
  .is("output_key", null)

async function cleanup() {
  const { count } = await db
    .from("performance_tests")
    .delete({ count: "exact" })
    .eq("client_user_id", client.id)
    .not("output_key", "is", null)
  await db.from("output_athlete_links").delete().eq("client_user_id", client.id)
  console.log(`cleanup: removed ${count ?? 0} imported results and the link for ${name}`)
}

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
  ).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  // Every frame: the test report preview is an iframe with the dev server's own badge in it.
  const hideChrome = () =>
    Promise.all(
      page.frames().map((f) =>
        f
          .addStyleTag({
            content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}",
          })
          .catch((e) => console.warn(`WARN could not hide dev chrome in ${f.url()}: ${e.message}`)),
      ),
    )
  const shot = async (file, opts) => {
    await page.mouse.move(3, 3)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/raw/${file}` })
    await annotate(`${OUT}/raw/${file}`, `${OUT}/${file}`, opts)
  }
  const perfUrl = `/admin/clients/${client.id}/performance?tab=tests`

  await page.goto(`${APP}/api/dev/login?callbackUrl=${encodeURIComponent(perfUrl)}`, {
    waitUntil: "load",
    timeout: 180000,
  })
  const linkBtn = page.getByRole("button", { name: "Link to Output athlete" })
  await linkBtn.waitFor({ timeout: 120000 })
  await page.waitForTimeout(1500) // hydration
  await linkBtn.click()
  const trigger = page.getByRole("combobox", { name: "Output athlete" })
  await trigger.waitFor({ timeout: 60000 })
  await trigger.click()
  await page.getByRole("option", { name: new RegExp(`^${ATHLETE}`, "i") }).click()
  await page.getByRole("button", { name: "Link and bring in results" }).click()
  const summary = page.getByText(/^(\d+ new results?|No new results)/)
  await summary.waitFor({ timeout: 180000 })
  await page.waitForTimeout(2000) // router.refresh brings the new cards in
  const leftLine = page.getByText(/^Not brought in \(no matching test in the app\)/)
  check(
    "what came in and what did not are on separate lines",
    (await summary.innerText()).endsWith("."),
    await summary.innerText(),
  )

  const { count: total } = await db
    .from("performance_tests")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", client.id)
  check(
    "the client has more than 10 results, so the old newest-10 cut would hide some",
    total > 10,
    `${own} own + Output = ${total}`,
  )
  // Felix's oldest typed-in tests (Nov 2025 - Apr 2026) would have fallen outside the newest 10.
  for (const label of ["Back Squat 1RM", "40m Sprint", "Broad Jump"])
    check(
      `"${label}" still has its card`,
      (await page.getByRole("link", { name: new RegExp(`^${label}`) }).count()) === 1,
    )

  const headings = await page.locator("section h3").allTextContents()
  console.log("groups:", headings.join(" | "))
  check("results are grouped by kind", headings[0] === "Jumps" && headings.includes("Speed"))
  const pair = page.getByRole("link", { name: /^Single-Leg CMJ/ })
  check("the two legs share one card", (await pair.count()) === 1)
  const gapLine = pair.getByText(/behind|level|different days|both sides/)
  console.log("gap line:", await gapLine.innerText())
  const reportTop = (await page.getByText("Test report preview").boundingBox())?.y ?? 0
  const firstCardTop = (await pair.boundingBox())?.y ?? Infinity
  check("results come before the report preview", firstCardTop < reportTop)

  await hideChrome()
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot("01-tests-tab-top.png", {
    title: "Performance > Tests: results first, grouped by kind",
    subtitle: `Clients > ${name} > Performance > Tests, just after linking to the Output athlete "${ATHLETE}"`,
    markers: [
      await marker(
        leftLine,
        "What the sync brought in, then on a line of its own what it left in Output, so that count is never read as results added.",
      ),
      await marker(page.locator("section h3", { hasText: "Jumps" }), "Results grouped by kind of test."),
      await marker(gapLine, "Left and right on one card, with how far apart the legs are. 15% or more is flagged."),
    ],
  })

  const speed = page.locator("section", { has: page.locator("h3", { hasText: "Speed" }) })
  await speed.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -80))
  await hideChrome()
  const outputTag = page.getByRole("link", { name: /^Trap Bar Deadlift/ }).getByText("Output", { exact: true })
  const sprintCard = page.getByRole("link", { name: /^10m Sprint/ })
  const sprintTrend = sprintCard.getByText(/vs prev/)
  const markers = [
    await marker(
      page.locator("section h3", { hasText: "Speed" }),
      "Speed tests together: sprint times and ground contact.",
    ),
    await marker(outputTag, "Results brought in from Output are tagged.", "above"),
  ]
  if (await sprintTrend.count())
    markers.push(
      await marker(sprintTrend, "A faster sprint is now green. It used to be red because the % is negative.", "after"),
    )
  await shot("02-tests-tab-groups.png", {
    title: "Every test keeps its card, and trends are coloured the right way",
    subtitle: `Clients > ${name} > Performance > Tests (further down). Each whole card opens the test's history.`,
    markers,
  })

  await pair.click()
  await page.waitForURL(/\/performance\/tests\/cmj_left$/, { timeout: 120000 })
  await page.getByRole("heading", { level: 1, name: "Single-Leg CMJ" }).waitFor({ timeout: 120000 })
  await hideChrome()
  await page.waitForTimeout(1500)
  check("the history lists both sides", (await page.getByRole("cell", { name: "Right", exact: true }).count()) > 0)
  await shot("03-left-right-history.png", {
    title: "A left/right test's history shows both legs",
    subtitle: `Clients > ${name} > Performance > Tests > Single-Leg CMJ`,
    markers: [
      await marker(page.locator(".recharts-legend-wrapper"), "Left and right on one chart.", "before"),
      await marker(page.getByRole("columnheader", { name: "Side" }), "Each result says which side it was.", "before"),
    ],
  })

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
  mkdirSync(DEST, { recursive: true })
  cpSync(OUT, DEST, { recursive: true })
  console.log(`shots copied to ${DEST}`)
} finally {
  await browser.close()
  await cleanup()
}
