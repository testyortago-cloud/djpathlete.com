// Drives the REAL app and captures the Calendly booking feature, with the
// callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev                                          # port 3050, CALENDLY_* fixture values in .env.local
//   node scripts/capture-calendly-booking-screenshots.mjs # re-seeds the demo itself
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. The chat turns are real
// model turns through /api/ask; the slot card is what the tool returned; the
// pipeline card, the bookings row and the contact record are the rows a signed
// webhook delivery created through the real route. Calendly's availability
// endpoint is played by a local fixture server because no Calendly account is
// connected to this repo (see the acceptance script's header).
//
// LIGHT ONLY, DELIBERATELY. The public site defines a `.dark` class variant but
// ships no toggle that applies it, and the admin components were never built
// against it. There is no second rendering to capture.
//
// MARKERS SIT OUTSIDE THE ELEMENT THEY NAME. Phase 1's shots had three dots
// covering the text they pointed at; `markerOn` here places the disc beside
// the box (left by default, right or above when asked) and never over it.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"

import { annotate } from "./_annotate-lib.mjs"
import { calendlyEnvelope, deliverCalendlyWebhook, startCalendlyFixtureServer, trackingFromLink } from "./_calendly-webhook-lib.mjs"
import { DEMO_CONTACT, DEMO_EMAIL, DEMO_NAME, DEMO_PHONE, DEMO_SESSION, resetDemo } from "./seed-calendly-booking-demo.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/calendly-booking"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
for (const k of ["CALENDLY_EVENT_TYPE_URI", "CALENDLY_SCHEDULING_URL", "CALENDLY_WEBHOOK_SIGNING_KEY", "CALENDLY_API_BASE"]) {
  if (!env[k]) throw new Error(`${k} is not in .env.local`)
}
const RUN = Date.now().toString(36)

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"], [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

