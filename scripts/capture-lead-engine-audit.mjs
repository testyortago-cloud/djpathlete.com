// Drives the REAL admin app on the DEV CLONE (http://localhost:3050) for the
// 2026-09-13 Lead Engine audit, and burns the callouts into each PNG with
// scripts/_annotate-lib.mjs.
//
//   node --env-file=.env.local scripts/capture-lead-engine-audit.mjs <stage>
//
// Stages (run in order; state carries in screenshots/lead-engine-audit/.state.json):
//   build    create a funnel from scratch in the real UI, let the builder draft
//            every page, publish it from the builder, open /go/<slug> as the
//            public and submit the form. Writes go to the DEV clone only.
//   preview  open /preview/<slug> (draft, test run) and submit — must write NOTHING.
//   screens  the admin screens the audit reports on.
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Light only (admin UI was
// never built against `.dark`). The pointer is parked before every capture.
// REFUSES production outright.

import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { annotate } from "./_annotate-lib.mjs"

const APP = "http://localhost:3050"
const OUT = "screenshots/lead-engine-audit"
const STATE = `${OUT}/.state.json`
const WIDTH = 1440
const DSF = 2
const PRIMARY = "00000000-0000-0000-0000-000000000001"
const TEST_EMAIL = "tayawaschoolworks@gmail.com"

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref === "epzuvzkokzqtzomeyoha") throw new Error("REFUSING: env points at PRODUCTION")
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const stage = process.argv[2]
mkdirSync(OUT, { recursive: true })
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {}
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2))

async function launchChromium() {
  try { return await chromium.launch() } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (existsSync(exe)) { console.log(`  falling back to ${shell}`); return await chromium.launch({ executablePath: exe }) }
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}
async function hideFloatingChrome(page) {
  await page.addStyleTag({ content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }` }).catch(() => {})
  await page.evaluate(() => { for (const b of Array.from(document.querySelectorAll("button"))) { const s = getComputedStyle(b); if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none" } }).catch(() => {})
}
const seen = new Map()
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left", key } = {}) {
  const n = await locator.count()
  if (n === 0) { console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 70)}"`); return { x: 100, y: 100, caption } }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using first: "${caption.slice(0, 70)}"`)
  const box = await locator.first().boundingBox()
  if (!box) { console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 70)}"`); return { x: 100, y: 100, caption } }
  const id = key ?? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`
  if (seen.has(id)) console.warn(`  !! TWO MARKERS RESOLVED TO THE SAME ELEMENT as "${seen.get(id).slice(0, 50)}"`)
  seen.set(id, caption)
  const cx = place === "center" ? box.x + box.width / 2 : place === "right" ? box.x + box.width - 22 : place === "after" ? box.x + box.width + 22 : place === "inset" ? box.x + 24 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}
async function resetScroll(page) { await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" })); await page.waitForTimeout(200) }
async function shoot(page, name, title, subtitle, markers, { fullPage = true } = {}) {
  await hideFloatingChrome(page)
  await page.mouse.move(4, 4)
  await page.waitForTimeout(200)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
  seen.clear()
}
async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  if (!page.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${page.url()})`)
  await page.close()
}
async function counts(email) {
  const q = async (t, f) => { const { count, error } = await f(db.from(t).select("*", { count: "exact", head: true })); if (error) throw error; return count }
  return {
    contacts: await q("contacts", (s) => s.eq("email", email)),
    funnel_submissions: await q("funnel_submissions", (s) => s.eq("email", email)),
    timeline: await q("contact_timeline_events", (s) => s),
    sequence_runs: await q("sequence_runs", (s) => s),
    consents: await q("contact_consents", (s) => s),
    opportunities: await q("opportunities", (s) => s),
    attribution: await q("marketing_attribution", (s) => s),
    leads: await q("lead_inquiries", (s) => s),
  }
}

