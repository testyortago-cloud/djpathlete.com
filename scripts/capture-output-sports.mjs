// Real-app capture of the Output Sports integration, start to finish: Settings > Output Sports
// (connect), then a client's Performance > Tests (link, results brought in).
//
// WRITES TO THE DEV CLONE ONLY (anjvztjiokcgiyhobknq), and removes what it wrote at the end: the
// imported performance_tests rows, the link and the connection (with its Vault secret). It signs in
// to Output with OUTPUT_OWNER_EMAIL / OUTPUT_OWNER_PASSWORD from .env.local and never prints them.
//
// Run (dev server on 3050): node scripts/capture-output-sports.mjs
import { cpSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
if (!env.OUTPUT_OWNER_EMAIL || !env.OUTPUT_OWNER_PASSWORD) throw Error("OUTPUT_OWNER_EMAIL / _PASSWORD missing")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3050"
// Shots are written OUTSIDE the project while the browser runs: a new file inside it makes the dev
// server rebuild, and the rebuild reloads the page mid-capture. They are copied in at the end.
const DEST = "screenshots/output-sports"
const OUT = process.env.CAPTURE_TMP ?? `${tmpdir()}/capture-output-sports`
const W = 1440
const H = 900
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

// An active client with NO performance tests, so cleanup is a plain delete and the Tests tab
// shows only what came from Output.
const { data: tested } = await db.from("performance_tests").select("client_user_id").limit(1000)
const testedIds = new Set((tested ?? []).map((t) => t.client_user_id))
const { data: clients } = await db
  .from("users")
  .select("id, first_name, last_name")
  .eq("role", "client")
  .eq("status", "active")
  .not("first_name", "is", null)
  .limit(200)
const client = (clients ?? []).find((c) => !testedIds.has(c.id) && !/test/i.test(`${c.first_name} ${c.last_name}`))
if (!client) throw Error("no active client without tests on the clone")
const name = `${client.first_name} ${client.last_name}`
const { data: existingConn } = await db.from("output_connections").select("business_id")
if ((existingConn ?? []).length) throw Error("the clone already has an Output connection; not touching it")

async function cleanup() {
  const { count } = await db
    .from("performance_tests")
    .delete({ count: "exact" })
    .eq("client_user_id", client.id)
    .not("output_key", "is", null)
  await db.from("output_athlete_links").delete().eq("client_user_id", client.id)
  const { data: conns } = await db.from("output_connections").select("business_id")
  for (const c of conns ?? []) await db.rpc("fn_disconnect_output", { p_business_id: c.business_id })
  console.log(`cleanup: removed ${count ?? 0} imported results, the link and ${(conns ?? []).length} connection(s)`)
}

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const page = await (
    await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  ).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  const hideChrome = () =>
    page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
  const shot = async (file, opts) => {
    await page.mouse.move(3, 3)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/raw/${file}` })
    await annotate(`${OUT}/raw/${file}`, `${OUT}/${file}`, opts)
  }
  const perfUrl = `/admin/clients/${client.id}/performance?tab=tests`

  // 1. Before connecting: the Tests tab points to Settings.
  await page.goto(`${APP}/api/dev/login?callbackUrl=${encodeURIComponent(perfUrl)}`, {
    waitUntil: "load",
    timeout: 180000,
  })
  const settingsLink = page.getByRole("link", { name: "Connect Output Sports in Settings" })
  await settingsLink.waitFor({ timeout: 120000 })
  await hideChrome()
  check(
    "not connected: the Tests tab links to Settings",
    (await settingsLink.getAttribute("href")) === "/admin/settings/output-sports",
  )
  await shot("01-tests-tab-not-connected.png", {
    title: "Before Output is connected",
    subtitle: `Clients > ${name} > Performance > Tests`,
    markers: [
      await marker(settingsLink, "Output isn't connected yet. This link opens the page to connect it.", "above"),
    ],
  })

  // 2. Settings > Output Sports, empty.
  await page.goto(`${APP}/admin/settings/output-sports`, { waitUntil: "load", timeout: 120000 })
  const email = page.getByLabel("Output email")
  await email.waitFor({ timeout: 90000 })
  await hideChrome()
  await page.waitForTimeout(1500) // hydration
  await email.fill("")
  await shot("02-settings-connect.png", {
    title: "Connect your Output account once",
    subtitle: "Settings > Output Sports",
    markers: [
      await marker(email, "The email you sign in to Output with (the account that owns your team)."),
      await marker(
        page.getByText("Your password is used once", { exact: false }),
        "The password is used once and never saved.",
      ),
      await marker(
        page.getByRole("button", { name: "Connect Output Sports" }),
        "Connects. Done once, not per client.",
        "after",
      ),
    ],
  })

  // 3. Connect with the dev Output login.
  await email.fill(env.OUTPUT_OWNER_EMAIL)
  await page.getByLabel("Output password").fill(env.OUTPUT_OWNER_PASSWORD)
  await page.getByRole("button", { name: "Connect Output Sports" }).click()
  const connected = page.getByText("Connected", { exact: true })
  await connected.waitFor({ timeout: 60000 })
  const { data: conn } = await db.from("output_connections").select("account_email, credentials_secret_id").single()
  check("the connection row exists with a Vault secret", !!conn?.credentials_secret_id)
  const { data: secretTxt } = await db.rpc("fn_output_refresh_token", {
    p_business_id: (await db.from("output_connections").select("business_id").single()).data.business_id,
  })
  check("what is stored is not the password", !!secretTxt && secretTxt !== env.OUTPUT_OWNER_PASSWORD)
  await shot("03-settings-connected.png", {
    title: "Connected",
    subtitle: "Settings > Output Sports",
    markers: [
      await marker(connected, "Output is connected. It says so here if Output ever stops accepting it.", "above"),
      await marker(page.getByRole("heading", { name: "How it works" }), "The three steps for each client.", "above"),
    ],
  })

  // 4. Tests tab: link button.
  await page.goto(`${APP}${perfUrl}`, { waitUntil: "load", timeout: 120000 })
  const linkBtn = page.getByRole("button", { name: "Link to Output athlete" })
  await linkBtn.waitFor({ timeout: 90000 })
  await hideChrome()
  await page.waitForTimeout(1500) // hydration
  await shot("04-tests-tab-link.png", {
    title: "Link the client to their Output athlete",
    subtitle: `Clients > ${name} > Performance > Tests`,
    markers: [await marker(linkBtn, "Add the athlete in the Output app first, then click here.", "above")],
  })

  // 5. The picker.
  await linkBtn.click()
  const trigger = page.getByRole("combobox", { name: "Output athlete" })
  await trigger.waitFor({ timeout: 60000 })
  await trigger.click()
  const option = page.getByRole("option", { name: /Performance Paddy/ })
  await option.waitFor({ timeout: 10000 })
  await shot("05-choose-athlete.png", {
    title: "Pick them from your Output athletes",
    subtitle: `Clients > ${name} > Performance > Tests`,
    markers: [
      await marker(option, "Your Output athletes. A likely match by name or birthday is marked and picked for you."),
    ],
  })
  await option.click()

  // 6. Link: results come in.
  await page.getByRole("button", { name: "Link and bring in results" }).click()
  const linked = page.locator("strong", { hasText: "Performance Paddy" }).first()
  await linked.waitFor({ timeout: 120000 })
  const summary = page.getByText(/new results?|No new results/)
  await summary.waitFor({ timeout: 60000 })
  const { data: rows } = await db
    .from("performance_tests")
    .select("test_type, test_date, result_value, result_unit, trial_values, is_pr, notes")
    .eq("client_user_id", client.id)
    .not("output_key", "is", null)
    .order("test_date")
  check(
    "results were imported",
    (rows ?? []).length > 0,
    `${rows?.length} rows: ${[...new Set(rows.map((r) => r.test_type))].join(", ")}`,
  )
  check(
    "every imported row says where it came from",
    rows.every((r) => /Output Sports/.test(r.notes)),
  )
  check(
    "each test type has a first PR",
    new Set(rows.filter((r) => r.is_pr).map((r) => r.test_type)).size === new Set(rows.map((r) => r.test_type)).size,
  )
  for (const r of rows.slice(0, 6))
    console.log("  ", r.test_date, r.test_type, r.result_value, r.result_unit, JSON.stringify(r.trial_values))
  await page.waitForTimeout(1500)
  const firstCard = page.locator("text=Countermovement Jump").first()
  await shot("06-results-in.png", {
    title: "Their Output results are in",
    subtitle: `Clients > ${name} > Performance > Tests`,
    markers: [
      await marker(linked, "Who they are in Output, and when the results were last brought in.", "above"),
      await marker(
        page.getByRole("button", { name: "Sync from Output" }),
        "After each testing session, click to bring in new results.",
        "above",
      ),
      await marker(summary, "What came in. Other kinds of Output result (mobility, throws) stay in Output."),
      await marker(
        page.getByText("Test report preview"),
        "The client's test report already shows the new results.",
        "above",
      ),
    ],
  })

  // 6b. The imported results as test cards.
  await firstCard.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 200))
  await shot("07-test-cards.png", {
    title: "Each Output test becomes a test result",
    subtitle: `Clients > ${name} > Performance > Tests (further down)`,
    markers: [
      await marker(firstCard, "One result per test per day: the best attempt, with every attempt kept.", "above"),
    ],
  })
  await page.evaluate(() => window.scrollTo(0, 0))

  // 7. A second sync changes nothing: the same days are updated, not duplicated.
  const before = rows.length
  await page.getByRole("button", { name: "Sync from Output" }).click()
  await page.getByText(/No new results|updated/).waitFor({ timeout: 120000 })
  const { count: after } = await db
    .from("performance_tests")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", client.id)
    .not("output_key", "is", null)
  check("a second sync adds no duplicates", after === before, `${before} -> ${after}`)
  // 8. Wrong athlete: unlink and remove what it brought in. Typed-in results are never touched.
  await page.getByRole("button", { name: "Unlink" }).click()
  await page.getByRole("button", { name: "Unlink and remove its results" }).click()
  await page.getByRole("button", { name: "Link to Output athlete" }).waitFor({ timeout: 60000 })
  const { count: left } = await db
    .from("performance_tests")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", client.id)
    .not("output_key", "is", null)
  check("unlink and remove leaves no imported results", left === 0, `${left} left`)
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
  mkdirSync(DEST, { recursive: true })
  cpSync(OUT, DEST, { recursive: true })
  console.log(`shots copied to ${DEST}`)
} finally {
  await browser.close()
  await cleanup()
}
