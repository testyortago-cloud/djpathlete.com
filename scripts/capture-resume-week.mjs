// Real-app capture: a client who trained every day of week 1 reopens Workouts on week 2.
//
// DEV CLONE ONLY (anjvztjiokcgiyhobknq). Seeds, by direct insert, the test client on a
// program plus one workout session for each training day of week 1 (current_week stays 1,
// as it does for most athletes). Opens /client/workouts with a minted session and checks
// the page lands on week 2. Everything it writes is removed again by id in `finally`.
//
// Run (dev server on 3051, started with --webpack):
//   env RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3051
//   node scripts/capture-resume-week.mjs
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
const OUT = "screenshots/resume-week"
const RAW = `${OUT}/raw`
const PROGRAM_ID = "d9802cb7-fba3-4bb8-80c8-669bc1b73ee5" // 4 weeks, no client on it, on the clone
const CLIENT_EMAIL = "yara.haddad@djpathlete.demo"
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

const startedAt = new Date().toISOString()
let assignmentId = null
let clientId = null
let browser

try {
  const { data: admin } = await db.from("users").select("id").eq("email", env.DEV_AUTH_BYPASS_EMAIL).single()
  const { data: client } = await db.from("users").select("id,email,first_name,last_name,role").eq("email", CLIENT_EMAIL).single()
  clientId = client.id
  const { data: prog } = await db.from("programs").select("duration_weeks,hidden_weeks").eq("id", PROGRAM_ID).single()
  if (prog.hidden_weeks.length) throw Error("program has hidden weeks; this capture expects none")
  const { data: pre } = await db.from("program_assignments").select("id").eq("user_id", client.id).eq("status", "active")
  if (pre?.length) throw Error("test client already has an active program")
  const { data: ex } = await db.from("program_exercises").select("day_of_week").eq("program_id", PROGRAM_ID).eq("week_number", 1)
  const week1Days = [...new Set(ex.map((r) => r.day_of_week))].sort()
  beat(`week 1 training days: ${week1Days.join(", ")}`)

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
  assignmentId = asg.id
  // A session per week-1 day, left in_progress: what most athletes leave behind.
  const { error: wsErr } = await db.from("workout_sessions").insert(
    week1Days.map((d) => ({
      user_id: client.id,
      assignment_id: assignmentId,
      week_number: 1,
      day_of_week: d,
      session_date: today,
      status: "in_progress",
    })),
  )
  if (wsErr) throw wsErr
  // The waiver is accepted already, so the page renders straight away.
  const { data: doc } = await db.from("legal_documents").select("id").eq("document_type", "liability_waiver").eq("is_active", true).limit(1).maybeSingle()
  if (doc) {
    await db.from("user_consents").insert({ user_id: client.id, consent_type: "liability_waiver", legal_document_id: doc.id, program_id: PROGRAM_ID })
  }
  beat(`seeded assignment ${assignmentId} with ${week1Days.length} week-1 sessions; current_week = 1`)

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: { id: client.id, sub: client.id, email: client.email, name: `${client.first_name} ${client.last_name}`, role: client.role },
    maxAge: 24 * 60 * 60,
  })
  await ctx.addCookies([{ name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" }])
  const page = await ctx.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await page.goto(`${APP}/client/workouts`, { waitUntil: "load", timeout: 90000 })
  await page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
  const waiver = page.getByRole("dialog", { name: /Liability Waiver/ })
  if (await waiver.isVisible().catch(() => false)) throw Error("waiver still showing; the seeded consent did not take")

  const weekNav = page.getByText("You're on Week 2 of 4").first()
  await weekNav.waitFor({ timeout: 30000 }).catch(async (e) => {
    await page.screenshot({ path: `${RAW}/debug.png` })
    writeFileSync(`${RAW}/debug.txt`, await page.locator("main").innerText().catch(() => ""))
    throw e
  })
  check("the page opens on week 2", await weekNav.isVisible())
  check('no "This isn\'t your current week" banner', (await page.getByText("This isn't your current week").count()) === 0)
  const progressText = page.getByText("1/4 weeks").first()
  check('progress reads "1/4 weeks"', await progressText.isVisible())
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))

  await page.mouse.move(W - 3, 3)
  await page.waitForTimeout(500)
  const box = await weekNav.boundingBox()
  const progress = await progressText.boundingBox()
  await page.screenshot({ path: `${RAW}/01-opens-on-week-2.png` })
  await annotate(`${RAW}/01-opens-on-week-2.png`, `${OUT}/01-opens-on-week-2.png`, {
    title: "A client who finished week 1 comes back to week 2",
    subtitle: "Client area > Workouts, after training every day of week 1",
    markers: [
      { x: Math.round(box.x + box.width + 22), y: Math.round(box.y + box.height / 2), caption: "The page opens on week 2. The client does not have to look for it." },
      { x: Math.round(progress.x - 22), y: Math.round(progress.y + progress.height / 2), caption: "Week 1 counts as done." },
    ],
  })
  beat("shot 01-opens-on-week-2")
  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Workouts opens on the client's week</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}img{width:100%;border:1px solid #ddd;border-radius:8px}</style></head><body>
<h1>Workouts opens on the client's week</h1>
<p>Real app, development clone, light mode only. The client trained every day of week 1 and never pressed "Complete week".</p>
<figure><img src="01-opens-on-week-2.png" alt="Workouts opens on week 2"><figcaption>The page opens on week 2, the week they are on.</figcaption></figure>
</body></html>\n`,
  )
} finally {
  try {
    if (browser) await browser.close()
  } catch {}
  const del = async (label, q) => {
    const { error } = await q
    beat(`cleanup ${label}: ${error ? "ERROR " + JSON.stringify(error) : "ok"}`)
  }
  if (assignmentId) {
    await del("workout_sessions", db.from("workout_sessions").delete().eq("assignment_id", assignmentId))
    await del("program_assignments", db.from("program_assignments").delete().eq("id", assignmentId))
  }
  if (clientId)
    await del("user_consents", db.from("user_consents").delete().eq("program_id", PROGRAM_ID).eq("user_id", clientId).gte("consented_at", startedAt))
  const { count } = await db.from("program_assignments").select("id", { count: "exact", head: true }).eq("program_id", PROGRAM_ID)
  beat(`cleanup verified: assignments left ${count}`)
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ startedAt, app: APP, assertions, beats }, null, 2))
}
