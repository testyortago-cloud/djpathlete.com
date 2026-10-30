// Real-app capture: the coach's own Trained / Elite standards, set in Settings and shown on
// a client's Arena card.
//
// DEV CLONE ONLY (anjvztjiokcgiyhobknq). Picks an active client who has a logged field test
// and a date of birth, then, through the real Settings screen, adds an age group for that
// test around the client's age with a Trained number ABOVE their best, so their pill changes.
// Opens the client's Arena and checks the record shows the coach's numbers. Every
// performance_standards row it created is deleted again in `finally`.
//
// Run (dev server on 3051, started with --webpack):
//   env RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3051
//   node scripts/capture-performance-standards.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/performance/standards"
const W = 1440
const H = 900
mkdirSync(`${OUT}/raw`, { recursive: true })
// Higher-is-better tests with a plain unit (no body weight), so the numbers read simply.
const TESTS = { cmj: "Countermovement Jump", broad_jump: "Broad Jump", drop_jump: "Drop Jump", squat_jump: "Squat Jump" }

const t0 = Date.now()
const beats = []
const beat = (msg) => {
  const line = `[+${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${msg}`
  beats.push(line)
  console.log(line)
}
const assertions = []
const check = (name, ok, evidence = "") => {
  assertions.push({ name, ok, evidence })
  beat(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name} ${evidence}`)
}
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x), y: Math.round(y), caption }
}
const age = (dob) => {
  const d = new Date(dob)
  const now = new Date()
  let a = now.getUTCFullYear() - d.getUTCFullYear()
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) a--
  return a
}

const startedAt = new Date().toISOString()
let browser
try {
  // A client with a field test of one of TESTS and a birth date.
  const { data: tests } = await db
    .from("performance_tests")
    .select("client_user_id, test_type, result_value")
    .in("test_type", Object.keys(TESTS))
    .order("test_date", { ascending: false })
  let pick = null
  for (const t of tests ?? []) {
    const { data: u } = await db.from("users").select("id, first_name, last_name, role, status").eq("id", t.client_user_id).single()
    if (u?.role !== "client" || u.status !== "active") continue
    const { data: p } = await db.from("client_profiles").select("date_of_birth").eq("user_id", u.id).maybeSingle()
    if (!p?.date_of_birth) continue
    const { data: pr } = await db
      .from("performance_test_pr_view")
      .select("result_value")
      .eq("client_user_id", u.id)
      .eq("test_type", t.test_type)
      .single()
    pick = { user: u, testType: t.test_type, best: Number(pr.result_value), age: age(p.date_of_birth) }
    break
  }
  if (!pick) throw Error("no active client with a field test and a date of birth on the clone")
  const label = TESTS[pick.testType]
  // An age group around the client, with Trained above their best: they read "Developing".
  const band = { from: Math.max(0, pick.age - 1), to: pick.age + 1 }
  const nums = { floor: Math.round(pick.best * 0.6), trained: Math.round(pick.best * 1.15), elite: Math.round(pick.best * 1.4) }
  beat(`client ${pick.user.first_name} ${pick.user.last_name}, age ${pick.age}, best ${label} ${pick.best}; age group ${band.from}-${band.to} ${JSON.stringify(nums)}`)

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  const hideChrome = () =>
    page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })

  // 1. Settings: add the age group through the real screen.
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/settings/performance-standards`, { waitUntil: "load", timeout: 120000 })
  await page.getByRole("heading", { name: "Trained & Elite Standards" }).waitFor({ timeout: 90000 })
  await page.waitForTimeout(1000) // hydration
  const testRow = page.locator("tr", { has: page.getByText(label, { exact: true }) })
  await testRow.getByRole("button", { name: "Age group" }).click()
  const fill = (name, v) => page.getByRole("spinbutton", { name: `${label} ${name}` }).last().fill(String(v))
  await fill("youngest age", band.from)
  await fill("oldest age", band.to)
  await fill("starting point", nums.floor)
  await fill("Trained", nums.trained)
  await fill("Elite", nums.elite)
  const saving = page.waitForResponse((r) => r.url().includes("/api/admin/performance-standards") && r.request().method() === "POST")
  await page.getByRole("spinbutton", { name: `${label} Elite` }).last().locator("xpath=ancestor::tr").getByRole("button", { name: "Save" }).click()
  const res = await saving
  check("the age group saved (200)", res.status() === 200, String(res.status()))
  const { data: saved } = await db.from("performance_standards").select("*").gte("created_at", startedAt)
  check("one row stored, for that test and age group", saved?.length === 1 && saved[0].age_min === band.from && saved[0].age_max === band.to, JSON.stringify(saved))
  await hideChrome()
  const ageRow = page.getByRole("spinbutton", { name: `${label} youngest age` }).last()
  await ageRow.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -120))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/01-settings.png` })
  await annotate(`${OUT}/raw/01-settings.png`, `${OUT}/01-settings.png`, {
    title: "Set your own Trained and Elite numbers",
    subtitle: "Settings > Trained & Elite Standards",
    markers: [
      await marker(testRow.first().getByText("Built-in"), "\"All ages\" starts with the built-in numbers. Change them and press Save.", "after"),
      await marker(ageRow, `An age group: clients aged ${band.from} to ${band.to} are compared with these numbers instead.`, "before"),
    ],
  })
  beat("shot 01-settings")

  // 2. The client's Arena: the record now shows the coach's numbers for their age.
  await page.goto(`${APP}/admin/clients/${pick.user.id}/arena`, { waitUntil: "load", timeout: 120000 })
  await hideChrome()
  const tab = page.getByRole("tab", { name: "Performance" })
  if (await tab.count()) await tab.click()
  const line = page.getByText(`Trained ${nums.trained} `, { exact: false }).first()
  await line.waitFor({ timeout: 60000 })
  check(`the ${label} record shows the coach's Trained ${nums.trained} and Elite ${nums.elite}`, (await line.innerText()).includes(`Elite ${nums.elite}`), await line.innerText())
  const pill = line.locator("xpath=..").getByText("Developing")
  check(`and reads "Developing": the best ${pick.best} is below Trained ${nums.trained}`, await pill.isVisible())
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
  await line.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 120))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/02-arena.png` })
  await annotate(`${OUT}/raw/02-arena.png`, `${OUT}/02-arena.png`, {
    title: "The Arena card compares each result with your numbers",
    subtitle: `Clients > ${pick.user.first_name} ${pick.user.last_name} > Arena > Performance`,
    markers: [
      await marker(line, `Your numbers for a ${pick.age}-year-old.`, "above"),
      await marker(pill, "Green at or above Trained. Grey below it. Red below the starting point.", "after"),
    ],
  })
  beat("shot 02-arena")

  // 3. Where to change them, from the Arena itself.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  const editLink = page.getByRole("link", { name: /Trained & Elite standards/ })
  check("the Arena links to the standards", await editLink.isVisible())
  await page.screenshot({ path: `${OUT}/raw/03-arena-link.png` })
  await annotate(`${OUT}/raw/03-arena-link.png`, `${OUT}/03-arena-link.png`, {
    title: "Change the numbers from the Arena",
    subtitle: `Clients > ${pick.user.first_name} ${pick.user.last_name} > Arena`,
    markers: [await marker(editLink, "Opens Settings > Trained & Elite Standards.", "before")],
  })
  beat("shot 03-arena-link")

  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Trained and Elite standards</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}figure{margin:32px 0}img{width:100%;border:1px solid #ddd;border-radius:8px}</style></head><body>
<h1>Trained and Elite standards on the Arena</h1>
<p>Real app, development clone, light mode for admin. The age group was added through the Settings screen and deleted again afterwards.</p>
<figure><img src="01-settings.png" alt="Settings"><figcaption><strong>01.</strong> Set your own numbers, and add an age group.</figcaption></figure>
<figure><img src="02-arena.png" alt="Arena"><figcaption><strong>02.</strong> The client's record judged against your numbers for their age.</figcaption></figure>
<figure><img src="03-arena-link.png" alt="Arena link"><figcaption><strong>03.</strong> The link to change them, at the top of the Arena.</figcaption></figure>
</body></html>\n`,
  )
} finally {
  try {
    if (browser) await browser.close()
  } catch {}
  const { data: mine } = await db.from("performance_standards").select("id").gte("created_at", startedAt)
  for (const r of mine ?? []) await db.from("performance_standards").delete().eq("id", r.id)
  const { count } = await db.from("performance_standards").select("id", { count: "exact", head: true }).gte("created_at", startedAt)
  beat(`cleanup: removed ${mine?.length ?? 0} standard row(s); left from this run: ${count}`)
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ startedAt, app: APP, assertions, beats }, null, 2))
}
