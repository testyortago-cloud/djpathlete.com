// scripts/calendly-setup.mjs — the owner-run half of the Calendly cut-over.
//
// Answers the account questions the spec (§3.1) could not answer from this
// repo, because no Calendly credential exists anywhere in it:
//
//   node scripts/calendly-setup.mjs
//     Read-only. Prints who the token belongs to, every event type on the
//     account with BOTH its API URI (for CALENDLY_EVENT_TYPE_URI) and its
//     public page (for CALENDLY_SCHEDULING_URL), the existing webhook
//     subscriptions, and Calendly's own sample webhook payload so the shape
//     app/api/webhooks/calendly/route.ts parses can be eyeballed against the
//     real thing before the first live booking.
//
//   node scripts/calendly-setup.mjs --register https://www.example.com
//     Creates the webhook subscription for invitee.created + invitee.canceled
//     at <origin>/api/webhooks/calendly, signed with
//     CALENDLY_WEBHOOK_SIGNING_KEY. A 403 here IS the plan answer: webhooks
//     need a paid Calendly plan (Standard, Teams or Enterprise), and this call
//     failing with 403 on a Free account is how you find out.
//
// Reads CALENDLY_API_TOKEN (and, for --register, CALENDLY_WEBHOOK_SIGNING_KEY)
// from the environment or .env.local. Touches nothing in this app's database.

import { readFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"

const API = process.env.CALENDLY_API_BASE?.trim() || "https://api.calendly.com"

const env = { ...process.env }
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const token = env.CALENDLY_API_TOKEN?.trim()
if (!token) {
  console.error("CALENDLY_API_TOKEN is not set. Create a personal access token at calendly.com → Integrations & apps → API & webhooks, then re-run.")
  process.exit(1)
}

const args = process.argv.slice(2)
const registerIdx = args.indexOf("--register")
const registerOrigin = registerIdx >= 0 ? args[registerIdx + 1] : null
if (registerIdx >= 0 && !registerOrigin) {
  console.error("--register needs the public origin, e.g. --register https://www.example.com")
  process.exit(1)
}

async function calendly(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

console.log(`Calendly API: ${API}\n`)

// 1. Who is this token?
const me = await calendly("/users/me")
if (me.status !== 200) {
  console.error(`GET /users/me → ${me.status}`, JSON.stringify(me.body, null, 2))
  console.error("The token is not accepted. Nothing else can be checked.")
  process.exit(1)
}
const user = me.body.resource
console.log(`Token belongs to: ${user.name} <${user.email}>`)
console.log(`  user URI:         ${user.uri}`)
console.log(`  organization URI: ${user.current_organization}`)
console.log(`  scheduling page:  ${user.scheduling_url}\n`)

// 2. Event types — both URIs, side by side, because they are different things.
const types = await calendly(`/event_types?user=${encodeURIComponent(user.uri)}&active=true&count=50`)
if (types.status !== 200) {
  console.error(`GET /event_types → ${types.status}`, JSON.stringify(types.body, null, 2))
} else {
  console.log("Active event types (pick the consult):")
  for (const t of types.body.collection ?? []) {
    console.log(`  • ${t.name}  (${t.duration} min, ${t.kind})`)
    console.log(`      CALENDLY_EVENT_TYPE_URI=${t.uri}`)
    console.log(`      CALENDLY_SCHEDULING_URL=${t.scheduling_url}`)
  }
  console.log("")
}

// 3. Existing subscriptions.
const subs = await calendly(
  `/webhook_subscriptions?organization=${encodeURIComponent(user.current_organization)}&user=${encodeURIComponent(user.uri)}&scope=user`,
)
if (subs.status === 403) {
  console.log("Webhook subscriptions: 403 — this account's plan does NOT include webhooks (paid Standard/Teams/Enterprise needed).")
  console.log("  Bookings cannot be pushed to the app on this plan; see spec §3.1 for the polling fallback.\n")
} else if (subs.status !== 200) {
  console.log(`Webhook subscriptions: ${subs.status}`, JSON.stringify(subs.body, null, 2), "\n")
} else {
  const list = subs.body.collection ?? []
  console.log(`Webhook subscriptions (${list.length}):`)
  for (const s of list) console.log(`  • ${s.state}  ${s.callback_url}  events=${(s.events ?? []).join(",")}  created=${s.created_at}`)
  console.log("")
}

// 4. Calendly's own sample payload, for eyeballing against the route's schema.
const sample = await calendly(`/webhook_subscriptions/sample_data?event=invitee.created`)
if (sample.status === 200) {
  console.log("Sample invitee.created payload (from Calendly):")
  console.log(JSON.stringify(sample.body, null, 2).split("\n").slice(0, 80).join("\n"))
  console.log("  …\n")
} else {
  console.log(`Sample payload: ${sample.status} (${typeof sample.body === "string" ? sample.body.slice(0, 120) : JSON.stringify(sample.body).slice(0, 200)})\n`)
}

// 5. Optionally register.
if (registerOrigin) {
  let signingKey = env.CALENDLY_WEBHOOK_SIGNING_KEY?.trim()
  if (!signingKey) {
    signingKey = randomBytes(32).toString("hex")
    console.log("CALENDLY_WEBHOOK_SIGNING_KEY was not set. Generated one — SET THIS IN EVERY ENVIRONMENT before the first booking:")
    console.log(`  CALENDLY_WEBHOOK_SIGNING_KEY=${signingKey}\n`)
  }
  const url = `${registerOrigin.replace(/\/$/, "")}/api/webhooks/calendly`
  // A second run must not register a duplicate: Calendly would sign the new
  // subscription's deliveries with THIS key while the app still checks the
  // old one, and every delivery from it would 403 until Calendly gave up.
  const already = subs.status === 200 ? (subs.body.collection ?? []).find((s) => s.callback_url === url && s.state === "active") : null
  if (already && !args.includes("--force")) {
    console.log(`Already registered: ${already.uri} → ${url} (${(already.events ?? []).join(",")}). Nothing created.`)
    console.log("  Pass --force to register another anyway (you will then need to delete one).")
    process.exit(0)
  }
  const created = await calendly("/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url,
      events: ["invitee.created", "invitee.canceled"],
      organization: user.current_organization,
      user: user.uri,
      scope: "user",
      signing_key: signingKey,
    }),
  })
  if (created.status === 201) {
    console.log(`Registered: ${created.body.resource.uri}`)
    console.log(`  → ${url}  events=invitee.created,invitee.canceled  state=${created.body.resource.state}`)
  } else if (created.status === 403) {
    console.error(`POST /webhook_subscriptions → 403. This plan does not include webhooks. Nothing was registered.`)
    console.error(JSON.stringify(created.body, null, 2))
    process.exit(2)
  } else {
    console.error(`POST /webhook_subscriptions → ${created.status}`, JSON.stringify(created.body, null, 2))
    process.exit(2)
  }
}