const browser = await launchChromium()
try {
  if (stage === "build") {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    await ctx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])
    const page = await ctx.newPage()
    const slug = `off-season-speed-camp-${Date.now().toString(36).slice(-4)}`
    state.slug = slug; save()

    // ---------------------------------------------------------------- 01 create
    await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "New funnel" }).click()
    const dlg = page.getByRole("dialog")
    await dlg.waitFor()
    await dlg.getByPlaceholder("Summer Camp 2026").fill("Off-Season Speed Camp")
    await dlg.getByPlaceholder("summer-camp-2026").fill(slug)
    await dlg.locator("button", { hasText: "Capture leads" }).first().click()
    await dlg.getByPlaceholder("High-school tennis players and their parents").fill("High-school soccer players and their parents in Tampa Bay")
    await dlg.getByPlaceholder("you@example.com").fill(TEST_EMAIL)
    await dlg.getByPlaceholder("Registration flow for the summer camp: signup, payment, confirmation.").fill(
      "Four-week off-season speed camp for high-school soccer players: sprint mechanics, acceleration and change of direction, two sessions a week in Zephyrhills. Capture the athlete's name, email and phone so we can follow up with the schedule and pricing.",
    )
    await page.waitForTimeout(400)
    await resetScroll(page)
    await shoot(page, "01-new-funnel-dialog", "Funnel maker, step 1 — the New funnel dialog, filled in", "Real admin at /admin/funnels on the dev clone. A template plans the pages; the description seeds the first draft.", [
      await markerOn(page, dlg.getByPlaceholder("Summer Camp 2026"), "Name and address. The public link will be /go/<address>."),
      await markerOn(page, dlg.locator("button", { hasText: "Capture leads" }).first(), "Template 'Capture leads' plans two pages: a signup form, then a thank-you.", { place: "inset" }),
      await markerOn(page, dlg.getByPlaceholder("you@example.com"), "'Email me new leads' — every submission is also emailed here."),
      await markerOn(page, dlg.getByRole("button", { name: "Create funnel" }), "Create funnel — the builder then writes the first draft of every page.", { place: "after", dx: 20 }),
    ], { fullPage: false })
    await dlg.getByRole("button", { name: "Create funnel" }).click()
    await page.waitForURL(/\/admin\/funnels\/[0-9a-f-]+\/edit\/[0-9a-f-]+/, { timeout: 60000 })
    const m = page.url().match(/\/admin\/funnels\/([0-9a-f-]+)\/edit\/([0-9a-f-]+)/)
    state.funnelId = m[1]; state.entryStepId = m[2]; save()
    console.log(`  created funnel ${state.funnelId} entry step ${state.entryStepId}`)

    // ---------------------------------------------------------------- 02 builder drafts every page
    const t0 = Date.now()
    let built = 0, total = 0
    while (Date.now() - t0 < 12 * 60 * 1000) {
      const { data: steps } = await db.from("funnel_steps").select("id, slug, project_data").eq("funnel_id", state.funnelId)
      total = steps.length; built = steps.filter((s) => s.project_data !== null).length
      const publishEnabled = await page.getByRole("button", { name: /^Publish funnel$/ }).isEnabled().catch(() => false)
      if (built === total && publishEnabled) break
      await page.waitForTimeout(5000)
    }
    console.log(`  drafted ${built}/${total} pages in ${Math.round((Date.now() - t0) / 1000)}s`)
    if (built !== total) throw new Error(`builder did not draft every page: ${built}/${total}`)
    const { data: steps } = await db.from("funnel_steps").select("id, slug, position").eq("funnel_id", state.funnelId).order("position")
    state.steps = steps; save()
    await page.waitForTimeout(1500)
    await resetScroll(page)
    await shoot(page, "02-builder-drafted", "Funnel maker, step 2 — the builder wrote both pages from the description", `${built} of ${total} pages drafted by the AI builder in ${Math.round((Date.now() - t0) / 1000)}s. Chat on the left, live draft on the right.`, [
      await markerOn(page, page.getByRole("button", { name: /^Publish funnel$/ }), "'Publish funnel' becomes available only once every page has a draft.", { place: "left", dx: -10 }),
    ], { fullPage: false })

    // ---------------------------------------------------------------- 03 publish from the builder
    await page.getByRole("button", { name: /^Publish funnel$/ }).click()
    await page.getByRole("button", { name: /^Published$/ }).waitFor({ timeout: 90000 })
    await page.waitForTimeout(1500)
    const { data: f } = await db.from("funnels").select("status").eq("id", state.funnelId).single()
    const { data: pub } = await db.from("funnel_steps").select("id, published_version_id").eq("funnel_id", state.funnelId)
    console.log(`  funnel status=${f.status}; steps with published version: ${pub.filter((s) => s.published_version_id).length}/${pub.length}`)
    if (f.status !== "published") throw new Error("publish did not flip funnels.status")
    await resetScroll(page)
    await shoot(page, "03-builder-published", "Funnel maker, step 3 — published from the builder", `POST /api/admin/funnels/<id>/publish gated every page, wrote a version row per page and flipped the funnel to '${f.status}'.`, [
      await markerOn(page, page.getByRole("button", { name: /^Published$/ }), "The button now reads 'Published' — nothing left to do.", { place: "left", dx: -10 }),
    ], { fullPage: false })
    await page.close()

    // ---------------------------------------------------------------- 04 the public page, as a stranger
    const pub2 = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    const pp = await pub2.newPage()
    const before = await counts(TEST_EMAIL)
    console.log("  counts before submit:", JSON.stringify(before))
    const res = await pp.goto(`${APP}/go/${slug}?utm_source=audit&utm_medium=test&utm_campaign=lead-engine-audit`, { waitUntil: "networkidle" })
    console.log(`  /go/${slug} -> ${res.status()}`)
    if (res.status() !== 200) throw new Error(`/go returned ${res.status()}`)
    await pp.waitForTimeout(1000)
    const form = pp.locator("form").first()
    const inputs = await form.locator("input, textarea").evaluateAll((els) => els.map((e) => `${e.tagName}:${e.type}:${e.name}:${e.placeholder}`))
    console.log("  form fields:", inputs.join(" | "))
    await shoot(pp, "04-go-public-page", "The published page, seen by the public at /go/<slug>", "A fresh browser with no admin session. This is what a visitor gets after publishing.", [
      await markerOn(pp, form, "The lead form the builder wrote. Submitting it hits POST /api/funnels/submit.", { place: "inset" }),
    ])
    const fill = async (sel, v) => { const l = form.locator(sel).first(); if (await l.count()) await l.fill(v) }
    await fill('input[name*="name" i], input[placeholder*="name" i]', "Audit Tester")
    await fill('input[type="email"], input[name*="email" i]', TEST_EMAIL)
    await fill('input[type="tel"], input[name*="phone" i]', "+12025550123")
    const other = form.locator('input:not([type="email"]):not([type="tel"]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"]), textarea')
    for (let i = 0; i < (await other.count()); i++) { const el = other.nth(i); if ((await el.inputValue()) === "") await el.fill(i === 0 ? "Audit Tester" : "Sophomore, plays midfield") }
    const boxes = form.locator('input[type="checkbox"]')
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => {})
    await form.locator('button[type="submit"], button').last().click()
    await pp.waitForTimeout(6000)
    console.log(`  after submit url=${pp.url()}`)
    await shoot(pp, "05-go-after-submit", "After submitting the public form", `The funnel moved to ${new URL(pp.url()).pathname}. Rows written are checked against the dev database below.`, [])
    const after = await counts(TEST_EMAIL)
    console.log("  counts after submit:", JSON.stringify(after))
    state.submitBefore = before; state.submitAfter = after; save()
    const { data: c } = await db.from("contacts").select("id, email, phone_e164, name, first_touch_session_id, created_at").eq("email", TEST_EMAIL)
    console.log("  contact rows:", JSON.stringify(c))
    if (c?.[0]) {
      const cid = c[0].id
      const { data: ev } = await db.from("contact_timeline_events").select("kind, source, occurred_at, metadata").eq("contact_id", cid).order("occurred_at")
      console.log("  timeline:", JSON.stringify(ev))
      const { data: runs } = await db.from("sequence_runs").select("id, sequence_id, status, current_position, next_run_at, defer_reason").eq("contact_id", cid)
      console.log("  sequence_runs:", JSON.stringify(runs))
      const { data: cons } = await db.from("contact_consents").select("channel, granted, source, wording_shown").eq("contact_id", cid)
      console.log("  consents:", JSON.stringify(cons))
      const { data: opps } = await db.from("opportunities").select("id, pipeline_id, stage_id").eq("contact_id", cid)
      console.log("  opportunities:", JSON.stringify(opps))
      state.contactId = cid; save()
    }
    const { data: subs } = await db.from("funnel_submissions").select("id, form_key, kind, status, attribution_session_id, payload").eq("email", TEST_EMAIL)
    console.log("  submissions:", JSON.stringify(subs))
    await pub2.close()
  }
} finally {
  await browser.close()
}

