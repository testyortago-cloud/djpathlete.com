/**
 * Seeds the two contacts the /admin/contacts/[id] screenshots are taken of.
 *
 * WHY THIS EXISTS. The dev clone can show the contact record's timeline and
 * consent panels, but not the rest: all 12 of its contacts have `user_id = null`
 * (so the payments join yields nothing for anybody), there are zero
 * `sequence_runs`, zero `contact_suppressions`, and its four real `bookings`
 * rows carry identifiers no contact holds. Screenshotting as-is would document
 * only the EMPTY branch of every panel while looking perfectly healthy — the
 * "pick the demo subject that lacks the thing" failure, inverted.
 *
 * DEV CLONE ONLY. Refuses to run against anything but the dev project ref, and
 * refuses if the env somehow points at production. This writes rows; it must
 * never be pointed at real data.
 *
 * REAL DATA WHERE REAL DATA EXISTS. The rich contact is deliberately given the
 * phone number that the clone's four GENUINE GoHighLevel bookings already
 * carry — stored by that webhook in US national format, "(617) 650-4548".
 * The contact stores E.164, "+16176504548". Those two strings are not equal,
 * which is the entire reason lib/db/contact-detail.ts normalises both sides
 * instead of using `.eq()`. So the booking rows on the screenshot are real,
 * and they demonstrate the exact comparison the naive implementation gets
 * wrong. Nothing about the bookings is fabricated.
 *
 * The payments are likewise not invented: the contact is linked to an existing
 * seeded `users` row that already has three `payments`.
 *
 * IDEMPOTENT. Safe to re-run; every write is an upsert or is guarded.
 *
 * Run: node scripts/seed-contact-record-demo.mjs
 */
import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), quiet: true })

const DEV_REF = "anjvztjiokcgiyhobknq"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const ref = new URL(url).hostname.split(".")[0]

if (ref !== DEV_REF) {
  console.error(`REFUSING TO RUN. This script writes rows and is for the dev clone only.`)
  console.error(`  expected project ref: ${DEV_REF}`)
  console.error(`  .env.local points at: ${ref || "(nothing)"}`)
  process.exit(1)
}

const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUSINESS = "00000000-0000-0000-0000-000000000001"

// The seeded user that already owns three `payments` rows.
const PAYING_USER = "c99f334b-8b16-4cb0-a57d-6e407e6c224e"
// The phone the clone's four real GoHighLevel bookings carry, in E.164.
const BOOKED_PHONE = "+16176504548"

const RICH = "aaaaaaaa-0000-4000-8000-000000000001"
const BARE = "aaaaaaaa-0000-4000-8000-000000000002"

async function must(label, promise) {
  const { data, error } = await promise
  if (error) {
    console.error(`${label}: ${error.message}`)
    process.exit(1)
  }
  return data
}

// ---------------------------------------------------------------- contacts

await must(
  "upsert contacts",
  supabase.from("contacts").upsert(
    [
      {
        id: RICH,
        business_id: BUSINESS,
        user_id: PAYING_USER,
        name: "Maya Sorensen",
        email: "maya.sorensen@djpathlete.demo",
        phone_e164: BOOKED_PHONE,
        created_at: "2026-06-14T09:12:00Z",
        updated_at: "2026-08-28T16:40:00Z",
      },
      {
        // The BARE control. Every panel on this one is legitimately empty, and
        // an empty-state screenshot is only meaningful next to a full one.
        id: BARE,
        business_id: BUSINESS,
        user_id: null,
        name: "Tobias Frei",
        email: "tobias.frei@djpathlete.demo",
        phone_e164: null,
        created_at: "2026-08-30T11:05:00Z",
        updated_at: "2026-08-30T11:05:00Z",
      },
    ],
    { onConflict: "id" },
  ),
)

// ---------------------------------------------------------------- timeline