/**
 * A marker beside a real element, in the raw pixel space annotate() draws in.
 * `place`: "left" (default) puts the disc 22 CSS px left of the box, "right"
 * 22 px right of it, "above" centred 22 px above it. Never on top of it.
 * WARNS LOUDLY when the target is missing or ambiguous rather than degrading.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  else if (place === "above") {
    cx = box.x + box.width / 2
    cy = box.y - 22
  } else cx = box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers, { fullPage = true } = {}) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  unlinkSync(raw)
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function ask(page, text) {
  const waitReply = page.waitForResponse((r) => r.url().endsWith("/api/ask") && r.request().method() === "POST", { timeout: 90_000 })
  await page.getByLabel("Your question").fill(text)
  await page.getByRole("button", { name: "Send" }).click()
  const res = await waitReply
  const body = await res.json()
  if (!res.ok()) throw new Error(`/api/ask → ${res.status()}: ${JSON.stringify(body)}`)
  await page.waitForTimeout(400)
  return body
}

async function askUntil(page, wantKind, first, retry) {
  let body = await ask(page, first)
  if (!(body.cards ?? []).some((c) => c.kind === wantKind)) {
    console.log(`  (model did not produce a ${wantKind} card first time; asking again)`)
    body = await ask(page, retry)
  }
  if (!(body.cards ?? []).some((c) => c.kind === wantKind)) throw new Error(`no ${wantKind} card after two asks: ${JSON.stringify(body.cards)}`)
  return body
}

console.log("re-seeding the demo…")
await resetDemo()

const fixture = await startCalendlyFixtureServer({
  port: Number(new URL(env.CALENDLY_API_BASE).port || 4545),
  schedulingUrl: env.CALENDLY_SCHEDULING_URL,
  timeZone: "America/New_York",
})
const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
await ctx.addCookies([{ name: "djp_attr", value: DEMO_SESSION, url: APP }])

try {
  // ---- 01: the slot card, for a visitor who has left their details --------------------
  console.log("\n01 the assistant offers real free times")
  const page = await ctx.newPage()
  await page.goto(`${APP}/ask`, { waitUntil: "networkidle" })
  const opening = await ask(page, "Hi! I'm interested in coaching for my daughter and I'd like to talk to someone.")
  const conversationId = opening.conversationId
  // The visitor fills in the details card the model put on screen (or would
  // have); the capture route is the only writer, and it links the conversation
  // to the seeded contact by email so the next lookup is prefilled.
  const cap = await page.request.post(`${APP}/api/ask/capture`, {
    data: { conversationId, name: DEMO_NAME, email: DEMO_EMAIL, phone: DEMO_PHONE, marketingConsent: false },
  })
  if (!cap.ok()) throw new Error(`capture → ${cap.status()} ${await cap.text()}`)
  const t = await askUntil(page, "slots", "Can I book a consultation? What times are free this week?", "Please look up the free consultation times for this week.")
  const slotsCard = t.cards.find((c) => c.kind === "slots")
  // The opening turn may already have offered times (the model adds a way
  // forward to almost every answer), so there can be TWO slots cards on the
  // page — the earlier one un-prefilled, this one prefilled. Every locator
  // below is scoped to the LAST card, which is the turn just returned.
  const lastCard = page.locator("div").filter({ has: page.getByText("Pick a time for your consultation") }).last()
  await lastCard.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  const firstSlot = lastCard.locator('a[href*="utm_source=website-assistant"][href*="date="]').first()
  const firstHref = await firstSlot.getAttribute("href")
  const fromLink = trackingFromLink(firstHref)
  await shoot(page, "01-ask-slot-card", "The assistant offers real free times, read from the calendar at request time", `${slotsCard.slots.length} slots in the business time zone. Each button is that time's booking page, prefilled with the visitor's name and email and carrying their ad click id.`, [
    await markerOn(page, page.locator("div.bg-muted").filter({ hasText: /./ }).last(), "The model's reply. Every time it names came back from the lookup as a slot fact; a time the lookup did not return fails the grounded-value check and the whole turn is thrown away.", { place: "left" }),
    await markerOn(page, lastCard.getByText("Pick a time for your consultation"), "The slots card. Every value is server-read: instants from the availability lookup, zone from business settings. No model-authored field.", { place: "left" }),
    await markerOn(page, firstSlot, `The first slot. Its link is prefilled: name=${fromLink.name}, email=${fromLink.email}, and utm_content=${fromLink.utm_content} so the booking fires the ads conversion.`, { place: "left" }),
    await markerOn(page, lastCard.getByText(/Times are shown in/), "The zone is named because the booking page will show the visitor's local zone, and the two can differ.", { place: "right" }),
    await markerOn(page, lastCard.getByRole("link", { name: /See every available time/ }), "The plain booking page, also prefilled — nothing is booked until the visitor finishes there.", { place: "right" }),
  ])

  // ---- 02: nothing free this week --------------------------------------------------
  console.log("\n02 an empty week")
  fixture.setMode("empty")
  const pageEmpty = await ctx.newPage()
  await pageEmpty.goto(`${APP}/ask`, { waitUntil: "networkidle" })
  await askUntil(pageEmpty, "consult", "I'd like to book a consultation this week. What's free?", "Please check the free consultation times for this week.")
  await pageEmpty.waitForTimeout(300)
  await shoot(pageEmpty, "02-ask-empty-week", "Nothing free this week is a real answer, and a different one from 'could not check'", "The availability read succeeded and came back empty. The assistant says so plainly and offers the booking page so the visitor can look further ahead.", [
    await markerOn(pageEmpty, pageEmpty.locator("div.bg-muted").filter({ hasText: /./ }).last(), "The reply says nothing is free in the next seven days. It does not name a time — there is none to name.", { place: "left" }),
    await markerOn(pageEmpty, pageEmpty.getByRole("link", { name: /Book a consultation/ }).last(), "The booking page, prefilled where the visitor is known. No slot buttons, because there are no slots.", { place: "left" }),
  ])
  await pageEmpty.close()

  // ---- 03: the calendar could not be read ---------------------------------------------
  console.log("\n03 the calendar is unreachable")
  fixture.setMode("down")
  const pageDown = await ctx.newPage()
  await pageDown.goto(`${APP}/ask`, { waitUntil: "networkidle" })
  await askUntil(pageDown, "consult", "Can I book a consultation? Show me the free times please.", "Please look up the free consultation times.")
  await pageDown.waitForTimeout(300)
  await shoot(pageDown, "03-ask-calendar-unreachable", "When availability cannot be READ the assistant says nothing about times at all", "The provider answered 503. That is not an empty week: the assistant falls back to the link and is told not to mention any time or say whether times are available.", [
    await markerOn(pageDown, pageDown.locator("div.bg-muted").filter({ hasText: /./ }).last(), "No time named, no claim that the week is full. 'Could not check' and 'nothing free' are different answers and the copy keeps them apart.", { place: "left" }),
    await markerOn(pageDown, pageDown.getByRole("link", { name: /Book a consultation/ }).last(), "The visitor still has somewhere to go: the booking page itself shows the calendar.", { place: "left" }),
  ])
  await pageDown.close()
  fixture.setMode("slots")

  // ---- the booking arrives ----------------------------------------------------------
  console.log("\n   delivering the signed webhook for the first slot")
  const eventUri = `https://api.calendly.com/scheduled_events/DEMO-${RUN}-shot`
  const startTime = new Date(slotsCard.slots[0].startAt).toISOString()
  const created = calendlyEnvelope({
    eventUri,
    inviteeUri: `${eventUri}/invitees/DEMO-INV-${RUN}`,
    eventTypeUri: env.CALENDLY_EVENT_TYPE_URI,
    startTime,
    endTime: new Date(new Date(startTime).getTime() + 30 * 60_000).toISOString(),
    name: fromLink.name,
    email: fromLink.email,
    phone: "(617) 555-0142",
    tracking: { utm_source: fromLink.utm_source, utm_medium: fromLink.utm_medium, utm_content: fromLink.utm_content, utm_term: fromLink.utm_term },
  })
  const delivered = await deliverCalendlyWebhook(APP, created, env.CALENDLY_WEBHOOK_SIGNING_KEY)
  if (delivered.status !== 201) throw new Error(`webhook → ${delivered.status} ${JSON.stringify(delivered.body)}`)
  const { data: booking } = await db.from("bookings").select("*").eq("calendly_event_uri", eventUri).maybeSingle()
  const { data: upload } = await db.from("google_ads_conversion_uploads").select("status, gclid").eq("source_id", booking.id).maybeSingle()
  const { data: run } = await db.from("sequence_runs").select("status, exit_reason").eq("contact_id", DEMO_CONTACT).maybeSingle()

  // ---- 04: the pipeline card ------------------------------------------------------------
  console.log("\n04 the pipeline card")
  const admin = await ctx.newPage()
  await admin.goto(`${APP}/api/dev/login?callbackUrl=/admin/pipeline`, { waitUntil: "domcontentloaded" })
  await admin.waitForURL(/\/admin\//, { timeout: 20_000 })
  await admin.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle" })
  const card = admin.locator(`p[title="${DEMO_NAME}"]`)
  const header = admin.locator("header p", { hasText: /^Consult Booked$/ })
  await shoot(admin, "04-pipeline-consult-booked", "One signed webhook delivery, four consequences — this is the fourth", `bookings row (source calendly, gclid ${booking.gclid}) · sequence run ${run.status} (${run.exit_reason}) · ads conversion ${upload?.status ?? "not queued"} · card in Consult Booked`, [
    await markerOn(admin, header, "The Consult Booked stage. applyPipelineEvent created the card from the booking, exactly as it does for the GoHighLevel webhook — same function, one definition of what a booking means.", { place: "above" }),
    await markerOn(admin, card, `${DEMO_NAME}'s card, matched to her contact by email and phone (bookings has no contact_id). Entered today.`, { place: "left" }),
  ], { fullPage: false })

  // ---- 05: the bookings row and its Calendly actions -------------------------------
  console.log("\n05 the bookings list")
  await admin.goto(`${APP}/admin/bookings`, { waitUntil: "networkidle" })
  const bookingRow = admin.locator("tr").filter({ hasText: DEMO_NAME }).first()
  await bookingRow.getByRole("button", { name: `Actions for ${DEMO_NAME}` }).click()
  await admin.waitForTimeout(200)
  await shoot(admin, "05-bookings-calendly-actions", "The booking row, with the invitee's own reschedule and cancel links", "reschedule_url and cancel_url come back on the webhook and are stored because this menu READS them — the admin can move or cancel the call without logging into Calendly.", [
    await markerOn(admin, bookingRow.getByText("via Calendly"), "Source: calendly. The four older rows are GoHighLevel bookings and carry neither link; both webhooks run in parallel.", { place: "above" }),
    await markerOn(admin, admin.getByRole("link", { name: "Reschedule in Calendly" }), "Opens Calendly's reschedule page for this invitee. Calendly then sends a cancel (rescheduled=true) and a fresh create — and the cancel half is kept away from the pipeline.", { place: "left" }),
    await markerOn(admin, admin.getByRole("link", { name: "Cancel in Calendly" }), "Opens Calendly's cancel page. The resulting invitee.canceled closes the card as lost.", { place: "left" }),
  ], { fullPage: false })
  await admin.keyboard.press("Escape")

  // ---- 06: the contact record ---------------------------------------------------------
  console.log("\n06 the contact record")
  await admin.goto(`${APP}/admin/contacts/${DEMO_CONTACT}`, { waitUntil: "networkidle" })
  const bookingEntry = admin.locator("tr").filter({ hasText: "Booked a call" }).first()
  await bookingEntry.scrollIntoViewIfNeeded()
  await shoot(admin, "06-contact-record-timeline", "The same booking on the contact's timeline", "Phase 1's screen, unchanged: it matches bookings to a contact by normalising email and phone on both sides, so a Calendly row (E.164 phone) and a GoHighLevel row (national format) both land on the right person.", [
    await markerOn(admin, bookingEntry.locator("time").first(), "The booking entry. Bookings still have no contact_id — this is the identifier match, not a join.", { place: "left" }),
  ])
} finally {
  await browser.close()
  await fixture.close()
}
console.log("\ndone")
