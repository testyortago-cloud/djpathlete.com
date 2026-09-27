// Drives the REAL app on the DEV CLONE (http://localhost:3050) and photographs every
// screen the 2026-09-27 "owner's answers" build changed, burning the callouts into
// each PNG with scripts/_annotate-lib.mjs.
//
//   node --env-file=.env.local scripts/capture-lead-engine-owner-answers.mjs [shot-prefix ...]
//
// WRITES NOTHING DELIBERATE. It never presses Save, Submit, Send or a switch. The one
// unavoidable write is the quiz: answering its questions to reach the details gate
// records a quiz attempt on the dev clone, which is how the quiz itself works; the
// gate is never submitted. Row counts on the tables a submission would touch are
// compared before and after (see GUARDED).
//
// Refuses any database but the dev clone. Light only (the admin was never built for
// `.dark`; the public site has no dark theme). The pointer is parked before each shot.

import { mkdirSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { annotate } from "./_annotate-lib.mjs"

const APP = "http://localhost:3050"
const OUT = "screenshots/lead-engine-owner-answers"
const WIDTH = 1440
const DSF = 2
const PRIMARY = "00000000-0000-0000-0000-000000000001"
const DEV_REF = "anjvztjiokcgiyhobknq"

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`REFUSING: env points at ${ref}, not the dev clone ${DEV_REF}`)
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