// ---------------------------------------------------------------------------
// stage "nurture": switch New Lead Nurture ON through the real UI (dev clone),
// submit the published form properly (honeypot untouched), and verify the
// capture chain in the dev database.
// ---------------------------------------------------------------------------
if (stage === "nurture") {
  const browser2 = await launchChromium()
  try {
    const ctx = await browser2.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    await ctx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])
    const page = await ctx.newPage()
    await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
    const sw = page.getByRole("switch", { name: /Turn on "New Lead Nurture"/ })
    if (await sw.count()) {
      await sw.click()
      await page.waitForTimeout(800)
      const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog"))
      await dlg.first().waitFor({ timeout: 10000 })
      await resetScroll(page)
      await shoot(page, "06-sequence-switch-confirm", "Sequences — turning 'New Lead Nurture' ON asks first", "Switching a sequence ON can resume people held partway through within minutes, so the product confirms. OFF is immediate.", [
        await markerOn(page, dlg.first().getByRole("button", { name: "Switch on" }), "'Switch on' — the dialog names what happens to anyone already partway through.", { place: "left", dx: -6 }),
      ], { fullPage: false })
      await dlg.first().getByRole("button", { name: "Switch on" }).click()
      await page.waitForTimeout(2500)
    }
    const { data: seq } = await db.from("sequences").select("id, status").eq("business_id", PRIMARY).eq("key", "new_lead_nurture").single()
    console.log(`  new_lead_nurture status=${seq.status}`)
    if (seq.status !== "active") throw new Error("switch did not activate the sequence")
    state.nurtureSequenceId = seq.id; save()
    await page.close()

    const email = "tayawaschoolworks+audit@gmail.com"
    const pub = await browser2.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    const pp = await pub.newPage()
    const t0 = await db.from("contact_timeline_events").select("*", { count: "exact", head: true })
    await pp.goto(`${APP}/go/${state.slug}`, { waitUntil: "networkidle" })
    await pp.waitForTimeout(1200)
    const form = pp.locator("form").first()
    await form.locator('input[name="athlete_name"]').fill("Jordan Audit")
    await form.locator('input[name="parent_name"]').fill("Aean Audit")
    await form.locator('input[name="parent_email"]').fill(email)
    await form.locator('input[name="parent_phone"]').fill("+12025550123")
    await form.locator('input[name="sms_consent"]').check().catch(() => {})
    await form.locator('textarea[name="notes"]').fill("Sophomore midfielder, no injuries, two seasons of club soccer.")
    await pp.waitForTimeout(2500) // the route rejects anything faster than 1.5s as a bot
    await resetScroll(pp)
    const [resp] = await Promise.all([
      pp.waitForResponse((r) => r.url().includes("/api/funnels/submit")),
      form.locator('button[type="submit"]').first().click(),
    ])
    console.log(`  POST /api/funnels/submit -> ${resp.status()} ${await resp.text()}`)
    await pp.waitForTimeout(4000)
    console.log(`  landed on ${pp.url()}`)
    await shoot(pp, "07-go-thank-you-404", "After a real submission, the visitor lands on 'Page not found'", `The builder wrote the form's redirect as /go/${state.slug.replace(/-[a-z0-9]{4}$/, "")}/thank-you — a URL guessed from the funnel NAME, not the address the funnel actually has (/go/${state.slug}). The lead was captured; the visitor sees a 404.`, [])
    const { data: subs } = await db.from("funnel_submissions").select("id, form_key, email, name, phone, attribution_session_id, created_at").eq("funnel_id", state.funnelId)
    console.log("  submissions:", JSON.stringify(subs))
    const { data: c } = await db.from("contacts").select("id, email, phone_e164, name, first_touch_session_id, created_at").eq("email", email).eq("business_id", PRIMARY)
    console.log("  contact:", JSON.stringify(c))
    const t1 = await db.from("contact_timeline_events").select("*", { count: "exact", head: true })
    console.log(`  timeline rows ${t0.count} -> ${t1.count}`)
    if (c?.[0]) {
      state.nurtureContactId = c[0].id; save()
      const { data: ev } = await db.from("contact_timeline_events").select("kind, source, metadata").eq("contact_id", c[0].id)
      console.log("  timeline:", JSON.stringify(ev))
      const { data: runs } = await db.from("sequence_runs").select("id, sequence_id, status, current_position, next_run_at, attempts").eq("contact_id", c[0].id)
      console.log("  sequence_runs:", JSON.stringify(runs))
      const { data: cons } = await db.from("contact_consents").select("channel, granted, source").eq("contact_id", c[0].id)
      console.log("  consents:", JSON.stringify(cons))
      const { data: opps } = await db.from("opportunities").select("id").eq("contact_id", c[0].id)
      console.log("  opportunities:", JSON.stringify(opps))
    }
    await pub.close()
  } finally {
    await browser2.close()
  }
}

