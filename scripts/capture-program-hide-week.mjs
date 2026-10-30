// Real-app capture + leak check for hiding a week on the program itself.
//
// DEV CLONE ONLY (anjvztjiokcgiyhobknq). Drives the real routes with Playwright:
//   admin: /admin/programs/<id> (Hide Week with NO client on the program, then the week panel)
//   client: /client/workouts (signed in with a minted session for the test client)
// The test client is put on the program by a direct insert (seed), not through the UI.
// Everything it writes is removed again by id in `finally`, and the program's
// hidden_weeks is restored.
//
// Run (dev server on 3051, started with --webpack):
//   env RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3051
//   node scripts/capture-program-hide-week.mjs
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
const OUT = "screenshots/program-hide-week"
const RAW = `${OUT}/raw`
const PROGRAM_ID = "d9802cb7-fba3-4bb8-80c8-669bc1b73ee5" // 4 weeks, no client on it, on the clone
const CLIENT_EMAIL = "yara.haddad@djpathlete.demo" // demo client with no active program
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
let originalHidden = null
const shots = []
let browser

async function pickNames() {
  const { data, error } = await db.from("program_exercises").select("week_number, exercises(name)").eq("program_id", PROGRAM_ID)
  if (error) throw error
  const byWeek = {}
  for (const r of data) (byWeek[r.week_number] ??= new Set()).add(r.exercises?.name)
  const simple = (n) => /^[A-Za-z0-9 ]{8,}$/.test(n ?? "")
  const only = (w) => [...byWeek[w]].filter((n) => simple(n) && !Object.entries(byWeek).some(([k, s]) => Number(k) !== w && s.has(n)))
  const week2 = only(2)
  const week1 = only(1)
  if (!week2.length || !week1.length) throw Error("no usable distinct exercise names")
  return { week1: week1[0], week2: week2[0] }
}

async function mintCookie(user) {
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: { id: user.id, sub: user.id, email: user.email, name: `${user.first_name} ${user.last_name}`, role: user.role },
    maxAge: 24 * 60 * 60,
  })
  return { name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" }
}

const HIDE_NOISE = "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}"
// "load", not "networkidle": in dev the client nav compiles its sibling routes in the background,
// so the network is never idle. Callers wait for the element they need instead.
async function go(page, path) {
  await page.goto(`${APP}${path}`, { waitUntil: "load", timeout: 90000 })
  await page.addStyleTag({ content: HIDE_NOISE })
  await page.waitForTimeout(600) // hydration: an enabled button does nothing before it
}
// Scroll the app's own scroll container (the admin shell scrolls an inner element, not the window).
async function scrollTo(page, loc, top = 140) {
  await loc.first().evaluate((el, top) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) {
        p.scrollTop += el.getBoundingClientRect().top - top
        return
      }
      p = p.parentElement
    }
    window.scrollBy(0, el.getBoundingClientRect().top - top)
  }, top)
  await page.waitForTimeout(300)
}
const mk = async (loc, caption, place = "after") => {
  let box = await loc.first().boundingBox()
  if (!box) throw Error(`no box for marker: ${caption}`)
  if (place === "textend") {
    box = await loc.first().evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = [...range.getClientRects()]
      const last = rects[rects.length - 1]
      return { x: last.x, y: last.y, width: last.width, height: last.height }
    })
    place = "after"
  }
  if (box.y < 0 || box.y + box.height > H) throw Error(`marker offscreen: ${caption}`)
  const x = place === "after" ? box.x + box.width + 22 : place === "before" ? box.x - 22 : box.x + box.width / 2
  const y = place === "below" ? box.y + box.height + 22 : place === "above" ? box.y - 22 : box.y + box.height / 2
  return { x: Math.round(Math.min(x, W - 24)), y: Math.round(y), caption }
}
async function shot(page, file, title, subtitle, pairs, caption) {
  await page.mouse.move(W - 3, 3) // park the pointer so nothing stays hovered
  await page.waitForTimeout(500)
  const markers = []
  for (const [loc, text, place] of pairs) markers.push(await mk(loc, text, place))
  await page.screenshot({ path: `${RAW}/${file}.png` })
  await annotate(`${RAW}/${file}.png`, `${OUT}/${file}.png`, { title, subtitle, markers })
  shots.push({ file, title, caption })
  beat(`shot ${file}`)
}