mkdirSync(OUT, { recursive: true })
const only = process.argv.slice(2)
const t0 = Date.now()
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${s}`)
const manifest = []
const failures = []

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (existsSync(exe)) return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

const DEV_CHROME_CSS = `nextjs-portal { display: none !important; } html { scroll-behavior: auto !important; }`
async function hideChrome(page) {
  await page.addStyleTag({ content: DEV_CHROME_CSS }).catch(() => {})
  await page
    .evaluate(() => {
      for (const b of Array.from(document.querySelectorAll("button"))) {
        const s = getComputedStyle(b)
        if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none"
      }
    })
    .catch(() => {})
}
// An input's typed value is not a text node, so getByText cannot see it — the sequence
// editor shows every subject inside an <input>. Find the input whose value matches.
async function inputWithValue(page, value) {
  const inputs = page.locator("input")
  const i = await inputs.evaluateAll((els, v) => els.findIndex((e) => e.value === v), value)
  if (i < 0) throw new Error(`no input with value "${value}"`)
  return inputs.nth(i)
}
async function scrollToLocator(page, locator, offset = 90) {
  if ((await locator.count()) === 0) throw new Error("scroll target not found")
  await locator.first().evaluate((el, off) => {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, left: 0, behavior: "instant" })
  }, offset)
  await page.waitForTimeout(400)
}

// Positions come from the live element (CSS px, viewport-relative) × DSF. Text-range
// modes anchor to where the words are, not the element's box.
let seen = new Map()
async function mk(page, locator, caption, { place = "left", dx = 0, dy = 0, nth } = {}) {
  const n = await locator.count()
  if (n === 0) throw new Error(`MARKER TARGET NOT FOUND: "${caption.slice(0, 70)}"`)
  if (n > 1 && nth === undefined) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 60)}"`)
  const el = locator.nth(nth ?? 0)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET HAS NO BOX: "${caption.slice(0, 70)}"`)
  let cx, cy
  if (["textEnd", "textStart", "firstLineEnd", "blockEnd"].includes(place)) {
    const r = await el.evaluate((node, mode) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0)
      if (!rects.length) return null
      if (mode === "blockEnd") {
        return { x: Math.max(...rects.map((q) => q.right)), y: (Math.min(...rects.map((q) => q.top)) + Math.max(...rects.map((q) => q.bottom))) / 2 }
      }
      const q = mode === "textStart" || mode === "firstLineEnd" ? rects[0] : rects[rects.length - 1]
      return { x: mode === "textStart" ? q.left : q.right, y: q.top + q.height / 2 }
    }, place)
    if (!r) throw new Error(`MARKER TEXT HAS NO RANGE: "${caption.slice(0, 70)}"`)
    cx = place === "textStart" ? r.x - 24 : r.x + 24
    cy = r.y
  } else {
    cy = box.y + box.height / 2
    cx = place === "center" ? box.x + box.width / 2
      : place === "right" ? box.x + box.width - 24
      : place === "after" ? box.x + box.width + 24
      : place === "inset" ? box.x + 26
      : place === "above" || place === "below" ? box.x + box.width / 2
      : box.x - 24
    if (place === "above") cy = box.y - 22
    if (place === "below") cy = box.y + box.height + 22
  }
  const id = `${Math.round(cx + dx)},${Math.round(cy + dy)}`
  if (seen.has(id)) console.warn(`  !! TWO MARKERS AT THE SAME SPOT: "${seen.get(id).slice(0, 40)}" / "${caption.slice(0, 40)}"`)
  seen.set(id, caption)
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption, _el: el, _box: box }
}
async function capture(page, name, title, subtitle, markers) {
  await hideChrome(page)
  await page.mouse.move(4, 4)
  await page.waitForTimeout(350)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage: false })
  for (const m of markers) {
    const now = await m._el.boundingBox().catch(() => null)
    if (!now || Math.abs(now.x - m._box.x) > 4 || Math.abs(now.y - m._box.y) > 4) throw new Error(`MARKER TARGET MOVED: "${m.caption.slice(0, 60)}"`)
  }
  const clean = markers.map(({ x, y, caption }) => ({ x, y, caption }))
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers: clean })
  manifest.push({ name, title, subtitle, captions: clean.map((m) => m.caption) })
  log(`  ${name}.png ${r.width}x${r.height}, ${clean.length} callouts`)
  seen = new Map()
}

const GUARDED = ["contacts", "contact_consents", "sequence_runs", "funnel_submissions", "lead_inquiries", "sequences", "sequence_steps"]
async function guardCounts() {
  const out = {}
  for (const t of GUARDED) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true })
    if (error) throw new Error(`count ${t}: ${error.message}`)
    out[t] = count
  }
  return out
}

const DEV = "Shown on the development copy with test people — not your live numbers."
const shots = []
const shot = (name, fn) => shots.push({ name, fn })

// ================= THE CHAT FOLLOW-UP
shot("01-chat-follow-up-on-the-list", async ({ admin }) => {
  const page = await admin(1000)
  await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)
  const row = page.getByRole("row", { name: /Chat Lead Follow-Up/ })
  await scrollToLocator(page, row, 300)
  await capture(page, "01-chat-follow-up-on-the-list", "New: Chat Lead Follow-Up, waiting for you to switch it on", `Sidebar → Coaching → Sequences. ${DEV}`, [
    await mk(page, row.getByText("Chat Lead Follow-Up", { exact: true }), "The new follow-up for people who leave their details in the website chat. Click the name to read it.", { place: "textEnd" }),
    await mk(page, row.getByRole("switch"), "It starts switched OFF, so nothing is sent until you have read it. Flip this and confirm to turn it on.", { place: "left", dx: -2 }),
  ])
})

shot("02-chat-follow-up-steps", async ({ admin }) => {
  const page = await admin(1000)
  await page.goto(`${APP}/admin/sequences/chat_lead_follow_up`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)
  await scrollToLocator(page, page.getByRole("heading", { name: "Step 1", exact: true }), 140)
  await capture(page, "02-chat-follow-up-steps", "What the chat follow-up sends", `Sequences → Chat Lead Follow-Up. An email straight away, another two days later, then a text (only to people who agreed to texts). ${DEV}`, [
    await mk(page, await inputWithValue(page, "Your question reached us"), "Straight away: their question reached a real person, who will get back to them.", { place: "inset", dx: 330 }),
    await mk(page, page.getByText("What this step does").nth(1), "Then a two-day wait before the next email.", { place: "textEnd" }),
  ])
})

shot("03-camp-countdown-four-reminders", async ({ admin }) => {
  const page = await admin(1500)
  await page.goto(`${APP}/admin/sequences/camp_clinic_deadline`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)
  await scrollToLocator(page, await inputWithValue(page, "Three days to go"), 160)
  await capture(page, "03-camp-countdown-four-reminders", "Camp reminders now go 14, 7, 3 and 1 day before", `Sequences → Camp or clinic deadline. The "Last one about this" email you approved is still the last, now 1 day before. ${DEV}`, [
    await mk(page, await inputWithValue(page, "Three days to go"), "New: \"Three days to go\", three days before the camp.", { place: "inset", dx: 250 }),
    await mk(page, await inputWithValue(page, "Last one about this"), "Your approved last email, moved to 1 day before.", { place: "inset", dx: 250 }),
  ])
})

// ================= THE EMAIL-PERMISSION TICK
shot("04-funnel-form-email-tick", async ({ visitor }) => {
  const page = await visitor(1000)
  await page.goto(`${APP}/go/off-season-speed-camp-rx0f`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  const tick = page.locator('input[name="email_consent"]').first()
  await scrollToLocator(page, tick, 360)
  await capture(page, "04-funnel-form-email-tick", "Funnel forms: a new box to agree to emails", "A published funnel page, as a visitor sees it. The box starts unticked.", [
    await mk(page, page.getByText(/can email me training tips, news and offers/).first(), "New: ticking this records their permission to email, with these exact words and the date.", { place: "blockEnd" }),
    await mk(page, page.locator('input[name="sms_consent"]').first(), "The text-message box that was already here.", { place: "left" }),
  ])
})

shot("05-quiz-gate-email-tick", async ({ visitor }) => {
  const page = await visitor(1000)
  await page.goto(`${APP}/go/athlete-quiz`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
  await page.locator(".djp-quiz-nav button.djp-btn-primary").first().click()
  for (let i = 0; i < 40; i++) {
    if (await page.locator("#djp-quiz-email").isVisible().catch(() => false)) break
    await page.locator("button.djp-quiz-option").first().click()
    await page.waitForTimeout(450)
  }
  if (!(await page.locator("#djp-quiz-email").isVisible())) throw new Error("never reached the quiz details gate")
  await scrollToLocator(page, page.locator("#djp-quiz-email"), 300)
  await capture(page, "05-quiz-gate-email-tick", "The Athlete Quiz: the same box before their result", "The quiz's last page, where they leave their details. Answering the questions to get here is all the script did; nothing was submitted.", [
    await mk(page, page.getByText(/can email me training tips, news and offers/).first(), "New: agree to emails, unticked until they tick it.", { place: "blockEnd" }),
  ])
})

shot("06-application-form-email-tick", async ({ visitor }) => {
  const page = await visitor(1000)
  await page.goto(`${APP}/online`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  await scrollToLocator(page, page.getByRole("heading", { name: "Apply for Online Coaching" }), 120)
  await page.waitForTimeout(2500)
  await capture(page, "06-application-form-email-tick", "The coaching application form: the same box", "e.g. /online → \"Apply for coaching\". Every service page's application form, and Step Up's, has it.", [
    await mk(page, page.getByText(/can email me training tips, news and offers/).first(), "New: agree to emails. Recorded with the exact words and the date, like the text box below it.", { place: "firstLineEnd" }),
  ])
})

// ================= ADMIN FIXES
shot("07-sending-hours-labels", async ({ admin }) => {
  const page = await admin(1000)
  await page.goto(`${APP}/admin/businesses/${PRIMARY}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)
  await scrollToLocator(page, page.getByText("Timing", { exact: true }), 100)
  await capture(page, "07-sending-hours-labels", "Business settings: the sending hours now say what they do", `The two boxes used to be called "Quiet hours" and the hint said the opposite of what the app does. ${DEV}`, [
    await mk(page, page.getByLabel("Start sending at"), "\"Start sending at\": the earliest hour follow-ups go out.", { place: "inset", dx: 250 }),
    await mk(page, page.getByLabel("Stop sending at"), "\"Stop sending at\": nothing goes out from this hour until the next morning.", { place: "inset", dx: 250 }),
    await mk(page, page.getByText(/8 and 21 means 8am until 9pm/), "The hint now gives an example you can check against.", { place: "firstLineEnd" }),
  ])
})

