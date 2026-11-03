// Real-app capture of the 2026-11-03 Output fix: a single-leg CMJ comes in per leg, the sync message
// says plainly what was NOT brought in, and a test card opens that test's history instead of a 404.
//
// WRITES TO THE DEV CLONE ONLY (anjvztjiokcgiyhobknq). It needs the clone's existing Output
// connection (Darren's org), links a client with no tests to the Output athlete "darren paul"
// through the real Link button (which runs the real first sync), and at the end removes the
// imported rows and the link. The connection is left as it was. Output is only read.
//
// Run (dev server on 3050): node scripts/capture-output-single-leg.mjs
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
const DEST = "screenshots/output-single-leg"
const OUT = process.env.CAPTURE_TMP ?? `${tmpdir()}/capture-output-single-leg`
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
      page
        .frames()
        .map((f) =>
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
  const summaryText = await summary.innerText()
  console.log("summary:", summaryText)
  check(
    "the message says what was not brought in, in words",
    /Not brought in \(no matching test in the app\)/.test(summaryText),
  )
  check("the message no longer says 'Kept in Output only'", !/Kept in Output only/.test(summaryText))

  const { data: rows } = await db
    .from("performance_tests")
    .select("test_type, test_date, result_value, trial_values, is_pr")
    .eq("client_user_id", client.id)
    .not("output_key", "is", null)
    .order("test_date")
  for (const r of rows ?? [])
    console.log("  ", r.test_date, r.test_type, r.result_value, JSON.stringify(r.trial_values))
  const types = new Set((rows ?? []).map((r) => r.test_type))
  check("the left-leg CMJ came in as its own test", types.has("cmj_left"))
  check("the right-leg CMJ came in as its own test", types.has("cmj_right"))

  await page.waitForTimeout(1500)
  await shot("01-sync-message.png", {
    title: "Single-leg jumps now come in from Output",
    subtitle: `Clients > ${name} > Performance > Tests, just after linking to the Output athlete "${ATHLETE}"`,
    markers: [
      await marker(
        summary,
        'What came in, then what did NOT, by Output\'s category. It used to say "Kept in Output only", which read like results were added.',
      ),
    ],
  })

  const leftCard = page.getByRole("link", { name: "Single-Leg CMJ (Left)" })
  const rightCard = page.getByRole("link", { name: "Single-Leg CMJ (Right)" })
  await leftCard.first().scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 150))
  await hideChrome()
  await shot("02-single-leg-cards.png", {
    title: "Each leg is its own test, with its own best and its own PR",
    subtitle: `Clients > ${name} > Performance > Tests (further down)`,
    markers: [
      await marker(leftCard, "Left leg: the best single-leg jump of the day.", "above"),
      await marker(rightCard, "Right leg, kept apart so a strong leg never hides a weak one.", "above"),
    ],
  })

  await leftCard.first().click()
  await page.waitForURL(/\/performance\/tests\/cmj_left$/, { timeout: 120000 })
  const heading = page.getByRole("heading", { level: 1, name: "Single-Leg CMJ (Left)" })
  await heading.waitFor({ timeout: 120000 })
  await hideChrome()
  check("the card opens its history, not a 404", (await page.getByText("Page not found").count()) === 0)
  await page.waitForTimeout(1500)
  await shot("03-test-history.png", {
    title: 'Clicking a test card opens its history (it used to say "Page not found")',
    subtitle: `Clients > ${name} > Performance > Tests > Single-Leg CMJ (Left)`,
    markers: [
      await marker(page.getByRole("link", { name: "Back to tests" }), "Back to the Tests tab.", "after"),
      await marker(
        page.getByText(/history \(cm\)/),
        "Every result for this test over time. The PR is marked.",
        "above",
      ),
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
