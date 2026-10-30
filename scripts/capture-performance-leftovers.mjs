// Real-app capture: (1) the athlete radar (Performance > Profile and the client's Snapshot) scores tests
// against the coach's Trained / Elite standards for the client's age; (2) the Arena card shows the week the
// client is on, not the stored current_week; (3) a program's staple exercises show as Key lifts on the
// client's Progress page.
//
// DEV CLONE ONLY (anjvztjiokcgiyhobknq). Seeds, by direct insert, the demo client Yara Haddad (18) on a
// 4-week program with a session for each week-1 day (current_week stays 1, as for most athletes), four
// performance tests, a Countermovement Jump standard for ages 17-19 on the Primary business, two staples
// on the program's saved generator request, and three logged sessions of each staple. Every row it adds is
// deleted again by id in `finally`, and the program's ai_generation_params is put back as it was.
//
// Run (dev server on 3051, started with --webpack):
//   env RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3051
//   node scripts/capture-performance-leftovers.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { encode } from "next-auth/jwt"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/performance"
const PRIMARY = "00000000-0000-0000-0000-000000000001" // the dev clone's seeded data lives here
const PROGRAM_ID = "d9802cb7-fba3-4bb8-80c8-669bc1b73ee5" // 4 weeks, no client on it, on the clone
const CLIENT_EMAIL = "yara.haddad@djpathlete.demo"
const STAPLE_NAMES = ["Long reverse lunge_Quadricep", "Single leg squats_Quadricep"]
const W = 1440
const H = 900
mkdirSync(`${OUT}/raw`, { recursive: true })

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
const hideChrome = (page) =>
  page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })

/**
 * Each radar category's score, read off the chart. The chart's own scale is not the grid's outer radius
 * (a first run read every category at about 0.88 of its score), so the distances are calibrated against
 * Mobility, which nothing here changes: a sit-and-reach of 8 cm is 26 against the built-in standard.
 */
const MOBILITY_SCORE = 26
const radarScores = async (page) => {
  const raw = await page.evaluate(() => {
    const line = document.querySelector(".recharts-polar-grid-angle line")
    const poly = document.querySelector(".recharts-radar-polygon .recharts-polygon")
    if (!line || !poly) return null
    const [cx, cy, ox, oy] = ["x1", "y1", "x2", "y2"].map((a) => Number(line.getAttribute(a)))
    const r = Math.hypot(ox - cx, oy - cy)
    const pts = (poly.getAttribute("d").match(/-?[\d.]+,-?[\d.]+/g) ?? []).map((p) => p.split(",").map(Number))
    const labels = [...document.querySelectorAll(".recharts-polar-angle-axis-tick text")].map((t) => t.textContent)
    return Object.fromEntries(labels.map((l, i) => [l, (Math.hypot(pts[i][0] - cx, pts[i][1] - cy) / r) * 100]))
  })
  if (!raw?.Mobility) return raw
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((v * MOBILITY_SCORE) / raw.Mobility)]))
}

const startedAt = new Date().toISOString()
const made = { tests: [], standards: [], progress: [], assignment: null }
let originalParams = null
let browser