shot("08-sidebar-campaign-revenue", async ({ admin }) => {
  const page = await admin(1000)
  await page.goto(`${APP}/admin/dashboard`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  const toggle = page.getByRole("button", { name: "Business", exact: true }).first()
  await toggle.click()
  await page.waitForTimeout(600)
  const link = page.getByRole("link", { name: "Campaign Revenue" }).first()
  await link.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }))
  await page.waitForTimeout(400)
  await capture(page, "08-sidebar-campaign-revenue", "Campaign Revenue is now in the sidebar", "Sidebar → Business → Campaign Revenue. Before, it could only be found through Search.", [
    await mk(page, link.getByText("Campaign Revenue", { exact: true }), "Which ads and posts brought in leads and money.", { place: "textEnd" }),
  ])
})

shot("09-settings-business-link", async ({ admin }) => {
  const page = await admin(1000)
  await page.goto(`${APP}/admin/settings`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)
  const link = page.getByRole("link", { name: /Business Settings/ })
  await scrollToLocator(page, link, 300)
  await capture(page, "09-settings-business-link", "Business settings can now be reached from Settings", "Settings → Configuration → Business Settings. Before, the only way in was typing the address.", [
    await mk(page, link.getByText("Business Settings", { exact: true }), "Opens your business settings: name, sender, sending hours, texts.", { place: "textEnd" }),
  ])
})

