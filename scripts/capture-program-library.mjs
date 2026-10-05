// Real-app capture + leak check for the program library and weekly week release.
//
// DEV CLONE ONLY (anjvztjiokcgiyhobknq). Drives the real routes with Playwright:
//   admin: /admin/programs?tab=library, /admin/programs, /admin/programs/<id>
//   client: /client/workouts (signed in with a minted session for the test client)
// and asserts the leak is closed: a week the client may not see never reaches
// the browser (checked on the rendered DOM, which includes the Next flight data).
//
// Run (dev server on 3051, started with --webpack):
//   env RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3051
//   node scripts/capture-program-library.mjs
// RESEND_API_KEY is blanked so giving the program cannot email the test client.
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
const OUT = "screenshots/program-library"
const RAW = `${OUT}/raw`
const SOURCE_PROGRAM_ID = "10040c69-2005-483e-893b-a422f21d6373" // "Miles the Baller", free, 4 weeks, on the clone
const CLIENT_EMAIL = "yara.haddad@djpathlete.demo" // demo client with a finished questionnaire and no active program
const FOLDER_A = "12-week strength"
const FOLDER_B = "Return from injury"
const LIB_NAME = "Strength Foundation"
const W = 1440
const H = 900
const DSF = 1
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
const created = { folderIds: [], libraryProgramId: null, copyProgramId: null, assignmentId: null }
const shots = []
let browser

// ---- pick the week-2-only and week-1 exercise names from the clone (read-only) ----
async function pickNames() {
  const { data, error } = await db
    .from("program_exercises")
    .select("week_number, exercises(name)")
    .eq("program_id", SOURCE_PROGRAM_ID)
  if (error) throw error
  const byWeek = {}
  for (const r of data) (byWeek[r.week_number] ??= new Set()).add(r.exercises?.name)
  const simple = (n) => /^[A-Za-z0-9 ]{8,}$/.test(n ?? "")
  const others = (w, n) => Object.entries(byWeek).some(([k, s]) => Number(k) !== w && s.has(n))
  const week2Only = [...byWeek[2]].filter((n) => simple(n) && !others(2, n))
  const week1Only = [...byWeek[1]].filter((n) => simple(n) && !others(1, n))
  if (!week2Only.length || !week1Only.length) throw Error("no usable distinct exercise names")
  return { week2: week2Only[0], week1: week1Only[0] }
}

async function mintCookie(user) {
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      role: user.role,
    },
    maxAge: 24 * 60 * 60,
  })
  return { name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" }
}

