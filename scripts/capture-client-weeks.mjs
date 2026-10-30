// Real-app capture: the coach sees which week each client is on.
//
// DEV CLONE ONLY (anjvztjiokcgiyhobknq). Seeds, by direct insert, a small group of three
// demo clients on one 4-week program, all with current_week = 1 (as most athletes are):
// one trained every day of week 1, one of weeks 1 and 2, one nothing yet. Then checks the
// Clients list, the program page and a client's page show weeks 2, 3 and 1. Everything it
// writes is removed again by id in `finally`.
//
// Run (dev server on 3051, started with --webpack):
//   env RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3051
//   node scripts/capture-client-weeks.mjs
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
const OUT = "screenshots/client-weeks"
const RAW = `${OUT}/raw`
const PROGRAM_ID = "d9802cb7-fba3-4bb8-80c8-669bc1b73ee5" // 4 weeks, no client on it, on the clone
const W = 1440
const H = 900
mkdirSync(RAW, { recursive: true })

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

const startedAt = new Date().toISOString()
const assignmentIds = []
let browser

try {
  const { data: admin } = await db.from("users").select("id").eq("email", env.DEV_AUTH_BYPASS_EMAIL).single()
  const { data: prog } = await db
    .from("programs")
    .select("name,duration_weeks,hidden_weeks")
    .eq("id", PROGRAM_ID)
    .single()
  if (prog.hidden_weeks.length) throw Error("program has hidden weeks; this capture expects none")
  const { data: pre } = await db
    .from("program_assignments")
    .select("id")
    .eq("program_id", PROGRAM_ID)
    .eq("status", "active")
  if (pre?.length) throw Error("the program already has clients on it")

  // Three demo clients with no active program, from the first page of the Clients list
  // searched for the demo domain (it lists newest first, 10 a page).
  const { data: demo } = await db
    .from("users")
    .select("id,first_name,last_name,email")
    .eq("role", "client")
    .like("email", "%@djpathlete.demo")
    .order("created_at", { ascending: false })
    .limit(10)
  const { data: busy } = await db.from("program_assignments").select("user_id").eq("status", "active")
  const busyIds = new Set((busy ?? []).map((r) => r.user_id))
  const group = (demo ?? []).filter((u) => !busyIds.has(u.id)).slice(0, 3)
  if (group.length < 3) throw Error(`need 3 free demo clients on the first page, found ${group.length}`)

  const { data: ex } = await db.from("program_exercises").select("week_number,day_of_week").eq("program_id", PROGRAM_ID)
  const daysOf = (w) => [...new Set(ex.filter((r) => r.week_number === w).map((r) => r.day_of_week))].sort()
  if (!daysOf(1).length || !daysOf(2).length) throw Error("weeks 1 and 2 must both have exercises")
  beat(`week 1 days ${daysOf(1).join(",")}; week 2 days ${daysOf(2).join(",")}`)

  // Weeks each client trained every day of, and the week the coach should then see.
  const plan = [
    { user: group[0], trained: [1], expect: 2 },
    { user: group[1], trained: [1, 2], expect: 3 },
    { user: group[2], trained: [], expect: 1 },
  ]
  const today = new Date().toISOString().slice(0, 10)
  for (const p of plan) {
    const { data: asg, error } = await db
      .from("program_assignments")
      .insert({
        program_id: PROGRAM_ID,
        user_id: p.user.id,
        assigned_by: admin.id,
        start_date: today,
        status: "active",
        payment_status: "not_required",
        current_week: 1,
        total_weeks: prog.duration_weeks,
      })
      .select("id")
      .single()
    if (error) throw error
    assignmentIds.push(asg.id)
    p.assignmentId = asg.id
    const sessions = p.trained.flatMap((w) =>
      daysOf(w).map((d) => ({
        user_id: p.user.id,
        assignment_id: asg.id,
        week_number: w,
        day_of_week: d,
        session_date: today,
        status: "in_progress",
      })),
    )
    if (sessions.length) {
      const { error: wsErr } = await db.from("workout_sessions").insert(sessions)
      if (wsErr) throw wsErr
    }
    beat(`seeded ${p.user.first_name} ${p.user.last_name}: trained weeks [${p.trained}] -> expect Week ${p.expect}`)
  }
  const nameOf = (u) => `${u.first_name} ${u.last_name}`

  browser = await chromium
    .launch({ channel: "chrome", headless: true })
    .catch(() => chromium.launch({ headless: true }))
  const page = await (
    await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  ).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/clients`, { waitUntil: "load", timeout: 120000 })
  const hideChrome = () =>
    page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
  await hideChrome()

  // 1. Clients list: search the demo domain so the group is on one page.
  const search = page.getByPlaceholder("Search clients...")
  await search.waitFor({ timeout: 60000 })
  await page.waitForTimeout(800) // hydration
  await search.fill("djpathlete.demo")
  await page.getByText(nameOf(plan[0].user), { exact: true }).waitFor()
  const rowOf = (p) => page.locator("tr", { has: page.getByText(nameOf(p.user), { exact: true }) })
  for (const p of plan) {
    const badge = rowOf(p).getByText(`Week ${p.expect} of ${prog.duration_weeks}`)
    check(`Clients list: ${nameOf(p.user)} shows Week ${p.expect} of ${prog.duration_weeks}`, await badge.isVisible())
  }
  const fits = await page
    .locator("table")
    .first()
    .evaluate((t) => [t.parentElement.scrollWidth, t.parentElement.clientWidth])
  check("the clients table fits at 1440px wide (no sideways scroll)", fits[0] <= fits[1], `${fits[0]} <= ${fits[1]}`)
  await page.mouse.move(3, 3)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${RAW}/01-clients-list.png` })
  await annotate(`${RAW}/01-clients-list.png`, `${OUT}/01-clients-list.png`, {
    title: "See which week every client is on",
    subtitle: "Clients (searched for the demo clients)",
    markers: [
      await marker(page.getByRole("columnheader", { name: "Program" }), "The program each client is on.", "before"),
      await marker(
        rowOf(plan[1]).getByText(`Week ${plan[1].expect} of`),
        `Trained every day of weeks 1 and 2, so on Week ${plan[1].expect}.`,
        "above",
      ),
      await marker(
        rowOf(plan[2]).getByText(`Week ${plan[2].expect} of`),
        "Has not trained yet, so still on Week 1.",
        "above",
      ),
    ],
  })
  beat("shot 01-clients-list")

  // 2. The program page: the group at a glance, without opening the panel.
  await page.goto(`${APP}/admin/programs/${PROGRAM_ID}`, { waitUntil: "load", timeout: 120000 })
  await hideChrome()
  const chips = page.getByRole("list", { name: "Week each client is on" })
  await chips.waitFor({ timeout: 60000 })
  for (const p of plan) {
    const chip = chips.getByRole("listitem").filter({ hasText: nameOf(p.user) })
    check(
      `Program page: ${nameOf(p.user)} chip reads Week ${p.expect}`,
      (await chip.innerText()).includes(`Week ${p.expect}`),
      await chip.innerText(),
    )
  }
  await chips.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 200))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${RAW}/02-program-group.png` })
  await annotate(`${RAW}/02-program-group.png`, `${OUT}/02-program-group.png`, {
    title: "A small group on one program",
    subtitle: `Programs > ${prog.name} > Client week access`,
    markers: [
      await marker(
        chips.getByRole("listitem").last(),
        "Each client and the week they are on. No need to open anything.",
        "after",
      ),
    ],
  })
  beat("shot 02-program-group")

  // 3. One client's page.
  await page.goto(`${APP}/admin/clients/${plan[0].user.id}`, { waitUntil: "load", timeout: 120000 })
  await hideChrome()
  const onWeek = page.getByText(`On Week ${plan[0].expect} of ${prog.duration_weeks}`)
  await onWeek.waitFor({ timeout: 60000 })
  check(`Client page: ${nameOf(plan[0].user)} reads On Week ${plan[0].expect}`, await onWeek.isVisible())
  await onWeek.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 150))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${RAW}/03-client-page.png` })
  await annotate(`${RAW}/03-client-page.png`, `${OUT}/03-client-page.png`, {
    title: "The same week on the client's own page",
    subtitle: `Clients > ${nameOf(plan[0].user)} > Program Assignments`,
    markers: [await marker(onWeek, "The week this client opens their workouts on.", "before")],
  })
  beat("shot 03-client-page")
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))

  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Which week each client is on</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}figure{margin:32px 0}img{width:100%;border:1px solid #ddd;border-radius:8px}</style></head><body>
<h1>Which week each client is on</h1>
<p>Real app, development clone, light mode only. Three demo clients on one 4-week program, none of whom pressed "Complete week".</p>
<figure><img src="01-clients-list.png" alt="Clients list with a Program column"><figcaption><strong>01.</strong> The Clients list shows each client's program and week.</figcaption></figure>
<figure><img src="02-program-group.png" alt="Program page with a week per client"><figcaption><strong>02.</strong> On a program, every client and their week, without opening the panel.</figcaption></figure>
<figure><img src="03-client-page.png" alt="Client page with the week"><figcaption><strong>03.</strong> The same week on the client's own page.</figcaption></figure>
</body></html>\n`,
  )
} finally {
  try {
    if (browser) await browser.close()
  } catch {}
  for (const id of assignmentIds) {
    const s = await db.from("workout_sessions").delete().eq("assignment_id", id)
    const a = await db.from("program_assignments").delete().eq("id", id)
    beat(`cleanup ${id}: sessions ${s.error ? "ERROR" : "ok"}, assignment ${a.error ? "ERROR" : "ok"}`)
  }
  const { count } = await db
    .from("program_assignments")
    .select("id", { count: "exact", head: true })
    .eq("program_id", PROGRAM_ID)
  beat(`cleanup verified: assignments left on the program ${count}`)
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ startedAt, app: APP, assertions, beats }, null, 2))
}
