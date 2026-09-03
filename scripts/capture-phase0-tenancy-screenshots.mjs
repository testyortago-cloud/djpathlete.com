// Phase 0 tenancy proof: drives the REAL admin app after row-level security
// went on for `bookings` and three of its columns (business_id, host_id,
// end_at) became NOT NULL. Mocked tests cannot catch a schema or security
// mismatch — this script delivers one real signed Calendly webhook and then
// looks at the four real admin screens that read the row back.
//
//   npm run dev > /tmp/phase0-dev.log 2>&1 &
//   node scripts/capture-phase0-tenancy-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE, signed in as the real
// dev-clone admin user. The booking, the contact and the pipeline card are
// rows a real signed webhook delivery created through the real route — the
// same app/api/webhooks/calendly/route.ts a Calendly account would call.
//
// LIGHT ONLY, DELIBERATELY. The admin UI is light-only; `.dark` is a class
// variant these components were never built against, and there is no toggle
// that applies it. There is no second rendering to capture.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.
//
// WRITES ARE ADDITIVE AND UNIQUELY KEYED. This script creates exactly one new
// contact (fresh, timestamped email) and one new booking (fresh
// scheduled_event URI). It never calls resetDemo() and never deletes a row —
// the ca1e0d1e-0002-... and aaaaaaaa-0000-... prefixed rows from other demo
// scripts are only ever read here, never touched.

import { mkdirSync, readdirSync, existsSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"

import { annotate } from "./_annotate-lib.mjs"
import { calendlyEnvelope, deliverCalendlyWebhook } from "./_calendly-webhook-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/calendly-per-coach"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
for (const k of ["CALENDLY_EVENT_TYPE_URI", "CALENDLY_WEBHOOK_SIGNING_KEY"]) {
  if (!env[k]) throw new Error(`${k} is not in .env.local`)
}

const RUN = Date.now().toString(36)
const DIGITS = String(Date.now()).slice(-4)
// A varied, human-looking name per run — not a fixed constant — because a
// re-run on the same day (this script errored out and was re-run once while
// authoring it) must not leave two identically-named cards on the pipeline
// board with nothing but DOM order to tell them apart. EMAIL (below) is the
// one identifier this script actually relies on for uniqueness; the name is
// just what a caption reads out loud.
const FIRST_NAMES = ["Priya", "Jordan", "Maya", "Devon", "Elena", "Marcus", "Nadia", "Theo", "Sasha", "Owen", "Ines", "Callum"]
const LAST_NAMES = ["Whitfield", "Larkspur", "Osei", "Marchetti", "Solberg", "Delgado", "Kavanagh", "Renner", "Duclos", "Farrow"]
const seed = Number.parseInt(RUN, 36)
const NAME = `${FIRST_NAMES[seed % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(seed / 7) % LAST_NAMES.length]}`
const EMAIL = `${NAME.toLowerCase().replace(/\s+/g, ".")}.${RUN}@djpathlete.demo` // fresh, timestamped — collides with nothing
const PHONE = `(617) 555-${DIGITS}`

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

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })

try {
  // ---- create a brand-new contact through the real public capture route ------------
  // The same door every visitor uses: one real chat turn through /api/ask
  // (public, no login), then the details card's own submit route. This is
  // the ONLY path in the chat feature that can create a contact — see
  // app/api/ask/capture/route.ts's header — so it is driven for real rather
  // than written straight into the database.
  console.log(`run ${RUN} — new contact ${NAME} <${EMAIL}> ${PHONE}`)
  console.log("\n00 creating a brand-new contact through the public chat")
  const visitor = await ctx.newPage()
  await visitor.goto(`${APP}/ask`, { waitUntil: "networkidle" })
  const opening = await ask(visitor, "Hi, I have a question about your coaching program for a young athlete.")
  const conversationId = opening.conversationId
  const cap = await visitor.request.post(`${APP}/api/ask/capture`, {
    data: { conversationId, name: NAME, email: EMAIL, phone: PHONE, marketingConsent: false },
  })
  if (!cap.ok()) throw new Error(`capture → ${cap.status()} ${await cap.text()}`)
  await visitor.close()

  // ---- deliver ONE new signed Calendly webhook --------------------------------------
  // A fresh scheduled_event URI and the same email the contact was just filed
  // under, so this booking finds that contact by identifier match and creates
  // its own booking, its own contact-linked row, and collides with nothing
  // that ca1e0d1e-0002-... or aaaaaaaa-0000-... prefixed scripts own.
  console.log("\n   delivering one signed Calendly webhook")
  const eventUri = `https://api.calendly.com/scheduled_events/PHASE0-${RUN}`
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + 1)
  // Tomorrow, mid-morning in America/New_York. The minute is derived from
  // this run's seed (not a fixed :00) so two runs on the same calendar day
  // don't write the same instant — the audit log below is found by matching
  // this exact string against the on-screen row, and two bookings sharing one
  // timestamp would make that match ambiguous.
  start.setUTCHours(15, seed % 60, 0, 0)
  const startTime = start.toISOString()
  const endTime = new Date(start.getTime() + 30 * 60_000).toISOString()
  const envelope = calendlyEnvelope({
    eventUri,
    inviteeUri: `${eventUri}/invitees/PHASE0-INV-${RUN}`,
    eventTypeUri: env.CALENDLY_EVENT_TYPE_URI,
    startTime,
    endTime,
    name: NAME,
    email: EMAIL,
    phone: PHONE,
    timezone: "America/New_York",
  })
  const delivered = await deliverCalendlyWebhook(APP, envelope, env.CALENDLY_WEBHOOK_SIGNING_KEY)
  if (delivered.status !== 201) throw new Error(`webhook → ${delivered.status} ${JSON.stringify(delivered.body)}`)

  const { data: booking, error: bookingErr } = await db
    .from("bookings")
    .select("id, business_id, host_id, contact_id, end_at, invitee_timezone, source, calendly_event_uri, booking_date")
    .eq("calendly_event_uri", eventUri)
    .maybeSingle()
  if (bookingErr) throw new Error(`read-back failed: ${bookingErr.code} ${bookingErr.message}`)
  if (!booking) throw new Error("webhook returned 201 but no bookings row was found by calendly_event_uri")
  if (!booking.business_id || !booking.host_id || !booking.end_at) {
    throw new Error(`the new row is missing a NOT NULL tenant column: ${JSON.stringify(booking)}`)
  }
  if (!booking.contact_id) {
    throw new Error(
      `contact_id is null on the new booking — the fresh contact created above did not match by email. row: ${JSON.stringify(booking)}`,
    )
  }
  console.log(`   booking   ${booking.id}  business_id=${booking.business_id} host_id=${booking.host_id}`)
  console.log(`   contact   ${booking.contact_id}`)

  // ---- sign in as the real admin user -------------------------------------------------
  console.log("\n   signing in as the real admin user")
  const admin = await ctx.newPage()
  await admin.goto(`${APP}/api/dev/login?callbackUrl=/admin/bookings`, { waitUntil: "domcontentloaded" })
  await admin.waitForURL(/\/admin\//, { timeout: 20_000 })

  // ---- 01: the bookings list ---------------------------------------------------------
  console.log("\n01 the bookings list")
  await admin.goto(`${APP}/admin/bookings`, { waitUntil: "networkidle" })
  // Keyed on EMAIL, not NAME: the dev clone already carries a few stray rows
  // from earlier authoring runs of this same script, and email is the one
  // string this script guarantees is unique.
  const bookingRow = admin.locator("tr").filter({ hasText: EMAIL }).first()
  await bookingRow.scrollIntoViewIfNeeded()
  await shoot(
    admin,
    "01-admin-bookings-list",
    "The bookings screen still works now the database locks these rows down",
    `${NAME}'s row arrived seconds ago. The database now requires every booking to name its business.`,
    [
      await markerOn(admin, bookingRow, `${NAME}'s booking. Brand new — created by this test, and matched to a brand-new contact by email address.`, { place: "left" }),
      await markerOn(admin, bookingRow.getByText("via Calendly"), "Booked through Calendly, same as before. How a booking arrives did not change.", { place: "right", dx: 10 }),
      await markerOn(admin, bookingRow.getByRole("button", { name: `Actions for ${NAME}` }), "The row's own menu still works: reschedule and cancel links, mark complete, and so on.", { place: "left" }),
    ],
    { fullPage: false },
  )

  // ---- 02: the pipeline card -----------------------------------------------------------
  console.log("\n02 the pipeline card")
  await admin.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle" })
  // .last(): the newest card in a column renders after any same-named stray
  // card left by an earlier run of this script (see the bookingRow comment
  // above) — the board lists a stage's cards in the order they entered it.
  const card = admin.locator(`p[title="${NAME}"]`).last()
  const header = admin.locator("header p", { hasText: /^Consult Booked$/ })
  await card.scrollIntoViewIfNeeded()
  await shoot(
    admin,
    "02-admin-pipeline-card",
    "The booking still moves a card into Consult Booked",
    `Who gets told about a new booking changed: only this business's own people hear about it now.`,
    [
      await markerOn(admin, header, "The Consult Booked column. The booking notice moved this new person's card here automatically, the moment the booking arrived.", { place: "above" }),
      await markerOn(admin, card, `${NAME}'s card. Entered today — the same person as the new booking. Nobody outside this coach's business was notified about it.`, { place: "left" }),
    ],
    { fullPage: false },
  )

  // ---- 03: the contact record -----------------------------------------------------------
  console.log("\n03 the contact record")
  await admin.goto(`${APP}/admin/contacts/${booking.contact_id}`, { waitUntil: "networkidle" })
  const bookingEntry = admin.locator("tr").filter({ hasText: "Booked a call" }).first()
  await bookingEntry.scrollIntoViewIfNeeded()
  await shoot(
    admin,
    "03-admin-contact-record",
    "The booking lands on the right person's file — a brand-new file",
    `This file was created moments ago. Its history shows the call that was just booked.`,
    [
      await markerOn(admin, admin.locator("h1"), `${NAME}. A new person's file, filed the moment they answered a question in the site's chat.`, { place: "right" }),
      await markerOn(admin, bookingEntry.locator("time").first(), "The booking, on this person's own timeline. The booking's own row also now stores a direct, permanent link to this exact person — until this week the database could only guess, by comparing names and email addresses.", { place: "left" }),
    ],
  )

  // ---- 04: the audit log, filtered to money-related events -----------------------------
  console.log("\n04 the audit log filtered to commerce")
  await admin.goto(`${APP}/admin/audit-logs?category=commerce`, { waitUntil: "networkidle" })
  // The audited target_label is the LITERAL string this script sent as
  // `startTime` (recordAudit stores `input.bookingDate` verbatim) — not the
  // value read back from Postgres, which normalises the same instant to
  // "+00:00" with no milliseconds and would never match the rendered row.
  const auditRow = admin.locator("tr").filter({ hasText: startTime }).first()
  await auditRow.scrollIntoViewIfNeeded()
  await shoot(
    admin,
    "04-admin-audit-logs-commerce",
    "A permanent record of the booking, filtered to money-related events",
    `Every list here can be narrowed to one kind of event; this one shows only "commerce".`,
    [
      await markerOn(admin, admin.locator("select").first(), `Filtered to "commerce" — bookings, purchases and refunds. Only those events are listed.`, { place: "left" }),
      await markerOn(admin, auditRow, `This booking, recorded as booking.created the instant the booking notice was accepted. Nobody in the admin app can edit or delete this list.`, { place: "left" }),
    ],
    { fullPage: false },
  )
} finally {
  await browser.close()
}
console.log("\ndone")