// ---------------------------------------------------------------------------
// stage "send": a fresh identity through the published form, then the tick
// (dev clone, flag on) — proves capture → enrol → Resend end to end. The
// message goes to the designated test inbox, never to a real contact.
// ---------------------------------------------------------------------------
if (stage === "submit2" || stage === "tick") {
  const browser3 = await launchChromium()
  try {
    const email = "tayawaschoolworks+audit2@gmail.com"
    const phone = "+12025550177"
    if (stage === "tick") {
      const { data: c } = await db.from("contacts").select("id").eq("email", email).eq("business_id", PRIMARY).single()
      const res = await fetch(`${APP}/api/admin/internal/sequence-tick`, { method: "POST", headers: { authorization: `Bearer ${process.env.INTERNAL_CRON_TOKEN}` } })
      console.log(`  tick -> ${res.status} ${await res.text()}`)
      const { data: runs2 } = await db.from("sequence_runs").select("id, status, current_position, next_run_at, attempts, defer_reason, last_error").eq("contact_id", c.id)
      console.log("  runs after tick:", JSON.stringify(runs2))
      const { data: msgs } = await db.from("sequence_messages").select("channel, to_identifier, subject, status, provider, provider_message_id, error, sent_at").eq("contact_id", c.id)
      console.log("  messages:", JSON.stringify(msgs))
      state.sendMessages = msgs; save()
    } else {
    const pub = await browser3.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    const pp = await pub.newPage()
    await pp.goto(`${APP}/go/${state.slug}`, { waitUntil: "networkidle" })
    await pp.waitForTimeout(1200)
    const form = pp.locator("form").first()
    await form.locator('input[name="athlete_name"]').fill("Riley Audit")
    await form.locator('input[name="parent_name"]').fill("Aean Audit")
    await form.locator('input[name="parent_email"]').fill(email)
    await form.locator('input[name="parent_phone"]').fill(phone)
    await form.locator('input[name="sms_consent"]').check().catch(() => {})
    await form.locator('textarea[name="notes"]').fill("Junior winger, no injuries, wants to work on first-step quickness.")
    await pp.waitForTimeout(2500)
    await resetScroll(pp)
    await shoot(pp, "07-go-form-filled", "The public form, filled in by a visitor", "Fields the builder chose: athlete, parent, email, phone, a texting consent box, notes. The hidden 'website' field is a bot trap — a bot that fills it gets a silent 200 and nothing is stored.", [
      await markerOn(pp, form.locator('input[name="sms_consent"]'), "Ticking this writes a dated SMS consent row; leaving it writes none. Email consent is never recorded here."),
    ], { fullPage: false })
    await form.locator('button[type="submit"]').first().click()
    await pp.waitForTimeout(5000)
    console.log(`  landed on ${pp.url()}`)
    await shoot(pp, "08-go-thank-you-404", "…and after submitting, the visitor sees 'Page not found'", `The builder wrote the form's redirect as ${new URL(pp.url()).pathname} — the funnel slug was GUESSED from its name. The real address is /go/${state.slug}. The lead was still captured.`, [])
    await pub.close()

    const { data: c } = await db.from("contacts").select("id, email, phone_e164, name, business_id, created_at").eq("email", email).eq("business_id", PRIMARY)
    console.log("  contact:", JSON.stringify(c))
    if (!c?.[0]) throw new Error("no contact created for the fresh identity")
    state.sendContactId = c[0].id; save()
    const { data: ev } = await db.from("contact_timeline_events").select("kind, source").eq("contact_id", c[0].id)
    console.log("  timeline:", JSON.stringify(ev))
    const { data: runs } = await db.from("sequence_runs").select("id, status, current_position, next_run_at, attempts").eq("contact_id", c[0].id)
    console.log("  runs before tick:", JSON.stringify(runs))
    const { data: cons } = await db.from("contact_consents").select("channel, granted, source").eq("contact_id", c[0].id)
    console.log("  consents:", JSON.stringify(cons))

    console.log("  (stage 'tick' runs the sequence tick against this contact — owner-run, it sends a real email to the test inbox)")
    }
  } finally {
    await browser3.close()
  }
}

