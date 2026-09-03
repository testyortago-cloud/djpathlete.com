// scripts/_calendly-webhook-lib.mjs — the pieces the Calendly scripts share:
// a signer that matches lib/calendly/signature.ts byte for byte, a payload
// builder shaped like Calendly's invitee.created / invitee.canceled deliveries,
// and a tiny fixture server that answers the availability endpoint so the
// end-to-end proof does not need a live Calendly account.
//
// Plain ESM so the .mjs scripts can import it without a TypeScript loader. The
// signer is deliberately re-implemented here rather than imported from
// lib/calendly/signature.ts — __tests__/lib/calendly/signature.test.ts pins
// that module against an independent node:crypto computation, and this is
// that same computation. If the two ever disagree, the acceptance script's
// 403 is the alarm.

import { createHmac } from "node:crypto"
import { createServer } from "node:http"

/** `t=<unix>,v1=<hex>` for `rawBody` — Calendly's documented scheme. */
export function signCalendlyBody(rawBody, signingKey, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", signingKey).update(`${timestampSeconds}.${rawBody}`, "utf8").digest("hex")
  return `t=${timestampSeconds},v1=${v1}`
}

/**
 * POST a signed delivery to the running app. Returns { status, body }.
 * `at` lets a caller forge a stale timestamp on purpose.
 */
export async function deliverCalendlyWebhook(appOrigin, envelope, signingKey, { at, header } = {}) {
  const raw = JSON.stringify(envelope)
  const signature = header ?? signCalendlyBody(raw, signingKey, at)
  const res = await fetch(`${appOrigin}/api/webhooks/calendly`, {
    method: "POST",
    headers: { "content-type": "application/json", "calendly-webhook-signature": signature },
    body: raw,
  })
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

/**
 * An invitee.created / invitee.canceled envelope in the shape Calendly sends
 * (Invitee resource + embedded scheduled_event). Every field the webhook reads
 * is settable; the rest is realistic filler.
 */
export function calendlyEnvelope({
  event = "invitee.created",
  eventUri,
  inviteeUri,
  eventTypeUri,
  startTime,
  endTime,
  name,
  email,
  phone = null,
  timezone = "America/New_York",
  tracking = {},
  rescheduled = false,
  oldInvitee = null,
  newInvitee = null,
  cancellation = null,
  rescheduleUrl,
  cancelUrl,
}) {
  const inviteeId = inviteeUri.split("/").pop()
  return {
    created_at: new Date().toISOString(),
    created_by: "https://api.calendly.com/users/DEMOUSER00000001",
    event,
    payload: {
      cancel_url: cancelUrl ?? `https://calendly.com/cancellations/${inviteeId}`,
      created_at: new Date().toISOString(),
      email,
      event: eventUri,
      first_name: name.split(" ")[0] ?? name,
      last_name: name.split(" ").slice(1).join(" ") || null,
      name,
      new_invitee: newInvitee,
      old_invitee: oldInvitee,
      questions_and_answers: [],
      reschedule_url: rescheduleUrl ?? `https://calendly.com/reschedulings/${inviteeId}`,
      rescheduled,
      status: event === "invitee.canceled" ? "canceled" : "active",
      text_reminder_number: phone,
      timezone,
      tracking: {
        utm_campaign: null,
        utm_source: null,
        utm_medium: null,
        utm_content: null,
        utm_term: null,
        salesforce_uuid: null,
        ...tracking,
      },
      updated_at: new Date().toISOString(),
      uri: inviteeUri,
      ...(cancellation ? { cancellation } : {}),
      scheduled_event: {
        uri: eventUri,
        name: "Consultation",
        status: event === "invitee.canceled" ? "canceled" : "active",
        start_time: startTime,
        end_time: endTime,
        event_type: eventTypeUri,
        location: phone ? { type: "outbound_call", location: phone } : { type: "zoom_conference", location: null },
        invitees_counter: { total: 1, active: event === "invitee.canceled" ? 0 : 1, limit: 1 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        event_memberships: [
          { user: "https://api.calendly.com/users/DEMOUSER00000001", user_email: "coach@example.test", user_name: "Coach" },
        ],
        event_guests: [],
      },
    },
  }
}

/** The tracking parameters back out of a scheduling link the assistant built. */
export function trackingFromLink(href) {
  const url = new URL(href)
  return {
    utm_source: url.searchParams.get("utm_source"),
    utm_medium: url.searchParams.get("utm_medium"),
    utm_content: url.searchParams.get("utm_content"),
    utm_term: url.searchParams.get("utm_term"),
    name: url.searchParams.get("name"),
    email: url.searchParams.get("email"),
  }
}

/**
 * Free slots for the coming week, generated relative to NOW so the fixture is
 * never in the past: weekday mornings and one evening, in the given zone.
 * Returned in Calendly's response shape.
 */
export function upcomingSlots({ schedulingUrl, timeZone = "America/New_York", days = 5 } = {}) {
  const slots = []
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  for (let d = 1; slots.length < days * 2 && d < 14; d++) {
    const day = new Date(start.getTime() + d * 86_400_000)
    const dow = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(day)
    if (dow === "Sat" || dow === "Sun") continue
    for (const [h, m] of [
      [10, 0],
      [15, 30],
    ]) {
      const local = zonedInstant(day, h, m, timeZone)
      slots.push({
        status: "available",
        invitees_remaining: 1,
        start_time: local.toISOString().replace("Z", "000Z").replace(/\.(\d{3})000Z$/, ".$1000Z"),
        scheduling_url: `${schedulingUrl}/${local.toISOString().slice(0, 19)}Z?month=${local.toISOString().slice(0, 7)}&date=${local.toISOString().slice(0, 10)}`,
      })
    }
  }
  return { collection: slots }
}

/** The instant at `h:m` wall-clock on `day`'s date in `timeZone`. */
function zonedInstant(day, h, m, timeZone) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(day)
  // Guess UTC, measure the offset the zone applies at that instant, correct once.
  const guess = new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess)
  const seenH = Number(parts.find((p) => p.type === "hour")?.value ?? 0)
  const seenM = Number(parts.find((p) => p.type === "minute")?.value ?? 0)
  const diffMin = seenH * 60 + seenM - (h * 60 + m)
  return new Date(guess.getTime() - diffMin * 60_000)
}

/**
 * A fixture server that plays Calendly's availability endpoint. `mode` can be
 * flipped at runtime so the acceptance script can show all three shapes of
 * book_consult without restarting the app:
 *   "slots"  → the generated week
 *   "empty"  → { collection: [] }
 *   "down"   → 503
 * Also records every request so the script can assert what the app asked for.
 */
export function startCalendlyFixtureServer({ port = 4545, schedulingUrl, timeZone } = {}) {
  const state = { mode: "slots", requests: [] }
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    state.requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? null })
    if (url.pathname === "/__mode") {
      state.mode = url.searchParams.get("set") ?? state.mode
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ mode: state.mode }))
      return
    }
    if (url.pathname !== "/event_type_available_times") {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ title: "Not Found" }))
      return
    }
    if (state.mode === "down") {
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ title: "Service Unavailable" }))
      return
    }
    const body = state.mode === "empty" ? { collection: [] } : upcomingSlots({ schedulingUrl, timeZone })
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  })
  return new Promise((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => {
      resolve({
        state,
        port,
        setMode: (mode) => {
          state.mode = mode
        },
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}