try {
  const { data: admin } = await db.from("users").select("id").eq("email", env.DEV_AUTH_BYPASS_EMAIL).single()
  const { data: client } = await db.from("users").select("id,email,first_name,last_name,role").eq("email", CLIENT_EMAIL).single()
  const { data: profile } = await db.from("client_profiles").select("date_of_birth").eq("user_id", client.id).single()
  const { data: prog } = await db.from("programs").select("duration_weeks,hidden_weeks,ai_generation_params").eq("id", PROGRAM_ID).single()
  if (prog.hidden_weeks.length) throw Error("program has hidden weeks; this capture expects none")
  const { data: pre } = await db.from("program_assignments").select("id").eq("user_id", client.id).eq("status", "active")
  if (pre?.length) throw Error("test client already has an active program")
  const { data: preTests } = await db.from("performance_tests").select("id").eq("client_user_id", client.id)
  if (preTests?.length) throw Error("test client already has performance tests")
  const { data: preStd } = await db.from("performance_standards").select("id").eq("business_id", PRIMARY).eq("test_type", "cmj")
  if (preStd?.length) throw Error("Primary already has a Countermovement Jump standard")
  beat(`client ${client.first_name} ${client.last_name}, born ${profile.date_of_birth}`)

  // The program, with a session for each week-1 day: the client is on week 2, current_week stays 1.
  const { data: ex } = await db
    .from("program_exercises")
    .select("exercise_id, day_of_week, exercises(name)")
    .eq("program_id", PROGRAM_ID)
    .eq("week_number", 1)
  const week1Days = [...new Set(ex.map((r) => r.day_of_week))].sort()
  const today = new Date().toISOString().slice(0, 10)
  const { data: asg, error } = await db
    .from("program_assignments")
    .insert({
      program_id: PROGRAM_ID,
      user_id: client.id,
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
  made.assignment = asg.id
  const { error: wsErr } = await db.from("workout_sessions").insert(
    week1Days.map((d) => ({ user_id: client.id, assignment_id: asg.id, week_number: 1, day_of_week: d, session_date: today, status: "in_progress" })),
  )
  if (wsErr) throw wsErr

  // Two staples on the program's saved request, and three logged sessions of each.
  const staples = STAPLE_NAMES.map((n) => {
    const row = ex.find((r) => r.exercises?.name === n)
    if (!row) throw Error(`no "${n}" in week 1`)
    return { exercise_id: row.exercise_id, name: n }
  })
  originalParams = prog.ai_generation_params
  await db
    .from("programs")
    .update({
      ai_generation_params: {
        ...originalParams,
        request: { ...originalParams.request, staple_exercises: staples.map((s, i) => ({ exercise_id: s.exercise_id, every_weeks: i + 2 })) },
      },
    })
    .eq("id", PROGRAM_ID)
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()
  const { data: prog_rows, error: epErr } = await db
    .from("exercise_progress")
    .insert(
      staples.flatMap((s, i) =>
        [21, 14, 7].map((d, k) => ({
          user_id: client.id,
          exercise_id: s.exercise_id,
          assignment_id: asg.id,
          completed_at: daysAgo(d),
          sets_completed: 3,
          reps_completed: "8",
          weight_kg: (i === 0 ? 20 : 10) + k * 2.5,
        })),
      ),
    )
    .select("id")
  if (epErr) throw epErr
  made.progress = prog_rows.map((r) => r.id)

  // Four tests, one standard: a Countermovement Jump of 40 cm is exactly Trained for ages 17-19.
  const { data: tests, error: tErr } = await db
    .from("performance_tests")
    .insert(
      [
        ["cmj", 40, "cm", "highest"],
        ["broad_jump", 210, "cm", "highest"],
        ["sprint_10m", 1.95, "s", "lowest"],
        ["sit_reach", 8, "cm", "highest"],
      ].map(([test_type, result_value, result_unit, best_method]) => ({
        best_method,
        client_user_id: client.id,
        created_by: admin.id,
        test_type,
        result_value,
        result_unit,
        test_date: today,
      })),
    )
    .select("id")
  if (tErr) throw tErr
  made.tests = tests.map((t) => t.id)
  beat(`seeded assignment ${asg.id}, ${week1Days.length} week-1 sessions, ${made.progress.length} staple logs, ${made.tests.length} tests`)

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
  const pageErrors = []

  // ── Admin ──
  const adminCtx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  const page = await adminCtx.newPage()
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/clients`, { waitUntil: "load", timeout: 120000 })
  await adminCtx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])

  const profileTab = `${APP}/admin/clients/${client.id}/performance?tab=profile`
  await page.goto(profileTab, { waitUntil: "load", timeout: 120000 })
  await page.locator(".recharts-radar-polygon").waitFor({ timeout: 60000 })
  await page.waitForTimeout(800)
  const builtIn = await radarScores(page)
  // Speed is a second fixed point: a 10 m sprint of 1.95 s is 69 against the built-in standard.
  check("the calibration holds: Speed reads its built-in 69", Math.abs((builtIn?.Speed ?? 0) - 69) <= 1, JSON.stringify(builtIn))
  check("before any standard, Power uses the built-in Countermovement Jump numbers (40 cm = 49)", Math.abs((builtIn?.Power ?? 0) - 49) <= 1, JSON.stringify(builtIn))

  const { data: std, error: sErr } = await db
    .from("performance_standards")
    .insert({ business_id: PRIMARY, test_type: "cmj", age_min: 17, age_max: 19, floor_value: 20, trained_value: 40, elite_value: 60 })
    .select("id")
    .single()
  if (sErr) throw sErr
  made.standards.push(std.id)

  await page.goto(profileTab, { waitUntil: "load", timeout: 120000 })
  await page.locator(".recharts-radar-polygon").waitFor({ timeout: 60000 })
  await page.waitForTimeout(800)
  const coach = await radarScores(page)
  check("with the coach's age group, Power reads 65: 40 cm is exactly Trained for 17-19", Math.abs((coach?.Power ?? 0) - 65) <= 1, JSON.stringify(coach))
  await hideChrome(page)
  const card = page.locator("[data-slot=card]", { has: page.locator(".recharts-radar-polygon") })
  await card.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -140))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/08-radar-performance.png` })
  await annotate(`${OUT}/raw/08-radar-performance.png`, `${OUT}/08-radar-performance.png`, {
    title: "The radar scores each test against your own standards",
    subtitle: `Clients > ${client.first_name} ${client.last_name} > Performance > Profile`,
    markers: [
      await marker(card.getByText("Power"), "Power: a 40 cm jump is exactly your Trained number for ages 17 to 19, so it scores 65.", "after"),
    ],
  })
  beat("shot 08")

  await page.goto(`${APP}/admin/clients/${client.id}/arena`, { waitUntil: "load", timeout: 120000 })
  await page.getByRole("tab", { name: "Program" }).waitFor({ timeout: 60000 })
  await page.waitForTimeout(1000) // hydration
  await page.getByRole("tab", { name: "Program" }).click()
  const weekLine = page.getByText("WEEK 2 / 4", { exact: true })
  await weekLine.waitFor({ timeout: 60000 })
  const { data: stored } = await db.from("program_assignments").select("current_week").eq("id", asg.id).single()
  check("the Arena shows week 2 of 4 while the stored current_week is still 1", stored.current_week === 1)
  await hideChrome(page)
  await weekLine.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 160))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/09-arena-week.png` })
  await annotate(`${OUT}/raw/09-arena-week.png`, `${OUT}/09-arena-week.png`, {
    title: "The Arena card shows the week the client is on",
    subtitle: `Clients > ${client.first_name} ${client.last_name} > Arena`,
    markers: [await marker(weekLine, "She trained every day of week 1, so she is on week 2. The same week the Clients list shows.", "after")],
  })
  beat("shot 09")

  // ── Client ──
  const clientCtx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: { id: client.id, sub: client.id, email: client.email, name: `${client.first_name} ${client.last_name}`, role: client.role },
    maxAge: 24 * 60 * 60,
  })
  await clientCtx.addCookies([{ name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" }])
  const cpage = await clientCtx.newPage()
  cpage.on("pageerror", (e) => pageErrors.push(e.message))

  await cpage.goto(`${APP}/client/snapshot`, { waitUntil: "load", timeout: 120000 })
  await cpage.locator(".recharts-radar-polygon").waitFor({ timeout: 60000 })
  await cpage.waitForTimeout(800)
  const mine = await radarScores(cpage)
  check("the client's own Snapshot radar reads the same Power 65", Math.abs((mine?.Power ?? 0) - 65) <= 1, JSON.stringify(mine))
  await hideChrome(cpage)
  await cpage.mouse.move(3, 3)
  await cpage.waitForTimeout(400)
  await cpage.screenshot({ path: `${OUT}/raw/10-radar-client-snapshot.png` })
  await annotate(`${OUT}/raw/10-radar-client-snapshot.png`, `${OUT}/10-radar-client-snapshot.png`, {
    title: "The client sees the same scores on their Snapshot",
    subtitle: "Client app > Snapshot",
    markers: [await marker(cpage.locator(".recharts-polar-angle-axis-tick").filter({ hasText: "Power" }), "Scored against your standards for her age, as on your Performance page.", "after")],
  })
  beat("shot 10")

  // The Progress page renders slowly under `next dev` (20-60 s in this run's log), so the waits are long.
  await cpage.goto(`${APP}/client/progress`, { waitUntil: "load", timeout: 240000 })
  const badge = cpage.getByText("Program staple", { exact: true })
  await badge.first().waitFor({ timeout: 180000 })
  check("both staples show as Key lifts with the Program staple label", (await badge.count()) === 2, String(await badge.count()))
  const weekStat = cpage.getByText("Program Week", { exact: true }).locator("xpath=../..")
  check("the Progress page's Program Week is the week she is on, 2 of 4", (await weekStat.innerText()).replace(/\s+/g, "").includes("2/4"), await weekStat.innerText())
  for (const s of staples) check(`"${s.name}" is a key lift`, await cpage.getByRole("heading", { name: s.name }).isVisible())
  // Known, not from this change: the Profile tab's TrainingStreakHeatmap (untouched here) can fail to
  // hydrate on its first cell's date. It is logged, not failed on; any other page error fails the run.
  const known = pageErrors.filter((m) => m.startsWith("Hydration failed") && m.includes("TrainingStreakHeatmap"))
  if (known.length) beat(`NOTE ${known.length} known heatmap hydration error(s), not from this change`)
  const other = pageErrors.filter((m) => !known.includes(m))
  check("no other uncaught page errors", other.length === 0, other.map((m) => m.slice(0, 200)).join(" | "))
  await hideChrome(cpage)
  await badge.first().scrollIntoViewIfNeeded()
  await cpage.evaluate(() => window.scrollBy(0, -220))
  await cpage.mouse.move(3, 3)
  await cpage.waitForTimeout(400)
  await cpage.screenshot({ path: `${OUT}/raw/11-staple-key-lifts.png` })
  await annotate(`${OUT}/raw/11-staple-key-lifts.png`, `${OUT}/11-staple-key-lifts.png`, {
    title: "Staple exercises show up as Key lifts",
    subtitle: "Client app > Progress",
    markers: [
      await marker(badge.first(), "The staples you picked in AI Generate. They appear here on their own, with the client's trend.", "after"),
      await marker(cpage.getByText("Program Week", { exact: true }), "Program Week now shows the week she is on, like her Workouts page.", "after"),
    ],
  })
  beat("shot 11")
} finally {
  try {
    if (browser) await browser.close()
  } catch {}
  const del = async (label, q) => {
    const { error } = await q
    beat(`cleanup ${label}: ${error ? "ERROR " + JSON.stringify(error) : "ok"}`)
  }
  if (made.standards.length) await del("performance_standards", db.from("performance_standards").delete().in("id", made.standards))
  if (made.tests.length) await del("performance_tests", db.from("performance_tests").delete().in("id", made.tests))
  if (made.progress.length) await del("exercise_progress", db.from("exercise_progress").delete().in("id", made.progress))
  if (made.assignment) {
    await del("workout_sessions", db.from("workout_sessions").delete().eq("assignment_id", made.assignment))
    await del("program_assignments", db.from("program_assignments").delete().eq("id", made.assignment))
  }
  if (originalParams) await del("programs.ai_generation_params", db.from("programs").update({ ai_generation_params: originalParams }).eq("id", PROGRAM_ID))
  const { count } = await db.from("program_assignments").select("id", { count: "exact", head: true }).eq("program_id", PROGRAM_ID)
  const { data: back } = await db.from("programs").select("ai_generation_params").eq("id", PROGRAM_ID).single()
  beat(`cleanup verified: assignments on the program ${count}; staples left on it: ${back?.ai_generation_params?.request?.staple_exercises ? "YES" : "none"}`)
  writeFileSync(`${OUT}/run-leftovers.json`, JSON.stringify({ startedAt, app: APP, assertions, beats }, null, 2))
}