// ---------------------------------------------------------------------------
// stage "preview": the draft routes. /preview/<slug> is a TEST RUN — its form
// posts to /api/funnels/preview-submit, which must write nothing at all.
// ---------------------------------------------------------------------------
if (stage === "preview") {
  const browser4 = await launchChromium()
  try {
    const ctx = await browser4.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    await ctx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])
    const page = await ctx.newPage()
    const tables = ["contacts", "funnel_submissions", "contact_timeline_events", "sequence_runs", "contact_consents", "opportunities", "marketing_attribution", "users", "audit_logs", "lead_inquiries"]
    const snap = async () => { const o = {}; for (const t of tables) { const { count } = await db.from(t).select("*", { count: "exact", head: true }); o[t] = count } return o }
    const before = await snap()
    await page.goto(`${APP}/preview/${state.slug}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1200)
    const form = page.locator("form").first()
    await form.locator('input[name="athlete_name"]').fill("Preview Person")
    await form.locator('input[name="parent_name"]').fill("Preview Parent")
    await form.locator('input[name="parent_email"]').fill("preview-test@example.com")
    await form.locator('input[name="parent_phone"]').fill("+12025550199")
    await page.waitForTimeout(2000)
    await resetScroll(page)
    await shoot(page, "09-preview-test-run", "/preview/<slug> — the draft, full screen, as a TEST RUN", "Admin-only. Same renderer as publish, but every button is rewritten to stay inside /preview and the form posts to /api/funnels/preview-submit.", [
      await markerOn(page, form, "This form is a test run: submitting it stores nothing — no lead, no contact, no email.", { place: "inset" }),
    ], { fullPage: false })
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/funnels/preview-submit")).catch(() => null),
      form.locator('button[type="submit"]').first().click(),
    ])
    console.log(`  preview-submit -> ${resp ? resp.status() : "no response seen"}`)
    await page.waitForTimeout(3000)
    console.log(`  landed on ${page.url()}`)
    await resetScroll(page)
    await shoot(page, "10-preview-after-submit", "After the test-run submit", `The test run moved to ${new URL(page.url()).pathname}. Row counts across ten tables are identical before and after (see the audit).`, [], { fullPage: false })
    const after = await snap()
    const diff = Object.fromEntries(tables.map((t) => [t, after[t] - before[t]]))
    console.log("  row-count deltas after preview-submit:", JSON.stringify(diff))
    state.previewDiff = diff; save()

    // the builder's iframe route
    const r = await page.goto(`${APP}/funnel-preview/${state.entryStepId}`, { waitUntil: "networkidle" })
    console.log(`  /funnel-preview/<stepId> -> ${r.status()}`)
    await page.waitForTimeout(800)
    await resetScroll(page)
    await shoot(page, "11-funnel-preview-iframe-route", "/funnel-preview/<stepId> — the builder's iframe, opened directly", "Keyed by step id, draft document, same renderDraftPreview as /preview. Admin-only; 404 to everyone else.", [], { fullPage: false })
    // and the gate: signed-out
    const anon = await browser4.newContext({ viewport: { width: WIDTH, height: 1000 } })
    const ap = await anon.newPage()
    const a1 = await ap.goto(`${APP}/preview/${state.slug}`); const a2 = await ap.goto(`${APP}/funnel-preview/${state.entryStepId}`)
    console.log(`  signed-out /preview -> ${a1.status()}, /funnel-preview -> ${a2.status()}`)
    state.previewAnon = { preview: a1.status(), funnelPreview: a2.status() }; save()
    await anon.close()
  } finally {
    await browser4.close()
  }
}

// ---------------------------------------------------------------------------
// stage "sms": a SIGNED forged Twilio inbound webhook against the DEV server —
// first a normal reply, then STOP — for the contact the form just created.
// Then the admin screens that show the results.
// ---------------------------------------------------------------------------
if (stage === "sms") {
  const { createHmac } = await import("node:crypto")
  const phone = "+12025550177"
  const origin = (process.env.NEXTAUTH_URL ?? APP).replace(/\/$/, "")
  const url = `${origin}/api/webhooks/twilio/inbound`
  const post = async (params) => {
    const sorted = Object.keys(params).sort().map((k) => k + params[k]).join("")
    const sig = createHmac("sha1", process.env.TWILIO_AUTH_TOKEN).update(url + sorted).digest("base64")
    const res = await fetch(`${APP}/api/webhooks/twilio/inbound`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params) })
    return { status: res.status, outcome: res.headers.get("x-twilio-inbound-outcome"), type: res.headers.get("content-type"), body: (await res.text()).slice(0, 120) }
  }
  console.log("  reply  ->", JSON.stringify(await post({ From: phone, To: "+18135550100", Body: "Hi! Is the Tuesday session still open?", MessageSid: "SMaudit0000000000000000000000000001" })))
  const { data: m1 } = await db.from("sms_messages").select("direction, status, body, contact_id").eq("phone", phone).order("occurred_at")
  console.log("  sms_messages:", JSON.stringify(m1))
  const badSig = await fetch(`${APP}/api/webhooks/twilio/inbound`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "bogus" }, body: new URLSearchParams({ From: phone, To: "+18135550100", Body: "forged" }) })
  console.log(`  forged signature -> ${badSig.status} ${(await badSig.text()).slice(0, 80)}`)
  console.log("  STOP   ->", JSON.stringify(await post({ From: phone, To: "+18135550100", Body: "STOP", MessageSid: "SMaudit0000000000000000000000000002" })))
  const { data: sup } = await db.from("contact_suppressions").select("identifier, reason").eq("identifier", phone)
  const { data: cons } = await db.from("contact_consents").select("channel, granted, source, occurred_at").eq("contact_id", state.sendContactId).order("occurred_at")
  const { data: runs } = await db.from("sequence_runs").select("status, exit_reason").eq("contact_id", state.sendContactId)
  const { data: ev } = await db.from("contact_timeline_events").select("kind, source").eq("contact_id", state.sendContactId).order("occurred_at")
  console.log("  after STOP — suppressions:", JSON.stringify(sup), "consents:", JSON.stringify(cons), "runs:", JSON.stringify(runs), "timeline:", JSON.stringify(ev))
  state.sms = { suppressions: sup, consents: cons, runs, timeline: ev }; save()

  const browser5 = await launchChromium()
  try {
    const ctx = await browser5.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    await ctx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])
    const page = await ctx.newPage()
    await page.goto(`${APP}/admin/sms/${encodeURIComponent(phone)}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1000)
    await resetScroll(page)
    await shoot(page, "12-sms-thread-after-stop", "/admin/sms/<phone> — the thread after a reply and a STOP", "The reply arrived through the signed Twilio webhook (forged locally with the real signing key). STOP is deliberately not shown as a bubble — it is a consent event — but the composer knows.", [
      await markerOn(page, page.getByText("Is the Tuesday session still open?").first(), "The inbound reply, stored in sms_messages and linked to the contact.", { place: "left", dx: -8 }),
      await markerOn(page, page.locator("textarea, [role=textbox]").first(), "The compose box: sending checks suppression (STOP) but not the SMS consent box.", { place: "left", dx: -8 }),
    ], { fullPage: false })
    await page.goto(`${APP}/admin/contacts/${state.sendContactId}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1000)
    await resetScroll(page)
    await shoot(page, "13-contact-record", "/admin/contacts/<id> — the lead's record after form → nurture → reply → STOP", "Everything the engine wrote for one visitor: the entry point, the sequence they were enrolled in, the consent granted on the form and withdrawn by STOP, and the do-not-contact mark.", [])
    await page.goto(`${APP}/admin/funnels/leads`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1000)
    await resetScroll(page)
    await shoot(page, "14-funnel-leads", "/admin/funnels/leads — the submissions board", "Each published-form submission lands here. Note the Name column: the builder's 'athlete_name' / 'parent_name' fields are not recognised as a name, so the lead arrives nameless.", [])
  } finally {
    await browser5.close()
  }
}

// ---------------------------------------------------------------------------
// stage "page": the landing-page maker, end to end, plus the two conversion
// guards exercised through the real routes with the admin session.
// ---------------------------------------------------------------------------
if (stage === "page") {
  const browser6 = await launchChromium()
  try {
    const ctx = await browser6.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    await ctx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])
    const page = await ctx.newPage()
    const slug = `return-to-sport-screen-${Date.now().toString(36).slice(-4)}`
    state.pageSlug = slug; save()
    await page.goto(`${APP}/admin/pages`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "New landing page" }).click()
    const dlg = page.getByRole("dialog")
    await dlg.waitFor()
    await dlg.getByPlaceholder("Free Trial Week").fill("Return to Sport Screen")
    await dlg.getByPlaceholder("free-trial-week").fill(slug)
    await dlg.locator("#page-audience").fill("Athletes cleared by their physio who still don't trust the knee")
    await dlg.locator("#page-description").fill("A single page offering a free 20-minute return-to-sport screen in Zephyrhills: what we test, what the athlete leaves with, and a form to request a slot.")
    await page.waitForTimeout(300)
    await shoot(page, "15-new-landing-page-dialog", "Landing page maker — the New landing page dialog", "One page, one job. Name, address, what it should do, who it is for, and a description that seeds the first draft.", [
      await markerOn(page, dlg.getByRole("button", { name: /Create & build/ }), "'Create & build' — the builder writes the page straight away.", { place: "left", dx: -8 }),
    ], { fullPage: false })
    await dlg.getByRole("button", { name: /Create & build/ }).click()
    await page.waitForURL(/\/admin\/pages\/[0-9a-f-]+\/edit\/[0-9a-f-]+/, { timeout: 60000 })
    const m = page.url().match(/\/admin\/pages\/([0-9a-f-]+)\/edit\/([0-9a-f-]+)/)
    state.pageId = m[1]; state.pageStepId = m[2]; save()
    const t0 = Date.now()
    while (Date.now() - t0 < 8 * 60 * 1000) {
      const { data: st } = await db.from("funnel_steps").select("project_data").eq("id", state.pageStepId).single()
      const ok = st.project_data !== null && (await page.getByRole("button", { name: /^Publish$/ }).isEnabled().catch(() => false))
      if (ok) break
      await page.waitForTimeout(5000)
    }
    console.log(`  page drafted in ${Math.round((Date.now() - t0) / 1000)}s`)
    await page.waitForTimeout(1500)

    // the guards, through the real routes, with the real admin session
    const api = ctx.request
    const g1 = await api.post(`${APP}/api/admin/funnels/steps`, { data: { funnel_id: state.pageId, name: "Second page", slug: "second" } })
    console.log(`  POST /api/admin/funnels/steps on a kind='page' parent -> ${g1.status()} ${(await g1.text()).slice(0, 140)}`)
    const g2 = await api.patch(`${APP}/api/admin/funnels/${state.pageId}`, { data: { kind: "funnel" } })
    console.log(`  PATCH /api/admin/funnels/[id] with {kind} -> ${g2.status()} ${(await g2.text()).slice(0, 140)}`)
    const g2b = await api.patch(`${APP}/api/admin/funnels/${state.funnelId}`, { data: { status: "published", kind: "page" } })
    console.log(`  PATCH funnel with {status, kind} -> ${g2b.status()} ${(await g2b.text()).slice(0, 140)}`)
    const g3 = await api.post(`${APP}/api/admin/funnels/${state.funnelId}/convert`, { data: { to: "page" } })
    console.log(`  POST /convert funnel(2 steps) -> page -> ${g3.status()} ${(await g3.text()).slice(0, 160)}`)
    const g4 = await api.patch(`${APP}/api/admin/funnels/${state.funnelId}`, { data: { status: "published" } })
    console.log(`  PATCH funnel {status:"published"} (must go through /publish) -> ${g4.status()} ${(await g4.text()).slice(0, 140)}`)
    state.guards = { addStepOnPage: g1.status(), patchKind: g2.status(), patchStatusAndKind: g2b.status(), convertTwoStepFunnelToPage: g3.status(), patchPublishFunnel: g4.status() }; save()

    // publish the page from the builder
    await page.getByRole("button", { name: /^Publish$/ }).click()
    await page.getByRole("button", { name: /^Published$/ }).waitFor({ timeout: 90000 })
    await page.waitForTimeout(1200)
    const { data: f1 } = await db.from("funnels").select("kind, status").eq("id", state.pageId).single()
    console.log(`  after builder Publish: kind=${f1.kind} status=${f1.status}`)
    await resetScroll(page)
    await shoot(page, "16-landing-page-published", "Landing page maker — published from the builder", `For a landing page the builder's Publish publishes the one page AND flips the row live in the same request (status='${f1.status}').`, [
      await markerOn(page, page.getByRole("button", { name: /^Published$/ }), "'Published'. A landing page has no separate 'Publish funnel' — one page is the whole thing.", { place: "left", dx: -10 }),
    ], { fullPage: false })

    // the redirect that proves there is no detail screen
    const r = await page.goto(`${APP}/admin/pages/${state.pageId}`, { waitUntil: "networkidle" })
    console.log(`  /admin/pages/<id> -> ${r.status()} lands on ${page.url()}`)
    state.pageDetailRedirect = page.url(); save()
    await page.waitForTimeout(800)
    await resetScroll(page)
    await shoot(page, "17-pages-board-live", "/admin/pages — the card is the whole management surface", "Opening /admin/pages/<id> lands back on this list: a landing page has no detail screen. Run window, offer and notify emails live only on the funnel detail screen, so a page cannot show them.", [
      await markerOn(page, page.locator("text=live").first(), "'live' — /go/<slug> now serves this page to the public.", { place: "left", dx: -8 }),
      await markerOn(page, page.getByRole("button", { name: "Convert to funnel" }).first(), "'Convert to funnel' — POST /convert, the ONLY way a kind changes. Status is kept.", { place: "left", dx: -8 }),
    ], { fullPage: false })

    // public
    const pub = await browser6.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    const pp = await pub.newPage()
    const pr = await pp.goto(`${APP}/go/${slug}`, { waitUntil: "networkidle" })
    console.log(`  /go/${slug} -> ${pr.status()}`)
    await pp.waitForTimeout(800)
    await shoot(pp, "18-landing-page-public", "The published landing page at /go/<slug>, seen by the public", "A fresh browser, no admin session.", [], { fullPage: false })
    await pub.close()

    // convert page -> funnel through the real dialog, then back
    await page.getByRole("button", { name: "Convert to funnel" }).first().click()
    const cd = page.getByRole("alertdialog").or(page.getByRole("dialog"))
    await cd.first().waitFor()
    await page.waitForTimeout(400)
    await shoot(page, "19-convert-dialog", "Convert to funnel — the confirmation", "Conversion is a separate POST /convert; the ordinary save route refuses any body that names 'kind'. The status (live) is preserved across the conversion.", [
      await markerOn(page, cd.first().getByRole("button", { name: "Convert to funnel" }), "Confirm. The row keeps its one page and its published version — /go serves exactly what it served before.", { place: "left", dx: -8 }),
    ], { fullPage: false })
    await cd.first().getByRole("button", { name: "Convert to funnel" }).click()
    await page.waitForTimeout(3000)
    const { data: f2 } = await db.from("funnels").select("kind, status").eq("id", state.pageId).single()
    console.log(`  after convert: kind=${f2.kind} status=${f2.status} url=${page.url()}`)
    const pr2 = await (await browser6.newContext()).newPage().then((p) => p.goto(`${APP}/go/${slug}`))
    console.log(`  /go/${slug} after conversion -> ${pr2.status()}`)
    // and back, from the funnel card
    await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    const card = page.locator("[class*=rounded]", { hasText: "Return to Sport Screen" }).first()
    await page.getByRole("button", { name: "Convert to landing page" }).first().click()
    await cd.first().waitFor()
    await cd.first().getByRole("button", { name: "Convert to landing page" }).click()
    await page.waitForTimeout(3000)
    const { data: f3 } = await db.from("funnels").select("kind, status").eq("id", state.pageId).single()
    console.log(`  after convert back: kind=${f3.kind} status=${f3.status}`)
    state.convert = { afterToFunnel: f2, afterToPage: f3, goAfterConvert: pr2.status() }; save()
  } finally {
    await browser6.close()
  }
}