async function main() {
  const browser = await launchChromium()
  const before = await guardCounts()
  log(`guarded counts before: ${JSON.stringify(before)}`)
  const adminCtx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
  {
    const p = await adminCtx.newPage()
    await p.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
    await p.waitForTimeout(2000)
    await adminCtx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])
    const s = await (await p.goto(`${APP}/api/auth/session`)).text()
    if (!s.includes('"role":"admin"')) throw new Error(`no admin session: ${s.slice(0, 200)}`)
    await p.close()
  }
  const visitorCtx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
  const open = (ctx) => async (h) => {
    const page = await ctx.newPage()
    await page.setViewportSize({ width: WIDTH, height: h })
    page.on("pageerror", (e) => console.warn(`  !! page error: ${String(e).slice(0, 160)}`))
    return page
  }
  const env = { admin: open(adminCtx), visitor: open(visitorCtx) }
  for (const s of shots) {
    if (only.length && !only.some((p) => s.name.startsWith(p))) continue
    log(s.name)
    try {
      await s.fn(env)
      const check = await adminCtx.request.get(`${APP}/api/auth/session`)
      if (!(await check.text()).includes('"role":"admin"')) throw new Error("admin session lost")
    } catch (err) {
      failures.push({ name: s.name, error: String(err).split("\n")[0] })
      console.error(`  !! FAILED ${s.name}: ${String(err).split("\n")[0]}`)
    } finally {
      for (const p of [...adminCtx.pages(), ...visitorCtx.pages()]) await p.close().catch(() => {})
      seen = new Map()
    }
  }
  await browser.close()
  const after = await guardCounts()
  log(`guarded counts after:  ${JSON.stringify(after)}`)
  const changed = GUARDED.filter((t) => before[t] !== after[t])
  if (changed.length) console.error(`  !! ROW COUNTS CHANGED: ${changed.join(", ")}`)
  writeFileSync(`${OUT}/.manifest.json`, JSON.stringify({ capturedAt: new Date().toISOString(), shots: manifest, failures, before, after }, null, 2))
  log(`done: ${manifest.length} shots, ${failures.length} failed`)
  if (failures.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