const HIDE_NOISE = "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}"
async function go(page, path) {
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle" })
  await page.addStyleTag({ content: HIDE_NOISE })
  await page.waitForTimeout(600) // hydration: an enabled button does nothing before it
}
const mk = async (loc, caption, place = "after") => {
  let box = await loc.first().boundingBox()
  if (!box) throw Error(`no box for marker: ${caption}`)
  if (place === "textend") {
    // a block element can span the page; mark the end of its actual text instead
    const r = await loc.first().evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = [...range.getClientRects()]
      const last = rects[rects.length - 1]
      return { x: last.x, y: last.y, width: last.width, height: last.height }
    })
    box = r
    place = "after"
  }
  if (box.y < 0 || box.y + box.height > H) throw Error(`marker offscreen: ${caption}`)
  const x = place === "after" ? box.x + box.width + 22 : place === "before" ? box.x - 22 : box.x + box.width / 2
  return { x: Math.round(Math.min(x, W - 24) * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}
async function shot(page, file, title, subtitle, pairs, caption) {
  await page.mouse.move(W - 3, H - 3) // park the pointer so nothing stays hovered
  await page.waitForTimeout(500)
  const markers = []
  for (const [loc, text, place] of pairs) markers.push(await mk(loc, text, place))
  await page.screenshot({ path: `${RAW}/${file}.png` })
  await annotate(`${RAW}/${file}.png`, `${OUT}/${file}.png`, { title, subtitle, markers })
  shots.push({ file, title, caption })
  beat(`shot ${file}`)
}

try {
  const { data: admin } = await db.from("users").select("id,email,first_name,last_name,role").eq("email", env.DEV_AUTH_BYPASS_EMAIL).single()
  const { data: client } = await db.from("users").select("id,email,first_name,last_name,role").eq("email", CLIENT_EMAIL).single()
  if (admin?.role !== "admin" || client?.role !== "client") throw Error("admin or client missing on the clone")
  const { data: preFolders } = await db.from("program_folders").select("id,name").in("name", [FOLDER_A, FOLDER_B])
  if (preFolders?.length) throw Error("folders already exist on the clone; refusing to run over data I did not make")
  const { data: preAssign } = await db.from("program_assignments").select("id").eq("user_id", client.id).eq("status", "active")
  if (preAssign?.length) throw Error("test client already has an active program; the workouts page would be ambiguous")
  const names = await pickNames()
  beat(`week-1 name: "${names.week1}"  week-2-only name: "${names.week2}"`)

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))

  // ===================== admin =====================
  const adminCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, reducedMotion: "reduce" })
  const ap = await adminCtx.newPage()
  const pageErrors = []
  ap.on("pageerror", (e) => pageErrors.push(e.message))
  await ap.goto(`${APP}/api/dev/login?callbackUrl=/admin/programs?tab=library`, { waitUntil: "networkidle" })
  await ap.addStyleTag({ content: HIDE_NOISE })
  check("admin session is signed in", /\/admin\/programs/.test(ap.url()) && !/login/.test(ap.url()), ap.url())
  beat("admin opened the Library tab")

  // 8. empty library
  await ap.getByRole("heading", { name: "Your library is empty" }).waitFor()
  await shot(
    ap,
    "08-empty-library",
    "A new library starts empty, with one clear next step",
    "Programs > Library tab, before any folder exists",
    [
      [ap.getByRole("heading", { name: "Your library is empty" }), "This is what a coach sees before making any folder."],
      [ap.getByRole("button", { name: "New folder" }), "Click New folder to start. Programs in the library are never shown to clients."],
    ],
    "Before you make a folder, the Library tab is empty and tells you what to do first.",
  )

  // make folder A
  await ap.getByRole("button", { name: "New folder" }).click()
  await ap.getByLabel("Folder name").fill(FOLDER_A)
  await ap.getByRole("button", { name: "Save", exact: true }).click()
  await ap.getByRole("button", { name: new RegExp(FOLDER_A) }).waitFor()
  beat(`folder "${FOLDER_A}" created through the UI`)
  await ap.getByRole("button", { name: "New folder" }).click()
  await ap.getByLabel("Folder name").fill(FOLDER_B)
  await ap.getByRole("button", { name: "Save", exact: true }).click()
  await ap.getByRole("button", { name: new RegExp(FOLDER_B) }).waitFor()
  beat(`folder "${FOLDER_B}" created through the UI`)
  const { data: folders } = await db.from("program_folders").select("id,name").in("name", [FOLDER_A, FOLDER_B])
  created.folderIds = folders.map((f) => f.id)
  const folderA = folders.find((f) => f.name === FOLDER_A)

  // save to library from the Client programs tab
  await go(ap, "/admin/programs")
  await ap.getByPlaceholder("Search programs...").fill("Miles the Baller")
  const saveBtn = ap.getByRole("button", { name: "Save Miles the Baller to your library" })
  await saveBtn.waitFor()
  await saveBtn.click()
  const saveDialog = ap.getByRole("dialog", { name: "Save to library" })
  await saveDialog.waitFor()
  await ap.locator("#save-folder").selectOption({ label: FOLDER_A })
  await ap.locator("#save-name").fill(LIB_NAME)
  await shot(
    ap,
    "03-save-to-library",
    "Save a client's program into your library",
    "Programs > Client programs > the folder icon on a row",
    [
      [saveDialog.getByText("A copy goes into your library"), "A copy is saved. The original program and the people on it do not change."],
      [ap.locator("#save-folder"), "Choose the folder it goes in, or make a new one."],
      [ap.locator("#save-name"), "Give it a clear name you will recognise later."],
    ],
    "Save any client program as a ready-made copy in a folder. The original stays as it was.",
  )
  await saveDialog.getByRole("button", { name: "Save to library" }).click()
  await ap.waitForURL(/tab=library/)
  await ap.getByRole("link", { name: LIB_NAME }).waitFor()
  beat("saved to library through the UI")
  const { data: libProg } = await db.from("programs").select("id,name,is_template,folder_id,stripe_price_id").eq("folder_id", folderA.id)
  check("library copy exists, is a template, in the folder, no Stripe ids", libProg?.length === 1 && libProg[0].is_template === true && !libProg[0].stripe_price_id, JSON.stringify(libProg))
  created.libraryProgramId = libProg[0].id

  await ap.addStyleTag({ content: HIDE_NOISE })
  await shot(
    ap,
    "01-library-folders-and-programs",
    "The Library: folders on the left, programs in the folder on the right",
    "Programs > Library tab",
    [
      [ap.getByRole("button", { name: new RegExp(FOLDER_A) }), "Each folder shows how many programs it holds."],
      [ap.getByRole("link", { name: LIB_NAME }), "A ready-made program, kept for you to reuse."],
      [ap.getByRole("button", { name: "Give to client" }), "Click this to hand a client their own copy."],
    ],
    "Folders hold your ready-made programs. Programs here are never shown to clients until you give one.",
  )

  // 9. refused folder delete
  await ap.getByRole("button", { name: "Folder options" }).click()
  const blocked = ap.getByRole("menuitem", { name: /move or delete its programs first/i })
  await blocked.waitFor()
  check("folder delete is refused while it holds a program", (await blocked.getAttribute("aria-disabled")) === "true" || (await blocked.getAttribute("data-disabled")) !== null)
  await shot(
    ap,
    "09-folder-delete-refused",
    "A folder that still holds programs cannot be deleted",
    "Programs > Library tab > the three dots next to the folder name",
    [[blocked, "Delete is greyed out: move or delete the programs inside first. Nothing is lost by accident."]],
    "You cannot delete a folder that still has programs in it. The menu says what to do first.",
  )
  await ap.keyboard.press("Escape")

  // 2. give to client
  await ap.getByRole("button", { name: "Give to client" }).click()
  const give = ap.getByRole("dialog", { name: "Give to a client" })
  await give.waitFor()
  await ap.waitForTimeout(800) // client list loads
  await give.getByPlaceholder("Search clients...").fill("Yara Haddad")
  await give.getByRole("option", { name: /Yara Haddad/ }).click()
  await give.locator("#give-weeks").fill("1")
  await shot(
    ap,
    "02-give-to-a-client",
    "Give a library program to one client as their own copy",
    "Programs > Library tab > Give to client",
    [
      [give.getByRole("option", { name: /Yara Haddad/ }), "Pick the client. They get their own copy of the program.", "after"],
      [give.locator("#give-release"), "On: a new week opens every 7 days. Off: they see every week at once.", "after"],
      [give.locator("#give-weeks"), "How many weeks they can see on day one. Here: just week 1.", "after"],
      [give.getByRole("button", { name: "Give program" }), "Click Give program. You can open or hide any week later."],
    ],
    "Pick a client, choose how many weeks they see first, and give the program. They get their own copy.",
  )
  await give.getByRole("button", { name: "Give program" }).click()
  await ap.waitForURL(/\/admin\/programs\/[0-9a-f-]{36}$/)
  created.copyProgramId = ap.url().split("/").pop()
  beat(`program given through the UI; copy ${created.copyProgramId}`)
  const { data: asg } = await db.from("program_assignments").select("id,user_id,release_base_week,release_anchor_at,status").eq("program_id", created.copyProgramId)
  created.assignmentId = asg?.[0]?.id ?? null
  check("copy is assigned to the test client with release on and 1 week visible", asg?.length === 1 && asg[0].user_id === client.id && asg[0].release_base_week === 1 && !!asg[0].release_anchor_at, JSON.stringify(asg))

  // 4/5. week panel
  await ap.addStyleTag({ content: HIDE_NOISE })
  await ap.getByRole("button", { name: /Client week access/ }).click()
  await ap.getByText("One week at a time", { exact: true }).waitFor()
  await ap.getByRole("button", { name: /^W2\b/ }).waitFor()
  await ap.getByRole("button", { name: /Client week access/ }).scrollIntoViewIfNeeded()
  // hide week 4 (the coach changes their mind about a late week)
  await ap.getByRole("button", { name: /^W4\b/ }).click()
  await ap.getByRole("dialog").getByRole("button", { name: "Hide" }).click()
  await ap.getByRole("button", { name: /^W4\b/ }).waitFor()
  await ap.waitForTimeout(800)
  beat("coach hid week 4 through the UI")
  await ap.getByText("Client week access").first().scrollIntoViewIfNeeded()
  await ap.evaluate(() => {
    const el = [...document.querySelectorAll("h3")].find((h) => h.textContent?.includes("Client week access"))
    let p = el?.parentElement
    while (p && p !== document.body) {
      if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) {
        p.scrollTop += el.getBoundingClientRect().top - 140
        return
      }
      p = p.parentElement
    }
    window.scrollBy(0, el.getBoundingClientRect().top - 140)
  })
  await shot(
    ap,
    "04-week-panel",
    "Client week access: one week at a time, with weeks that are not out yet",
    "A client's program page > Client week access",
    [
      [ap.getByRole("switch", { name: /Release one week at a time for/ }), "Turn One week at a time on or off for this client.", "before"],
      [ap.getByText(/A new week opens every 7 days\. Next:/), "It tells you when the next week opens.", "textend"],
      [ap.getByRole("button", { name: /^W4\b/ }), "W2 and W3 are faded: not out yet, so the client cannot see them. W4 has a crossed eye: you hid it.", "after"],
    ],
    "The coach sees every week for this client. Faded means not out yet. A crossed eye means hidden by you.",
  )

  // 5. week modal
  await ap.getByRole("button", { name: /^W2\b/ }).click()
  const wk = ap.getByRole("dialog")
  await wk.getByRole("button", { name: "Show now" }).waitFor()
  await shot(
    ap,
    "05-week-show-or-hide",
    "Open any week early, or hide it, for one client",
    "Click a week such as W2 on the panel",
    [
      [wk.locator("p", { hasText: "Can the client see it?" }), "It says whether the client can see this week, and when it opens.", "after"],
      [wk.getByRole("button", { name: "Show now" }), "Show now opens the week for this client right away.", "before"],
      [wk.getByRole("button", { name: "Hide", exact: true }), "Hide keeps the week from the client until you change it.", "after"],
    ],
    "Open a week early with Show now, or keep it from the client with Hide.",
  )
  await ap.keyboard.press("Escape")
  await ap.waitForTimeout(400)

  // ===================== client =====================
  const clientCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, reducedMotion: "reduce" })
  await clientCtx.addCookies([await mintCookie(client)])
  const cp = await clientCtx.newPage()
  cp.on("pageerror", (e) => pageErrors.push(e.message))
  await go(cp, "/client/workouts")
  check("client session is signed in on /client/workouts", /\/client\/workouts/.test(cp.url()) && !/login/.test(cp.url()), cp.url())
  // The real first-visit step for a new program: the client accepts the liability waiver.
  const waiver = cp.getByRole("dialog", { name: /Liability Waiver/ })
  if (await waiver.isVisible().catch(() => false)) {
    await waiver.getByRole("checkbox").click()
    await waiver.getByRole("button", { name: "Accept and Continue" }).click()
    await waiver.waitFor({ state: "hidden" })
    beat("client accepted the liability waiver through the UI (removed again in cleanup)")
    await cp.waitForTimeout(800)
  }
  await cp.getByText(/Week 1\b/).first().waitFor({ timeout: 10000 }).catch(async (e) => {
    await cp.screenshot({ path: `${RAW}/debug-client.png` })
    throw e
  })
  let html = await cp.content()
  check(`client HTML does NOT contain the week-2-only exercise "${names.week2}"`, !html.includes(names.week2))
  check(`control: client HTML DOES contain the week-1 exercise "${names.week1}"`, html.includes(names.week1))
  const w2inFlight = html.includes(names.week2.split(" ")[0] + " " + names.week2.split(" ")[1])
  beat(`(info) first two words of the week-2 name appear in HTML: ${w2inFlight}`)

  await shot(
    cp,
    "06-client-week-1",
    "What the client sees: their first week, ready to train",
    "Client area > Workouts",
    [
      [cp.getByText(/Week 1\b/).first(), "Week 1 is open. Their workouts are here.", "after"],
      [cp.getByRole("button", { name: "Next week" }), "Use the arrows to look at other weeks. A week that is not open shows its date instead.", "before"],
    ],
    "The client sees only the weeks you have opened. Week 1 is ready to train.",
  )

  await cp.getByRole("button", { name: "Next week" }).click()
  const unlocks = cp.getByText(/Week 2 unlocks on/)
  await unlocks.waitFor()
  check("client stepping to week 2 sees 'Week 2 unlocks on ...'", await unlocks.isVisible(), await unlocks.innerText())
  html = await cp.content()
  check("week-2 name still absent after stepping to week 2", !html.includes(names.week2))
  await shot(
    cp,
    "07-client-week-2-unlocks",
    "A week that is not out yet shows a date, not the workouts",
    "Client area > Workouts > the right arrow",
    [
      [unlocks, "Week 2 says the day it opens. No workouts are shown.", "textend"],
      [cp.getByText("Your coach opens one new week at a time."), "A short reason, and what to do: come back that day.", "textend"],
    ],
    "Week 2 is not out yet, so the client sees the date it opens instead of the workouts.",
  )

  await cp.getByRole("button", { name: "Next week" }).click()
  await cp.getByRole("button", { name: "Next week" }).click()
  const hidden = cp.getByText(/Week 4 isn't available yet/)
  await hidden.waitFor()
  check("client stepping to the hidden week 4 sees \"isn't available yet\"", await hidden.isVisible())

  // direct API calls as the client (cookie-bearing request context)
  const today = new Date().toLocaleDateString("en-CA")
  const post = (week) =>
    clientCtx.request.post(`${APP}/api/client/workouts/session`, {
      data: { assignment_id: created.assignmentId, week_number: week, day_of_week: 1, session_date: today },
    })
  const r1 = await post(1)
  check("direct POST /api/client/workouts/session week 1 returns 200", r1.status() === 200, `status ${r1.status()}`)
  const r2 = await post(2)
  check("direct POST /api/client/workouts/session week 2 returns 403", r2.status() === 403, `status ${r2.status()}`)

  // ===================== coach: Show now on week 2 =====================
  await go(ap, `/admin/programs/${created.copyProgramId}`)
  await ap.getByRole("button", { name: /Client week access/ }).click()
  await ap.getByRole("button", { name: /^W2\b/ }).click()
  await ap.getByRole("dialog").getByRole("button", { name: "Show now" }).click()
  await ap.getByRole("dialog").waitFor({ state: "hidden" })
  await ap.waitForTimeout(800)
  beat("coach clicked Show now on week 2 through the UI")
  const { data: wa } = await db.from("program_week_access").select("week_number,visibility").eq("assignment_id", created.assignmentId)
  beat(`week access rows: ${JSON.stringify(wa)}`)

  await go(cp, "/client/workouts")
  html = await cp.content()
  check(`after Show now, client HTML DOES contain the week-2 exercise "${names.week2}"`, html.includes(names.week2))
  const r3 = await post(2)
  check("after Show now, POST week 2 returns 200", r3.status() === 200, `status ${r3.status()}`)
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))

  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Program library and weekly release</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}figure{margin:32px 0}img{width:100%;border:1px solid #ddd;border-radius:8px}figcaption{margin-top:8px}</style></head><body>
<h1>Program library and weekly release</h1>
<p>Real app, development clone, light mode only (neither the admin nor the client area has a dark mode).</p>
${[...shots].sort((a, b) => a.file.localeCompare(b.file)).map((s) => `<figure><img src="${s.file}.png" alt="${s.title}"><figcaption><strong>${s.file.slice(0, 2)}.</strong> ${s.caption}</figcaption></figure>`).join("\n")}
</body></html>\n`,
  )
} finally {
  // ---- cleanup, by id, on the clone only ----
  try {
    if (browser) await browser.close()
  } catch {}
  const del = async (label, q) => {
    const { error } = await q
    beat(`cleanup ${label}: ${error ? "ERROR " + JSON.stringify(error) : "ok"}`)
  }
  try {
    const { data: stray } = await db
      .from("programs")
      .select("id")
      .like("name", `${LIB_NAME}%`)
      .gte("created_at", startedAt)
    const progIds = [...new Set([created.libraryProgramId, created.copyProgramId, ...(stray ?? []).map((p) => p.id)].filter(Boolean))]
    const { data: asgs } = progIds.length
      ? await db.from("program_assignments").select("id").in("program_id", progIds)
      : { data: [] }
    const asgIds = [...new Set([created.assignmentId, ...(asgs ?? []).map((a) => a.id)].filter(Boolean))]
    if (asgIds.length) {
      await del("workout_sessions", db.from("workout_sessions").delete().in("assignment_id", asgIds))
      await del("program_week_access", db.from("program_week_access").delete().in("assignment_id", asgIds))
      await del("program_assignments", db.from("program_assignments").delete().in("id", asgIds))
    }
    if (progIds.length) await del("user_consents", db.from("user_consents").delete().in("program_id", progIds))
    if (progIds.length) await del("programs", db.from("programs").delete().in("id", progIds))
    if (created.folderIds.length) await del("program_folders", db.from("program_folders").delete().in("id", created.folderIds))
    const left = await Promise.all([
      db.from("program_folders").select("id", { count: "exact", head: true }).in("name", [FOLDER_A, FOLDER_B]),
      progIds.length ? db.from("programs").select("id", { count: "exact", head: true }).in("id", progIds) : { count: 0 },
      asgIds.length ? db.from("program_assignments").select("id", { count: "exact", head: true }).in("id", asgIds) : { count: 0 },
    ])
    beat(`cleanup verified: folders left ${left[0].count}, programs left ${left[1].count}, assignments left ${left[2].count}`)
  } catch (e) {
    beat(`CLEANUP FAILED: ${e?.message ?? e}`)
  }
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ startedAt, app: APP, assertions, beats, shots: shots.map((s) => s.file) }, null, 2))
}