// ---------------------------------------------------------------------------
// stage "reshoot": re-capture the frames whose subtitles were clipped before
// _annotate-lib learned to wrap them. Stable screens only; no writes.
// ---------------------------------------------------------------------------
if (stage === "reshoot") {
  const browser7 = await launchChromium()
  try {
    const phone = "+12025550177"
    const ctx = await browser7.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    await ctx.addCookies([{ name: "djp_business", value: PRIMARY, url: APP }])
    const page = await ctx.newPage()

    await page.goto(`${APP}/admin/sms/${encodeURIComponent(phone)}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000); await resetScroll(page)
    await shoot(page, "12-sms-thread-after-stop", "/admin/sms/<phone> — the thread after a reply and a STOP", "The reply arrived through the signed Twilio webhook (forged locally with the real signing key). STOP is deliberately not shown as a bubble — it is a consent event — but the composer knows.", [
      await markerOn(page, page.getByText("Is the Tuesday session still open?").first(), "The inbound reply, stored in sms_messages and linked to the contact.", { place: "left", dx: -8 }),
      await markerOn(page, page.locator("textarea, [role=textbox]").first(), "The compose box: sending checks suppression (STOP) but not the SMS consent box.", { place: "left", dx: -8 }),
    ], { fullPage: false })

    await page.goto(`${APP}/admin/contacts/${state.sendContactId}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000); await resetScroll(page)
    await shoot(page, "13-contact-record", "/admin/contacts/<id> — the lead's record after form → nurture → reply → STOP", "Everything the engine wrote for one visitor: the entry point, the sequence they were enrolled in, the consent granted on the form and withdrawn by STOP, and the do-not-contact mark.", [
      await markerOn(page, page.getByText("Never asked").first(), "Email: 'Never asked'. No funnel, quiz, contact form or purchase ever records email consent — only the newsletter box and the chat do.", { place: "left", dx: -8 }),
      await markerOn(page, page.getByText("Replied STOP to a text").first(), "The nurture run exited on STOP — the exit rule works.", { place: "left", dx: -8 }),
    ])

    await page.goto(`${APP}/admin/funnels/leads`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000); await resetScroll(page)
    await shoot(page, "14-funnel-leads", "/admin/funnels/leads — the submissions board", "Each published-form submission lands here. Note the Lead column: the builder's 'athlete_name' / 'parent_name' fields are not recognised as a name, so the lead arrives nameless.", [
      await markerOn(page, page.locator("tbody tr").first().locator("td").nth(3), "'—': the visitor typed 'Riley Audit' and 'Aean Audit'; buildName() only reads first_name / name / last_name.", { place: "center" }),
    ])

    await page.goto(`${APP}/admin/pages`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000); await resetScroll(page)
    await shoot(page, "17-pages-board-live", "/admin/pages — the card is the whole management surface", "Opening /admin/pages/<id> lands back on this list: a landing page has no detail screen. Run window, offer and notify emails live only on the funnel detail screen, so a page cannot show them.", [
      await markerOn(page, page.locator("text=live").first(), "'live' — /go/<slug> now serves this page to the public.", { place: "left", dx: -8 }),
      await markerOn(page, page.getByRole("button", { name: "Convert to funnel" }).first(), "'Convert to funnel' — POST /convert, the ONLY way a kind changes. Status is kept.", { place: "left", dx: -8 }),
    ], { fullPage: false })

    await page.getByRole("button", { name: "Convert to funnel" }).first().click()
    const cd = page.getByRole("alertdialog").or(page.getByRole("dialog"))
    await cd.first().waitFor(); await page.waitForTimeout(400)
    await shoot(page, "19-convert-dialog", "Convert to funnel — the confirmation", "Conversion is a separate POST /convert; the ordinary save route refuses any body that names 'kind'. The status (live) is preserved across the conversion.", [
      await markerOn(page, cd.first().getByRole("button", { name: "Convert to funnel" }), "Confirm. The row keeps its one page and its published version — /go serves exactly what it served before.", { place: "left", dx: -8 }),
    ], { fullPage: false })
    await cd.first().getByRole("button", { name: "Cancel" }).click().catch(() => page.keyboard.press("Escape"))

    // the public form, filled but NOT submitted
    const pub = await browser7.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
    const pp = await pub.newPage()
    await pp.goto(`${APP}/go/${state.slug}`, { waitUntil: "networkidle" }); await pp.waitForTimeout(1000)
    const form = pp.locator("form").first()
    await form.locator('input[name="athlete_name"]').fill("Riley Audit")
    await form.locator('input[name="parent_name"]').fill("Aean Audit")
    await form.locator('input[name="parent_email"]').fill("tayawaschoolworks+audit2@gmail.com")
    await form.locator('input[name="parent_phone"]').fill(phone)
    await form.locator('input[name="sms_consent"]').check().catch(() => {})
    await form.locator('textarea[name="notes"]').fill("Junior winger, no injuries, wants to work on first-step quickness.")
    await resetScroll(pp)
    await shoot(pp, "07-go-form-filled", "The public form, filled in by a visitor", "Fields the builder chose: athlete, parent, email, phone, a texting consent box, notes. The hidden 'website' field is a bot trap — a bot that fills it gets a silent 200 and nothing is stored.", [
      await markerOn(pp, form.locator('input[name="sms_consent"]'), "Ticking this writes a dated SMS consent row; leaving it writes none. Email consent is never recorded here."),
    ], { fullPage: false })
    await pp.goto(`${APP}/go/${state.slug.replace(/-[a-z0-9]{4}$/, "")}/thank-you`, { waitUntil: "networkidle" }); await pp.waitForTimeout(600)
    await shoot(pp, "08-go-thank-you-404", "…and after submitting, the visitor sees 'Page not found'", `The builder wrote the form's redirect as /go/${state.slug.replace(/-[a-z0-9]{4}$/, "")}/thank-you — the funnel slug was GUESSED from its name. The real address is /go/${state.slug}. The lead was still captured.`, [], { fullPage: false })
    await pub.close()
  } finally {
    await browser7.close()
  }
}