await must("clear timeline", supabase.from("contact_timeline_events").delete().eq("contact_id", RICH))
await must(
  "seed timeline",
  supabase.from("contact_timeline_events").insert([
    {
      business_id: BUSINESS, contact_id: RICH, kind: "entry_point", source: "newsletter",
      occurred_at: "2026-06-14T09:12:00Z", metadata: {},
    },
    {
      business_id: BUSINESS, contact_id: RICH, kind: "entry_point", source: "quiz",
      occurred_at: "2026-06-28T18:30:00Z", metadata: { quiz: "readiness" },
    },
    {
      // Exercises the masking branch: this metadata holds a SECOND person's
      // raw email address, and the screen must not print it.
      business_id: BUSINESS, contact_id: RICH, kind: "identifier_conflict", source: "funnel_form",
      occurred_at: "2026-07-02T13:05:00Z",
      metadata: { field: "email", submitted: "maya.private@icloud.com", existing: "maya.sorensen@djpathlete.demo" },
    },
    {
      business_id: BUSINESS, contact_id: RICH, kind: "sms_consent_confirmed", source: "sms_consent_link",
      occurred_at: "2026-07-09T15:22:00Z", metadata: {},
    },
    {
      business_id: BUSINESS, contact_id: RICH, kind: "sms_inbound", source: "twilio_inbound_webhook",
      occurred_at: "2026-07-30T10:02:00Z",
      metadata: { body: "Can we move Thursday's call to the afternoon?" },
    },
    {
      business_id: BUSINESS, contact_id: RICH, kind: "chat_escalated", source: "ai_chat",
      occurred_at: "2026-08-11T20:14:00Z", metadata: {},
    },
    {
      business_id: BUSINESS, contact_id: RICH, kind: "sms_stop_received", source: "twilio_inbound_webhook",
      occurred_at: "2026-08-28T16:40:00Z", metadata: {},
    },
  ]),
)

// ----------------------------------------------------------------- consent

await must("clear consents", supabase.from("contact_consents").delete().eq("contact_id", RICH))
await must(
  "seed consents",
  supabase.from("contact_consents").insert([
    {
      business_id: BUSINESS, contact_id: RICH, channel: "email", granted: true, source: "newsletter",
      wording_shown: "Yes, send me training tips and news about camps. I can unsubscribe at any time.",
      occurred_at: "2026-06-14T09:12:00Z",
    },
    {
      business_id: BUSINESS, contact_id: RICH, channel: "sms", granted: true, source: "sms_consent_link",
      wording_shown: "Text me about my sessions and camp places. Message and data rates may apply. Reply STOP to opt out.",
      occurred_at: "2026-07-09T15:22:00Z",
    },
  ]),
)

// SUPPRESSION. Keyed by identifier, not contact — which is the whole point of
// the separate table, and why the screen shows it as its own section.
await must(
  "seed suppression",
  supabase.from("contact_suppressions").upsert(
    [{ business_id: BUSINESS, identifier: BOOKED_PHONE.toLowerCase(), reason: "sms_stop", created_at: "2026-08-28T16:40:00Z" }],
    { onConflict: "business_id,identifier" },
  ),
)

// -------------------------------------------------------------------- tags

await must("clear tags", supabase.from("contact_tags").delete().eq("contact_id", RICH))
await must(
  "seed tags",
  supabase.from("contact_tags").insert([
    { business_id: BUSINESS, contact_id: RICH, tag: "coaching-lead" },
    { business_id: BUSINESS, contact_id: RICH, tag: "camp-2026" },
  ]),
)

// ------------------------------------------------------------------ report

const { count: bookingMatches } = await supabase
  .from("bookings")
  .select("id", { count: "exact", head: true })
  .eq("contact_phone", "(617) 650-4548")

console.log(`Seeded on ${ref}:`)
console.log(`  RICH  ${RICH}  Maya Sorensen`)
console.log(`        payments via user_id ${PAYING_USER}`)
console.log(`        ${bookingMatches ?? 0} real GHL booking(s) match on phone (national format, normalised at read time)`)
console.log(`  BARE  ${BARE}  Tobias Frei  (every panel legitimately empty)`)
console.log(``)
console.log(`  /admin/contacts/${RICH}`)
console.log(`  /admin/contacts/${BARE}`)
