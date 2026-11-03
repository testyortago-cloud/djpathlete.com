// Real-app capture of the Output tests Darren chose on 2026-11-03: Repeated Jumps, Sprinting ground
// contact, the med ball throw and the trap bar 1RM come in as test results, and a test's history
// page lists each day with its notes (the trap bar's load-velocity sets).
//
// WRITES TO THE DEV CLONE ONLY (anjvztjiokcgiyhobknq). It needs the clone's existing Output
// connection (Darren's org), links a client with no tests to the Output athlete "darren paul"
// through the real Link button (which runs the real first sync), and at the end removes the
// imported rows and the link. The connection is left as it was. Output is only read.
//
// Run (dev server on 3050): node scripts/capture-output-darren-tests.mjs
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
const DEST = "screenshots/output-darren-tests"
const OUT = process.env.CAPTURE_TMP ?? `${tmpdir()}/capture-output-darren-tests`
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
const { data: links } = await db.from("output_athlete_links").select("output_athlete_name")
if ((links ?? []).some((l) => l.output_athlete_name === ATHLETE))
  throw Error(`${ATHLETE} is already linked on the clone`)

// An active client with NO performance tests, so cleanup is a plain delete.
const { data: tested } = await db.from("performance_tests").select("client_user_id").limit(1000)
const testedIds = new Set((tested ?? []).map((t) => t.client_user_id))
const { data: linkedIds } = await db.from("output_athlete_links").select("client_user_id")
const { data: clients } = await db
  .from("users")
  .select("id, first_name, last_name")
  .eq("role", "client")
  .eq("status", "active")
  .not("first_name", "is", null)
  .limit(200)
const client = (clients ?? []).find(
  (c) =>
    !testedIds.has(c.id) &&
    !(linkedIds ?? []).some((l) => l.client_user_id === c.id) &&
    !/test/i.test(`${c.first_name} ${c.last_name}`),
)
if (!client) throw Error("no active client without tests on the clone")
const name = `${client.first_name} ${client.last_name}`

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
  await hideChrome()
  await page.waitForTimeout(1500) // hydration
  await linkBtn.click()
  const trigger = page.getByRole("combobox", { name: "Output athlete" })
  await trigger.waitFor({ timeout: 60000 })
  await trigger.click()
  await page.getByRole("option", { name: new RegExp(`^${ATHLETE}`, "i") }).click()
  await page.getByRole("button", { name: "Link and bring in results" }).click()
  const summary = page.getByText(/^(\d+ new results?|No new results)/)
  await summary.waitFor({ timeout: 180000 })
  console.log("summary:", await summary.innerText())

  const { data: rows } = await db
    .from("performance_tests")
    .select("test_type, test_date, result_value, result_unit, trial_values, notes")
    .eq("client_user_id", client.id)
    .not("output_key", "is", null)
    .order("test_date")
  for (const r of rows ?? [])
    console.log(
      "  ",
      r.test_date,
      r.test_type,
      r.result_value,
      r.result_unit,
      JSON.stringify(r.trial_values),
      "|",
      r.notes,
    )
  const types = new Set((rows ?? []).map((r) => r.test_type))
  // What Darren recorded on 2026-11-02/03 (probed): no two-leg Repeated Jumps or Torso Rotation yet.
  for (const t of ["repeated_jumps_left", "sprint_contact_left", "med_ball_squat_throw", "trap_bar_deadlift_1rm"])
    check(`${t} came in`, types.has(t))
  const trap = rows.find((r) => r.test_type === "trap_bar_deadlift_1rm")
  check("the trap bar keeps its load-velocity sets in the note", / kg at \d+\.\d\d m\/s/.test(trap.notes), trap.notes)

  await page.waitForTimeout(1500)
  const trapCard = page.getByRole("link", { name: "Trap Bar Deadlift 1RM" })
  const contactCard = page.getByRole("link", { name: "Sprint Ground Contact (Left)" })
  const rsiCard = page.getByRole("link", { name: "Single-Leg Repeated Jumps (Left)" })
  const throwCard = page.getByRole("link", { name: "Med Ball Vertical Press Squat Throw" })
  await rsiCard.first().scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 330))
  await hideChrome()
  await shot("01-new-test-cards.png", {
    title: "Darren's Output tests now come in as test results",
    subtitle: `Clients > ${name} > Performance > Tests, after linking to the Output athlete "${ATHLETE}"`,
    markers: [
      await marker(rsiCard, "Repeated Jumps: average RSI, per leg for the single-leg version.", "above"),
      await marker(contactCard, "Sprinting: average ground contact in ms. Lower is better.", "above"),
      await marker(throwCard, "Med ball throw: the ball's peak speed.", "above"),
      await marker(trapCard, "Trap bar: the 1RM Output estimates from bar speed.", "above"),
    ],
  })

  await trapCard.first().click()
  await page.waitForURL(/\/performance\/tests\/trap_bar_deadlift_1rm$/, { timeout: 120000 })
  await page.getByRole("heading", { level: 1, name: "Trap Bar Deadlift 1RM" }).waitFor({ timeout: 120000 })
  await hideChrome()
  await page.waitForTimeout(1500)
  const noteCell = page.getByRole("cell", { name: / kg at / }).first()
  check("the history page shows the load-velocity sets", (await noteCell.count()) === 1)
  await noteCell.scrollIntoViewIfNeeded()
  await shot("02-trap-bar-history.png", {
    title: "Each day's load-velocity sets are kept with the result",
    subtitle: `Clients > ${name} > Performance > Tests > Trap Bar Deadlift 1RM`,
    markers: [
      await marker(page.getByRole("cell", { name: /^\d+(\.\d+)? kg/ }).first(), "The estimated 1RM for the day."),
      await marker(noteCell, "Every set: the weight on the bar and how fast it moved."),
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