try {
  const { data: admin } = await db.from("users").select("id,role").eq("email", env.DEV_AUTH_BYPASS_EMAIL).single()
  const { data: client } = await db.from("users").select("id,email,first_name,last_name,role").eq("email", CLIENT_EMAIL).single()
  if (admin?.role !== "admin" || client?.role !== "client") throw Error("admin or client missing on the clone")
  clientId = client.id
  const { data: prog } = await db.from("programs").select("id,name,duration_weeks,hidden_weeks").eq("id", PROGRAM_ID).single()
  originalHidden = prog.hidden_weeks
  if (prog.hidden_weeks.length) throw Error("program already has hidden weeks; refusing to run over data I did not make")
  const { data: preAsg } = await db.from("program_assignments").select("id").eq("program_id", PROGRAM_ID)
  if (preAsg?.length) throw Error("program already has a client; the no-client shot would be wrong")
  const { data: clientAsg } = await db.from("program_assignments").select("id").eq("user_id", client.id).eq("status", "active")
  if (clientAsg?.length) throw Error("test client already has an active program; the workouts page would be ambiguous")
  const names = await pickNames()
  beat(`program "${prog.name}"; week-1 name "${names.week1}"; week-2-only name "${names.week2}"`)

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
  const pageErrors = []

  // ===================== admin: hide week 2 with nobody on the program =====================
  const adminCtx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  const ap = await adminCtx.newPage()
  ap.on("pageerror", (e) => pageErrors.push(e.message))
  await ap.goto(`${APP}/api/dev/login?callbackUrl=/admin/programs/${PROGRAM_ID}`, { waitUntil: "networkidle" })
  await ap.addStyleTag({ content: HIDE_NOISE })
  await ap.waitForTimeout(600)
  check("admin session is signed in on the program page", ap.url().includes(`/admin/programs/${PROGRAM_ID}`), ap.url())
  check("no client is on the program: the Client week access panel is absent", (await ap.getByRole("button", { name: /Client week access/ }).count()) === 0)

  const week2Tab = ap.getByRole("button", { name: /^Week 2\b/ })
  await week2Tab.click()
  await ap.getByRole("button", { name: "Hide Week" }).click()
  await ap.getByRole("button", { name: "Show Week" }).waitFor()
  beat("coach clicked Hide Week on week 2 through the UI")
  const { data: afterHide } = await db.from("programs").select("hidden_weeks").eq("id", PROGRAM_ID).single()
  check("programs.hidden_weeks is [2]", JSON.stringify(afterHide.hidden_weeks) === "[2]", JSON.stringify(afterHide.hidden_weeks))

  await scrollTo(ap, week2Tab, 170)
  await shot(
    ap,
    "01-hide-week-no-client",
    "Hide a week before any client is on the program",
    "Programs > a program > the week buttons",
    [
      [ap.getByRole("button", { name: /^Week 2\b/ }), "Week 2 now has a crossed eye: it is hidden.", "above"],
      [ap.getByRole("button", { name: "Show Week" }), "Hide Week hides the week you have open. Click it again (now Show Week) to undo.", "before"],
      [ap.getByText(/Week 2 is hidden\. Clients on this program/), "This program has no clients yet. The week stays hidden for everyone you give it to.", "after"],
    ],
    "Open a week and click Hide Week. It works before anyone is on the program, and stays hidden for every client you add.",
  )

  // ===================== seed: the client joins the program =====================
  const today = new Date().toISOString().slice(0, 10)
  const { data: asg, error: asgErr } = await db
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
  if (asgErr) throw asgErr
  assignmentId = asg.id
  beat(`seeded assignment ${assignmentId} (client added to the program by insert)`)

  // ===================== client =====================
  const clientCtx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  await clientCtx.addCookies([await mintCookie(client)])
  const cp = await clientCtx.newPage()
  cp.on("pageerror", (e) => pageErrors.push(e.message))
  await go(cp, "/client/workouts")
  check("client session is signed in on /client/workouts", /\/client\/workouts/.test(cp.url()), cp.url())
  const waiver = cp.getByRole("dialog", { name: /Liability Waiver/ })
  if (await waiver.isVisible().catch(() => false)) {
    await waiver.getByRole("checkbox").click()
    await waiver.getByRole("button", { name: "Accept and Continue" }).click()
    await waiver.waitFor({ state: "hidden" })
    beat("client accepted the liability waiver through the UI (removed again in cleanup)")
    await go(cp, "/client/workouts") // a fresh render after the waiver, as the client's next visit
  }
  await cp.getByText(/Week 1\b/).first().waitFor({ timeout: 15000 })
  let html = await cp.content()
  if (!html.includes(names.week1)) writeFileSync(`${RAW}/debug-client.html`, html)
  check(`client HTML does NOT contain the week-2-only exercise "${names.week2}"`, !html.includes(names.week2))
  check(`control: client HTML DOES contain the week-1 exercise "${names.week1}"`, html.includes(names.week1))

  await cp.getByRole("button", { name: "Next week" }).click()
  const unavailable = cp.getByText("Week 2 isn't available yet")
  await unavailable.waitFor()
  check("client stepping to week 2 sees \"Week 2 isn't available yet\"", await unavailable.isVisible())
  await shot(
    cp,
    "02-client-hidden-week",
    "What the client sees in a hidden week",
    "Client area > Workouts > the right arrow to week 2",
    [[unavailable, "No workouts are shown, and nothing from week 2 is sent to their phone or browser.", "textend"]],
    "The client can see that week 2 exists, but none of its workouts.",
  )

  const post = (week) =>
    clientCtx.request.post(`${APP}/api/client/workouts/session`, {
      data: { assignment_id: assignmentId, week_number: week, day_of_week: 1, session_date: today },
    })
  const r2 = await post(2)
  check("direct POST /api/client/workouts/session week 2 returns 403", r2.status() === 403, `status ${r2.status()}`)
  const r1 = await post(1)
  check("control: direct POST week 1 returns 200", r1.status() === 200, `status ${r1.status()}`)

  // ===================== admin: the per-client panel now shows it =====================
  await go(ap, `/admin/programs/${PROGRAM_ID}`)
  const panelBtn = ap.getByRole("button", { name: /Client week access/ })
  await panelBtn.waitFor({ timeout: 60000 })
  // A click before hydration does nothing (and dev may reload the page once), so retry until it opens.
  for (let i = 0; i < 4 && !(await ap.getByRole("button", { name: /^W2\b/ }).isVisible()); i++) {
    await ap.waitForTimeout(1500)
    if (!(await ap.getByRole("button", { name: /^W2\b/ }).isVisible())) await panelBtn.click()
    await ap.getByRole("button", { name: /^W2\b/ }).waitFor({ timeout: 8000 }).catch(() => {})
  }
  await ap.getByRole("button", { name: /^W2\b/ }).waitFor({ timeout: 5000 })
  await ap.getByRole("button", { name: /^W2\b/ }).click()
  const wk = ap.getByRole("dialog")
  const label = wk.getByText("No, this week is hidden for everyone on this program")
  await label.waitFor()
  await shot(
    ap,
    "03-open-for-one-client",
    "Open a hidden week for one client only",
    "Programs > a program > Client week access > W2",
    [
      [label.locator("xpath=.."), "The week is hidden because you hid it on the program.", "before"],
      [wk.getByRole("button", { name: "Show now" }), "Show now opens it for this client only. Everyone else still cannot see it.", "before"],
    ],
    "Once clients are on the program, you can still open a hidden week for one person.",
  )
  await wk.getByRole("button", { name: "Show now" }).click()
  await wk.waitFor({ state: "hidden" })
  await ap.waitForTimeout(600)
  beat("coach clicked Show now for the client through the UI")

  await go(cp, "/client/workouts")
  html = await cp.content()
  check(`after Show now, client HTML DOES contain the week-2 exercise "${names.week2}"`, html.includes(names.week2))
  const r3 = await post(2)
  check("after Show now, POST week 2 returns 200", r3.status() === 200, `status ${r3.status()}`)

  // ===================== admin: Show Week undoes the program hide =====================
  await go(ap, `/admin/programs/${PROGRAM_ID}`)
  await ap.getByRole("button", { name: /^Week 2\b/ }).click()
  await ap.getByRole("button", { name: "Show Week" }).click()
  await ap.getByRole("button", { name: "Hide Week" }).waitFor()
  const { data: afterShow } = await db.from("programs").select("hidden_weeks").eq("id", PROGRAM_ID).single()
  check("Show Week empties programs.hidden_weeks", JSON.stringify(afterShow.hidden_weeks) === "[]", JSON.stringify(afterShow.hidden_weeks))
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))

  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hide a week on a program</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}figure{margin:32px 0}img{width:100%;border:1px solid #ddd;border-radius:8px}figcaption{margin-top:8px}</style></head><body>
<h1>Hide a week on a program</h1>
<p>Real app, development clone, light mode only (neither the admin nor the client area has a dark mode).</p>
${shots.map((s) => `<figure><img src="${s.file}.png" alt="${s.title}"><figcaption><strong>${s.file.slice(0, 2)}.</strong> ${s.caption}</figcaption></figure>`).join("\n")}
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
  try {
    if (assignmentId) {
      await del("workout_sessions", db.from("workout_sessions").delete().eq("assignment_id", assignmentId))
      await del("program_week_access", db.from("program_week_access").delete().eq("assignment_id", assignmentId))
      await del("program_assignments", db.from("program_assignments").delete().eq("id", assignmentId))
    }
    if (clientId)
      await del(
        "user_consents",
        db
          .from("user_consents")
          .delete()
          .eq("program_id", PROGRAM_ID)
          .eq("user_id", clientId)
          .gte("consented_at", startedAt),
      )
    if (originalHidden) await del("programs.hidden_weeks restore", db.from("programs").update({ hidden_weeks: originalHidden }).eq("id", PROGRAM_ID))
    const { data: p } = await db.from("programs").select("hidden_weeks").eq("id", PROGRAM_ID).single()
    const { count } = await db.from("program_assignments").select("id", { count: "exact", head: true }).eq("program_id", PROGRAM_ID)
    beat(`cleanup verified: hidden_weeks ${JSON.stringify(p?.hidden_weeks)}, assignments left ${count}`)
  } catch (e) {
    beat(`CLEANUP FAILED: ${e?.message ?? e}`)
  }
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ startedAt, app: APP, assertions, beats, shots: shots.map((s) => s.file) }, null, 2))
}
