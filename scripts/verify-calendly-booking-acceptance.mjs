// Drives the REAL app and asserts the phase-2 acceptance bar, capability by
// capability. Exits non-zero on the first hard failure; soft checks print FAIL
// and the run continues so one report shows everything.
//
// The bar, from the brief:
//   "a booking made through the assistant appears in the pipeline as a card,
//    exits that person's sequences, and fires the ads conversion — proven end
//    to end, not asserted."
//
// WHAT IS REAL AND WHAT IS PLAYED. The browser, the chat route, the model, the
// tool, the cards, the webhook route, the ingest, the database, the admin
// screens — all real, on the dev clone. Calendly itself is played by a local
// fixture server (scripts/_calendly-webhook-lib.mjs) because no Calendly
// account is connected to this repo: it answers the availability endpoint the
// way Calendly does, and the "booking" is a delivery signed EXACTLY the way
// Calendly signs one, posted to the real webhook route. When the owner's
// account is connected, scripts/calendly-setup.mjs registers the real webhook
// and the same route receives the same shape from calendly.com.
//
// EVERY MUTATION IS CHECKED AFTER A FULL PAGE RELOAD or straight off the
// database, never off client state.
//
//   npm run dev                                          # port 3050, with the
//                                                        # CALENDLY_* fixture values in .env.local
//   node scripts/verify-calendly-booking-acceptance.mjs   # re-seeds the demo itself
//
// DEV CLONE ONLY; refuses any other project ref.

import { readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"

import {
  calendlyEnvelope,
  deliverCalendlyWebhook,
  startCalendlyFixtureServer,
  trackingFromLink,
} from "./_calendly-webhook-lib.mjs"
import { DEMO_CONTACT, DEMO_EMAIL, DEMO_GCLID, DEMO_NAME, DEMO_PHONE, DEMO_RUN, DEMO_SESSION, resetDemo } from "./seed-calendly-booking-demo.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

for (const k of ["CALENDLY_API_TOKEN", "CALENDLY_EVENT_TYPE_URI", "CALENDLY_SCHEDULING_URL", "CALENDLY_WEBHOOK_SIGNING_KEY", "CALENDLY_API_BASE"]) {
  if (!env[k]) throw new Error(`${k} is not in .env.local — the dev server cannot offer times or accept the webhook`)
}
const fixturePort = Number(new URL(env.CALENDLY_API_BASE).port || 4545)
const SIGNING_KEY = env.CALENDLY_WEBHOOK_SIGNING_KEY
const EVENT_TYPE = env.CALENDLY_EVENT_TYPE_URI
const RUN = Date.now().toString(36)

let failures = 0
let checks = 0
function check(label, ok, detail = "") {
  checks++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`)
  if (!ok) failures++
}
async function row(label, query) {
  const { data, error } = await query
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

// ---- a clean demo every run ------------------------------------------------------
// The first version of this script assumed `seed` had just been run. Run twice
// in a row it failed its own preconditions (the previous run had exited the
// sequence and created the card) and then 429'd on the chat's per-hour limits.
// Re-seeding here makes the run self-contained and repeatable; the seed is
// idempotent and deletes only by the demo prefix.
console.log("re-seeding the demo…")
await resetDemo()

// ---- the played Calendly -----------------------------------------------------
const fixture = await startCalendlyFixtureServer({
  port: fixturePort,
  schedulingUrl: env.CALENDLY_SCHEDULING_URL,
  timeZone: "America/New_York",
})
console.log(`fixture Calendly on :${fixturePort} (mode ${fixture.state.mode})`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
// The ad click: the same cookie the real site's middleware sets, carrying the
// session id the seed attributed a gclid to.
await ctx.addCookies([{ name: "djp_attr", value: DEMO_SESSION, url: APP }])

/** One chat turn. Resolves with the /api/ask JSON the page received. */
async function ask(page, text) {
  const waitReply = page.waitForResponse((r) => r.url().endsWith("/api/ask") && r.request().method() === "POST", { timeout: 90_000 })
  await page.getByLabel("Your question").fill(text)
  await page.getByRole("button", { name: "Send" }).click()
  const res = await waitReply
  const body = await res.json()
  if (!res.ok()) throw new Error(`/api/ask → ${res.status()}: ${JSON.stringify(body)}`)
  await page.waitForTimeout(300)
  return body
}

/**
 * Ask until the model calls book_consult (it is a model; the prompt makes this
 * likely, not certain). `want` is the card kind that proves the tool ran:
 * "slots" when the calendar has times, "consult" when it is empty or down.
 */
async function askForTimes(page, first, retry, want = "slots") {
  let body = await ask(page, first)
  let card = body.cards?.find((c) => c.kind === want)
  if (!card) {
    console.log(`        (model did not call book_consult on the first ask — reply was: "${(body.reply ?? "").slice(0, 120)}"; asking again)`)
    body = await ask(page, retry)
    card = body.cards?.find((c) => c.kind === want)
  }
  return { body, card }
}

try {
  // ---- 0. preconditions ----------------------------------------------------------
  console.log("\n0. preconditions")
  const config = await (await fetch(`${APP}/api/ask/config`)).json()
  check("the assistant is switched on (seed sets chat_assistant_enabled)", config.enabled === true, JSON.stringify(config))
  const run0 = await row("run", db.from("sequence_runs").select("status").eq("id", DEMO_RUN).maybeSingle())
  check("the demo visitor has an ACTIVE sequence run to exit", run0?.status === "active", JSON.stringify(run0))
  const opps0 = await row("opps", db.from("opportunities").select("id").eq("contact_id", DEMO_CONTACT))
  check("the demo visitor has NO pipeline card yet", (opps0 ?? []).length === 0)

  // ---- 1. the assistant offers real times ------------------------------------------
  console.log("\n1. the assistant offers real free times (before the visitor has left details)")
  const page = await ctx.newPage()
  await page.goto(`${APP}/ask`, { waitUntil: "networkidle" })
  check("/ask renders (not 404)", (await page.title()) !== "" && (await page.getByLabel("Your question").count()) === 1)

  const t1 = await askForTimes(
    page,
    "Hi, I'd like to book a consultation. What times are free this week?",
    "Please look up the free consultation times for this week and show them to me.",
  )
  const conversationId = t1.body.conversationId
  check("the turn returned a slots card", t1.card?.kind === "slots", JSON.stringify(t1.body.cards))
  if (t1.card?.kind !== "slots") throw new Error("no slots card — cannot continue")
  check("the card carries real slot instants from the availability lookup", t1.card.slots.length > 0 && t1.card.slots.every((s) => !Number.isNaN(Date.parse(s.startAt))))
  check("the card names the business time zone", t1.card.timezone === "America/New_York", t1.card.timezone)
  check(
    "the app asked the availability endpoint for THE configured event type over the next week",
    fixture.state.requests.some((r) => r.path === "/event_type_available_times" && r.query.event_type === EVENT_TYPE && r.auth === `Bearer ${env.CALENDLY_API_TOKEN}`),
    JSON.stringify(fixture.state.requests.slice(-2)),
  )
  const firstLink1 = trackingFromLink(t1.card.slots[0].href)
  check("every slot link carries the visitor's click id (gclid) for the ads conversion", t1.card.slots.every((s) => trackingFromLink(s.href).utm_content === `gclid:${DEMO_GCLID}`), JSON.stringify(firstLink1))
  check("every slot link carries the conversation id", t1.card.slots.every((s) => trackingFromLink(s.href).utm_term === `conv:${conversationId}`))
  check("no identity is prefilled yet — nothing captured, nothing guessed", firstLink1.email === null && firstLink1.name === null, JSON.stringify(firstLink1))
  // On screen, not just in JSON.
  check("the slot buttons are on screen", (await page.getByText("Pick a time for your consultation").count()) === 1)
  const buttons = page.locator('a[href*="calendly.com/"][href*="utm_source=website-assistant"]')
  check("each slot is a link the visitor can click", (await buttons.count()) >= t1.card.slots.length)
  // The reply text passed the grounded-value validator with the slot facts in play.
  check("the reply was not blocked by the validator", t1.body.verdict === "ok", `verdict=${t1.body.verdict} reply="${t1.body.reply}"`)

  // ---- 2. the visitor leaves details; the links become prefilled ------------------------
  console.log("\n2. the visitor leaves their details through the real capture route; the next lookup is prefilled")
  const capture = await page.request.post(`${APP}/api/ask/capture`, {
    data: { conversationId, name: DEMO_NAME, email: DEMO_EMAIL, phone: DEMO_PHONE, marketingConsent: false },
  })
  check("POST /api/ask/capture → 200", capture.ok(), `${capture.status()} ${await capture.text()}`)
  const conv = await row("conv", db.from("chat_conversations").select("contact_id").eq("id", conversationId).maybeSingle())
  check("the conversation is linked to the SEEDED contact (email matched, no duplicate created)", conv?.contact_id === DEMO_CONTACT, JSON.stringify(conv))
  const contacts = await row("contacts", db.from("contacts").select("id").eq("email", DEMO_EMAIL))
  check("still exactly one contact with that email", (contacts ?? []).length === 1, `${(contacts ?? []).length} rows`)

  const t2 = await askForTimes(page, "Great — which of those times are free?", "Show me the free consultation times again, please.")
  check("the second turn returned a slots card", t2.card?.kind === "slots", JSON.stringify(t2.body.cards))
  if (t2.card?.kind !== "slots") throw new Error("no slots card on turn 2 — cannot continue")
  const link2 = trackingFromLink(t2.card.slots[0].href)
  check("now every slot link is prefilled with the captured name and email", t2.card.slots.every((s) => { const t = trackingFromLink(s.href); return t.email === DEMO_EMAIL && t.name === DEMO_NAME }), JSON.stringify(link2))
  check("…and still carries the click id", link2.utm_content === `gclid:${DEMO_GCLID}`)
  check("the 'see every time' link is prefilled too", trackingFromLink(t2.card.href).email === DEMO_EMAIL)

  // Persistence: the card the visitor saw is what the row holds.
  const msgs = await row("msgs", db.from("chat_messages").select("cards, verdict").eq("conversation_id", conversationId).eq("role", "assistant"))
  check("the slots card is persisted on the assistant's message row", (msgs ?? []).some((m) => Array.isArray(m.cards) && m.cards.some((c) => c.kind === "slots")))

  // ---- 3. the booking arrives through the signed webhook -----------------------------
  console.log("\n3. the visitor books the first slot; Calendly's webhook (signed) reaches the app")
  const chosen = t2.card.slots[0]
  const eventUri = `https://api.calendly.com/scheduled_events/DEMO-${RUN}-1`
  const inviteeUri = `${eventUri}/invitees/DEMO-INV-${RUN}-1`
  const startTime = new Date(chosen.startAt).toISOString()
  const endTime = new Date(new Date(chosen.startAt).getTime() + 30 * 60_000).toISOString()
  const fromLink = trackingFromLink(chosen.href)
  // If the prefill checks above failed, the link carries no identity; the
  // booking is then made with what the visitor would have typed, so the rest
  // of the run still exercises the webhook rather than crashing here.
  if (!fromLink.name || !fromLink.email) {
    fromLink.name = fromLink.name ?? DEMO_NAME
    fromLink.email = fromLink.email ?? DEMO_EMAIL
  }
  const created = calendlyEnvelope({
    eventUri,
    inviteeUri,
    eventTypeUri: EVENT_TYPE,
    startTime,
    endTime,
    name: fromLink.name,
    email: fromLink.email,
    phone: "(617) 555-0142", // as a person types it into Calendly — NOT E.164
    tracking: { utm_source: fromLink.utm_source, utm_medium: fromLink.utm_medium, utm_content: fromLink.utm_content, utm_term: fromLink.utm_term },
  })
  const d1 = await deliverCalendlyWebhook(APP, created, SIGNING_KEY)
  check("invitee.created → 201 created", d1.status === 201 && d1.body?.action === "created", `${d1.status} ${JSON.stringify(d1.body)}`)

  // ---- 4. the four consequences, read off the database -------------------------------
  console.log("\n4. the four consequences")
  const booking = await row("booking", db.from("bookings").select("*").eq("calendly_event_uri", eventUri).maybeSingle())
  check("1/4 a bookings row exists, source calendly, keyed on the scheduled_event URI", booking?.source === "calendly", JSON.stringify(booking))
  check("    the row carries the click id decoded off the webhook's tracking", booking?.gclid === DEMO_GCLID, `gclid=${booking?.gclid}`)
  check("    the row carries the invitee's reschedule and cancel links", !!booking?.reschedule_url && !!booking?.cancel_url)
  check("    the phone was normalised to E.164 on the way in", booking?.contact_phone === DEMO_PHONE, booking?.contact_phone)
  check("    the booking date is the slot the visitor picked", booking && new Date(booking.booking_date).getTime() === new Date(startTime).getTime())

  const run1 = await row("run", db.from("sequence_runs").select("status, exit_reason").eq("id", DEMO_RUN).maybeSingle())
  check("2/4 the visitor's active sequence run is EXITED with reason booking", run1?.status === "exited" && run1?.exit_reason === "booking", JSON.stringify(run1))

  const uploads = booking ? await row("uploads", db.from("google_ads_conversion_uploads").select("status, gclid, upload_type").eq("source_id", booking.id)) : []
  check("3/4 exactly one Google Ads conversion upload is queued for the booking, with the gclid", (uploads ?? []).length === 1 && uploads[0].gclid === DEMO_GCLID && uploads[0].upload_type === "click", JSON.stringify(uploads))

  const opps1 = await row("opps", db.from("opportunities").select("id, outcome, stage:pipeline_stages(key)").eq("contact_id", DEMO_CONTACT))
  check("4/4 exactly one pipeline card, open, in Consult Booked", (opps1 ?? []).length === 1 && opps1[0].outcome === null && opps1[0].stage?.key === "consult_booked", JSON.stringify(opps1))

  const audit = await row("audit", db.from("audit_logs").select("action, actor_email, metadata").eq("action", "booking.created").eq("target_id", booking?.id ?? "00000000-0000-0000-0000-000000000000"))
  check("    an audit row records the booking with the chat conversation it came from", (audit ?? []).length === 1 && audit[0].actor_email === "calendly" && audit[0].metadata?.chat_conversation_id === conversationId, JSON.stringify(audit))

  // ---- 5. on the admin screens, after a full navigation --------------------------------
  console.log("\n5. the admin screens")
  const admin = await ctx.newPage()
  await admin.goto(`${APP}/api/dev/login?callbackUrl=/admin/pipeline`, { waitUntil: "domcontentloaded" })
  await admin.waitForURL(/\/admin\//, { timeout: 20_000 })
  await admin.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle" })
  const column = admin.locator("div").filter({ has: admin.locator("header p", { hasText: /^Consult Booked$/ }) }).last()
  check("the Consult Booked column holds a card for the visitor", (await column.locator(`p[title="${DEMO_NAME}"]`).count()) === 1)

  await admin.goto(`${APP}/admin/bookings`, { waitUntil: "networkidle" })
  const bookingRow = admin.locator("tr").filter({ hasText: DEMO_NAME }).first()
  check("the booking is listed on /admin/bookings", (await bookingRow.count()) === 1)
  check("…marked as via Calendly", (await bookingRow.getByText("via Calendly").count()) === 1)
  await bookingRow.getByRole("button", { name: `Actions for ${DEMO_NAME}` }).click()
  check("…with a Reschedule in Calendly action pointing at the invitee's link", (await admin.getByRole("link", { name: "Reschedule in Calendly" }).getAttribute("href")) === booking?.reschedule_url)
  check("…and a Cancel in Calendly action", (await admin.getByRole("link", { name: "Cancel in Calendly" }).count()) === 1)
  await admin.keyboard.press("Escape")

  await admin.goto(`${APP}/admin/contacts/${DEMO_CONTACT}`, { waitUntil: "networkidle" })
  check("the contact record's timeline shows the booking (matched by email/phone, no contact_id on bookings)", (await admin.getByText("Booking", { exact: true }).count()) >= 1)

  // ---- 6. redelivery ------------------------------------------------------------------
  console.log("\n6. Calendly redelivers the same event")
  const d2 = await deliverCalendlyWebhook(APP, created, SIGNING_KEY)
  check("the second delivery answers 200 updated, not 201", d2.status === 200 && d2.body?.action === "updated", `${d2.status} ${JSON.stringify(d2.body)}`)
  const rows2 = await row("rows", db.from("bookings").select("id").eq("calendly_event_uri", eventUri))
  const opps2 = await row("opps", db.from("opportunities").select("id").eq("contact_id", DEMO_CONTACT))
  const uploads2 = await row("uploads", db.from("google_ads_conversion_uploads").select("id").eq("source_id", booking.id))
  check("still one row, one card, one conversion upload", rows2.length === 1 && opps2.length === 1 && uploads2.length === 1, `${rows2.length}/${opps2.length}/${uploads2.length}`)

  // ---- 7. a reschedule: cancel-half then create-half ------------------------------------
  console.log("\n7. the visitor reschedules (Calendly sends a cancel for the old invitee and a create for the new one)")
  const eventUri2 = `https://api.calendly.com/scheduled_events/DEMO-${RUN}-2`
  const inviteeUri2 = `${eventUri2}/invitees/DEMO-INV-${RUN}-2`
  const later = t2.card.slots[1] ?? t2.card.slots[0]
  const cancelHalf = calendlyEnvelope({
    event: "invitee.canceled",
    eventUri,
    inviteeUri,
    eventTypeUri: EVENT_TYPE,
    startTime,
    endTime,
    name: fromLink.name,
    email: fromLink.email,
    rescheduled: true,
    newInvitee: inviteeUri2,
    tracking: { utm_content: fromLink.utm_content, utm_term: fromLink.utm_term },
  })
  const d3 = await deliverCalendlyWebhook(APP, cancelHalf, SIGNING_KEY)
  check("the cancel half → 200 updated", d3.status === 200, `${d3.status} ${JSON.stringify(d3.body)}`)
  const b3 = await row("b3", db.from("bookings").select("status, notes").eq("calendly_event_uri", eventUri).maybeSingle())
  check("the old row is cancelled and says where it went", b3?.status === "cancelled" && /Rescheduled via Calendly/.test(b3?.notes ?? ""), JSON.stringify(b3))
  const opps3 = await row("opps", db.from("opportunities").select("outcome, stage:pipeline_stages(key)").eq("contact_id", DEMO_CONTACT))
  check("the card is NOT lost — it stays open in Consult Booked", opps3.length === 1 && opps3[0].outcome === null && opps3[0].stage?.key === "consult_booked", JSON.stringify(opps3))

  const createHalf = calendlyEnvelope({
    eventUri: eventUri2,
    inviteeUri: inviteeUri2,
    eventTypeUri: EVENT_TYPE,
    startTime: new Date(later.startAt).toISOString(),
    endTime: new Date(new Date(later.startAt).getTime() + 30 * 60_000).toISOString(),
    name: fromLink.name,
    email: fromLink.email,
    oldInvitee: inviteeUri,
    tracking: { utm_content: fromLink.utm_content, utm_term: fromLink.utm_term },
  })
  const d4 = await deliverCalendlyWebhook(APP, createHalf, SIGNING_KEY)
  check("the create half → 201 created (a second row, the new time)", d4.status === 201, `${d4.status} ${JSON.stringify(d4.body)}`)
  const opps4 = await row("opps", db.from("opportunities").select("outcome, stage:pipeline_stages(key)").eq("contact_id", DEMO_CONTACT))
  check("still exactly one card, open, in Consult Booked", opps4.length === 1 && opps4[0].outcome === null && opps4[0].stage?.key === "consult_booked", JSON.stringify(opps4))
  const run4 = await row("run", db.from("sequence_runs").select("status").eq("id", DEMO_RUN).maybeSingle())
  check("the sequence run stays exited", run4?.status === "exited")

  // ---- 8. a real cancellation --------------------------------------------------------
  console.log("\n8. the visitor cancels outright")
  const realCancel = calendlyEnvelope({
    event: "invitee.canceled",
    eventUri: eventUri2,
    inviteeUri: inviteeUri2,
    eventTypeUri: EVENT_TYPE,
    startTime: new Date(later.startAt).toISOString(),
    endTime: new Date(new Date(later.startAt).getTime() + 30 * 60_000).toISOString(),
    name: fromLink.name,
    email: fromLink.email,
    cancellation: { canceled_by: fromLink.name, reason: "Something came up", canceler_type: "invitee" },
    tracking: { utm_content: fromLink.utm_content, utm_term: fromLink.utm_term },
  })
  const d5 = await deliverCalendlyWebhook(APP, realCancel, SIGNING_KEY)
  check("invitee.canceled → 200 updated", d5.status === 200, `${d5.status} ${JSON.stringify(d5.body)}`)
  const b5 = await row("b5", db.from("bookings").select("status, notes").eq("calendly_event_uri", eventUri2).maybeSingle())
  check("the row is cancelled with the reason", b5?.status === "cancelled" && /Something came up/.test(b5?.notes ?? ""), JSON.stringify(b5))
  const opps5 = await row("opps", db.from("opportunities").select("outcome, outcome_reason").eq("contact_id", DEMO_CONTACT))
  check("the card closes LOST with reason booking_cancelled", opps5.length === 1 && opps5[0].outcome === "lost" && opps5[0].outcome_reason === "booking_cancelled", JSON.stringify(opps5))

  // ---- 9. what is refused ------------------------------------------------------------
  console.log("\n9. what the webhook refuses")
  const before = (await row("count", db.from("bookings").select("id").like("calendly_event_uri", `%DEMO-${RUN}%`))).length
  const stale = await deliverCalendlyWebhook(APP, created, SIGNING_KEY, { at: Math.floor(Date.now() / 1000) - 3600 })
  check("a correctly signed but hour-old delivery → 403 (replay)", stale.status === 403, `${stale.status} ${JSON.stringify(stale.body)}`)
  const forged = await deliverCalendlyWebhook(APP, { ...created, payload: { ...created.payload, email: "attacker@example.test" } }, "not-the-key")
  check("a delivery signed with the wrong key → 403", forged.status === 403, `${forged.status}`)
  const unsigned = await fetch(`${APP}/api/webhooks/calendly`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(created) })
  check("an unsigned delivery → 403", unsigned.status === 403, `${unsigned.status}`)
  const after = (await row("count", db.from("bookings").select("id").like("calendly_event_uri", `%DEMO-${RUN}%`))).length
  check("none of them wrote a row", before === after, `${before} → ${after}`)

  // ---- 10. the two other shapes of book_consult ----------------------------------------
  console.log("\n10. the assistant when the calendar is empty, and when it is unreachable")
  fixture.setMode("empty")
  const pageEmpty = await ctx.newPage()
  await pageEmpty.goto(`${APP}/ask`, { waitUntil: "networkidle" })
  const tEmpty = await askForTimes(pageEmpty, "I'd like to book a consultation this week — what's free?", "Please check the free consultation times for this week.", "consult")
  const emptyKinds = (tEmpty.body.cards ?? []).map((c) => c.kind)
  check("an empty week gives a consult link and NO slot buttons", emptyKinds.includes("consult") && !emptyKinds.includes("slots"), JSON.stringify(emptyKinds))
  check("…the link is still the booking page", (tEmpty.body.cards ?? []).some((c) => c.kind === "consult" && c.href.startsWith(env.CALENDLY_SCHEDULING_URL)))
  check("…and the reply says nothing is free rather than naming a time", tEmpty.body.verdict === "ok" && !/\d{1,2}:\d{2}/.test(tEmpty.body.reply ?? ""), tEmpty.body.reply)
  await pageEmpty.close()

  fixture.setMode("down")
  const pageDown = await ctx.newPage()
  await pageDown.goto(`${APP}/ask`, { waitUntil: "networkidle" })
  const tDown = await askForTimes(pageDown, "Can I book a consultation? Show me the free times.", "Please look up the free consultation times.", "consult")
  const downKinds = (tDown.body.cards ?? []).map((c) => c.kind)
  check("an unreachable calendar gives a consult link and NO slot buttons", downKinds.includes("consult") && !downKinds.includes("slots"), JSON.stringify(downKinds))
  check("…and the reply names no time and does not claim the week is empty", tDown.body.verdict === "ok" && !/\d{1,2}:\d{2}/.test(tDown.body.reply ?? "") && !/nothing (is )?free|no free/i.test(tDown.body.reply ?? ""), tDown.body.reply)
  await pageDown.close()
  fixture.setMode("slots")
} finally {
  await browser.close()
  await fixture.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
