/**
 * Seeds the text conversations the /admin/sms screenshots are taken of.
 *
 * WHY THIS EXISTS. `sms_messages` is empty on the dev clone — every row of it
 * on production arrives from Twilio, and Twilio is not something a screenshot
 * run may touch. Capturing as-is would document the EMPTY branch of every
 * screen while looking perfectly healthy: "no text conversations yet" is
 * indistinguishable from a broken tenant predicate.
 *
 * DEV CLONE ONLY. Refuses outright if `.env.local` does not point at the dev
 * project ref. This script WRITES ROWS; it must never reach real data.
 *
 * NO TEXT IS EVER SENT. Nothing here calls Twilio. Every row is written
 * straight into `sms_messages` as a record of a message, exactly as the
 * inbound webhook and `sendManualSms` would have written it.
 *
 * PHONE NUMBERS. `+1555…` IS NOT A FAKE NUMBER, IT IS AN INVALID ONE — 555 is
 * not an assigned NANP area code, so `normalisePhone` (libphonenumber) returns
 * null for it and /admin/sms/[phone] answers 404 rather than rendering the
 * thread. The reserved-for-fiction range is 555 as the EXCHANGE behind a real
 * area code: +1 202 555 xxxx, +1 310 555 xxxx. Those parse, and they are not
 * anybody's number.
 *
 * THE MESSAGING SERVICE SID IS DELIBERATELY FAKE AND DELIBERATELY SET.
 * `business_settings.sms_messaging_service_sid` is empty on this clone, which
 * makes `smsConfigured()` false, which renders the compose box in its
 * "Texting is not set up for this business yet" state — the wrong screen to
 * document. `MGdev0000000000000000000000000000` is shaped like a Twilio
 * Messaging Service SID and belongs to nobody, so the UI switches on while any
 * actual send still dies at Twilio instead of reaching a handset. The real
 * production SID must never be written here.
 *
 * IDEMPOTENT. Contacts are upserted on fixed ids; the seeded threads are
 * deleted by phone and rewritten. Safe to re-run.
 *
 * Run: node scripts/seed-sms-thread-dev.mjs
 */
import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), quiet: true })

// ---------------------------------------------------------------- the guard
const DEV_REF = "anjvztjiokcgiyhobknq"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
let ref = ""
try {
  ref = new URL(url).hostname.split(".")[0]
} catch {
  ref = ""
}

if (ref !== DEV_REF) {
  console.error("REFUSING TO RUN. This script writes rows and is for the dev clone only.")
  console.error(`  expected project ref: ${DEV_REF}`)
  console.error(`  env points at:        ${ref || "(nothing)"}`)
  process.exit(1)
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("REFUSING TO RUN. SUPABASE_SERVICE_ROLE_KEY is not set.")
  process.exit(1)
}

const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Primary — the business the operator's admin lands on with the djp_business
// cookie set. Printed below so the capture script and this script cannot
// disagree about which tenant was seeded.
const BUSINESS = "00000000-0000-0000-0000-000000000001"

const FAKE_MESSAGING_SERVICE_SID = "MGdev0000000000000000000000000000"

// Reserved-for-fiction exchanges behind real area codes. These parse.
const TALKING = "+12025550123" // the live conversation
const STOPPED = "+13105550198" // replied STOP, now suppressed
const STRANGER = "+14155550132" // nobody has this one on file

const DANA = "5b5c0000-0000-4000-8000-000000000101"
const MARCUS = "5b5c0000-0000-4000-8000-000000000102"

/**
 * A real timezone in which it is CURRENTLY outside the tenant's 8am–9pm
 * window, so the composer's quiet-hours warning is reachable at capture time.
 *
 * The composer reads the hour where the CONTACT is (`resolveTimezone`: the
 * contact's own zone, else the business's). Hard-coding one zone would make
 * the warning appear or not appear depending on what time of day the script
 * happened to run, which is exactly the kind of "worked when I ran it"
 * screenshot this repo has been burned by.
 *
 * It picks the quiet zone with the LONGEST RUNWAY, not simply the first one
 * that qualifies. Capturing happens minutes after seeding, and a zone that is
 * quiet for five more minutes is a shot that fails halfway through the run —
 * the first version of this function handed back America/Anchorage at 07:55
 * against an 8am window.
 */
function pickQuietZone(startHour, endHour) {
  const candidates = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ]
  const wraps = startHour >= endHour
  let best = { zone: null, hour: null, runwayMinutes: -1 }
  for (const zone of candidates) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date())
    const hour = Number(parts.find((p) => p.type === "hour").value)
    const minute = Number(parts.find((p) => p.type === "minute").value)
    const allowed = wraps ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour
    if (allowed) continue
    // Minutes from now until the sending window opens again in this zone.
    const runwayMinutes = (startHour * 60 - (hour * 60 + minute) + 1440) % 1440
    if (runwayMinutes > best.runwayMinutes) best = { zone, hour, runwayMinutes }
  }
  return best
}

/** ISO timestamp `minutes` before now. */
function ago(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

async function main() {
  console.log(`dev clone ${ref}`)
  console.log(`business_id ${BUSINESS}`)

  // ------------------------------------------------- 1. the texting sender
  const settings = await supabase
    .from("business_settings")
    .select("timezone, quiet_hours_start, quiet_hours_end, sms_messaging_service_sid, sms_sender_phone")
    .eq("business_id", BUSINESS)
    .single()
  if (settings.error) throw new Error(`business_settings read failed: ${settings.error.message}`)

  const quietStart = settings.data.quiet_hours_start ?? 8
  const quietEnd = settings.data.quiet_hours_end ?? 21

  const setSid = await supabase
    .from("business_settings")
    .update({ sms_messaging_service_sid: FAKE_MESSAGING_SERVICE_SID })
    .eq("business_id", BUSINESS)
  if (setSid.error) throw new Error(`business_settings update failed: ${setSid.error.message}`)
  console.log(`sms_messaging_service_sid = ${FAKE_MESSAGING_SERVICE_SID}  (fake, dev-only)`)
  console.log(`timezone ${settings.data.timezone} · quiet hours ${quietStart}:00–${quietEnd}:00`)

  // --------------------------------------------------------- 2. the people
  const { zone: quietZone, hour: quietHour, runwayMinutes } = pickQuietZone(quietStart, quietEnd)
  if (quietZone) {
    console.log(
      `quiet-hours contact zone ${quietZone} (locally ${quietHour}:00 — outside the window for another ${runwayMinutes} min)`,
    )
    if (runwayMinutes < 20) {
      console.warn("  !! LESS THAN 20 MINUTES OF RUNWAY. Capture shot 05 now or re-run this script later.")
    }
  } else {
    console.warn(
      "  !! NO CANDIDATE ZONE IS CURRENTLY IN QUIET HOURS. The quiet-hours warning will NOT appear; " +
        "re-run this script outside 8am–9pm across the US and capture 05 again.",
    )
  }

  const contacts = [
    {
      id: DANA,
      business_id: BUSINESS,
      name: "Dana Okafor",
      email: "dana.okafor@djpathlete.demo",
      phone_e164: TALKING,
      timezone: quietZone,
    },
    {
      id: MARCUS,
      business_id: BUSINESS,
      name: "Marcus Ferreira",
      email: "marcus.ferreira@djpathlete.demo",
      phone_e164: STOPPED,
      timezone: "America/Chicago",
    },
  ]
  const upserted = await supabase.from("contacts").upsert(contacts, { onConflict: "id" }).select("id, phone_e164")
  if (upserted.error) throw new Error(`contacts upsert failed: ${upserted.error.message}`)
  console.log(`contacts upserted: ${upserted.data.map((c) => `${c.id.slice(0, 8)}→${c.phone_e164}`).join(", ")}`)

  // ------------------------------------------------------ 3. the suppression
  // Marcus texted STOP. The row is what makes the compose box refuse, and it
  // is keyed on the lowercased identifier exactly as `suppress()` writes it.
  const supp = await supabase
    .from("contact_suppressions")
    .upsert(
      { business_id: BUSINESS, identifier: STOPPED, reason: "sms_stop" },
      { onConflict: "business_id,identifier" },
    )
  if (supp.error) throw new Error(`contact_suppressions upsert failed: ${supp.error.message}`)
  console.log(`suppressed ${STOPPED} (reason sms_stop)`)

  // ---------------------------------------------------------- 4. the texts
  const wipe = await supabase
    .from("sms_messages")
    .delete()
    .eq("business_id", BUSINESS)
    .in("phone", [TALKING, STOPPED, STRANGER])
  if (wipe.error) throw new Error(`sms_messages wipe failed: ${wipe.error.message}`)

  const messages = [
    // A live conversation. Both directions, one send that failed at the
    // carrier, and the newest message last.
    {
      business_id: BUSINESS,
      contact_id: DANA,
      phone: TALKING,
      direction: "outbound",
      body: "Hi Dana, it's Darren from DJP Athlete. Thanks for filling in the form. What's the one thing you'd most like to fix in the next 12 weeks?",
      status: "delivered",
      twilio_sid: "SMdev00000000000000000000000000a1",
      occurred_at: ago(2880),
    },
    {
      business_id: BUSINESS,
      contact_id: DANA,
      phone: TALKING,
      direction: "inbound",
      body: "Hey Darren. My squat, honestly. I've been stuck at 205 since May and my knees ache for two days after every heavy session.",
      status: "received",
      twilio_sid: "SMdev00000000000000000000000000a2",
      occurred_at: ago(2835),
    },
    {
      business_id: BUSINESS,
      contact_id: DANA,
      phone: TALKING,
      direction: "outbound",
      body: "That combination usually means the bar is drifting forward, not that you're out of strength. Can you film one set at 185 and send it over?",
      status: "delivered",
      twilio_sid: "SMdev00000000000000000000000000a3",
      occurred_at: ago(2820),
    },
    {
      business_id: BUSINESS,
      contact_id: DANA,
      phone: TALKING,
      direction: "inbound",
      body: "Just sent it to your email. Warning: it is not pretty.",
      status: "received",
      twilio_sid: "SMdev00000000000000000000000000a4",
      occurred_at: ago(1500),
    },
    {
      business_id: BUSINESS,
      contact_id: DANA,
      phone: TALKING,
      direction: "outbound",
      body: "Watched it. Nothing wrong with your legs. You're losing the brace at the bottom, which is why it stalls and why your knees take the load. I've put a three-week fix in your plan.",
      status: "delivered",
      twilio_sid: "SMdev00000000000000000000000000a5",
      occurred_at: ago(1440),
    },
    {
      // The one that never arrived. 30006 is Twilio's "landline or
      // unreachable carrier" — the screen exists to make this visible,
      // because "I texted them and they never replied" and "the message
      // never landed" are different conversations.
      business_id: BUSINESS,
      contact_id: DANA,
      phone: TALKING,
      direction: "outbound",
      body: "Quick one before Tuesday: bring flat shoes, we're re-testing the squat at the end of the session.",
      status: "failed",
      error_code: "30006",
      twilio_sid: "SMdev00000000000000000000000000a6",
      occurred_at: ago(180),
    },

    // Someone who opted out. This is what makes the refusal state real
    // rather than a suppression row with no story behind it.
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      phone: STOPPED,
      direction: "outbound",
      body: "Hi Marcus, Darren here from DJP Athlete. You asked about the off-season block — want me to send the outline over?",
      status: "delivered",
      twilio_sid: "SMdev00000000000000000000000000b1",
      occurred_at: ago(5760),
    },
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      phone: STOPPED,
      direction: "inbound",
      body: "Yes please",
      status: "received",
      twilio_sid: "SMdev00000000000000000000000000b2",
      occurred_at: ago(5700),
    },
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      phone: STOPPED,
      direction: "outbound",
      body: "Sent it to your email. Have a read and tell me which of the two lifting days suits your week better.",
      status: "delivered",
      twilio_sid: "SMdev00000000000000000000000000b3",
      occurred_at: ago(5690),
    },
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      phone: STOPPED,
      direction: "inbound",
      body: "STOP",
      status: "received",
      twilio_sid: "SMdev00000000000000000000000000b4",
      occurred_at: ago(4320),
    },

    // A number nobody has on file. The thread list falls back to the number
    // and says "Not in your contacts" — a text from a stranger is still a
    // conversation, which is why the thread is keyed on phone, not contact.
    {
      business_id: BUSINESS,
      contact_id: null,
      phone: STRANGER,
      direction: "inbound",
      body: "Hi, is this the coach my brother trains with? He said to text this number about the Saturday group.",
      status: "received",
      twilio_sid: "SMdev00000000000000000000000000c1",
      occurred_at: ago(95),
    },
  ]

  const inserted = await supabase.from("sms_messages").insert(messages).select("id")
  if (inserted.error) throw new Error(`sms_messages insert failed: ${inserted.error.message}`)
  console.log(`sms_messages inserted: ${inserted.data.length}`)

  // ------------------------------------------- 5. how these two got here
  // The contact record screen is one of the shots, and a person with a live
  // text conversation and a blank history is not a person — it is a seeding
  // artefact that happens to render. Every `kind` and `source` below is one
  // the real describeEvent() in lib/db/contact-detail.ts already has a
  // sentence for; nothing invents a new vocabulary word for the screenshot.
  const wipeEvents = await supabase
    .from("contact_timeline_events")
    .delete()
    .eq("business_id", BUSINESS)
    .in("contact_id", [DANA, MARCUS])
  if (wipeEvents.error) throw new Error(`timeline wipe failed: ${wipeEvents.error.message}`)

  const events = [
    {
      business_id: BUSINESS,
      contact_id: DANA,
      kind: "entry_point",
      source: "funnel_form",
      occurred_at: ago(4400),
      metadata: {},
    },
    {
      business_id: BUSINESS,
      contact_id: DANA,
      kind: "sms_consent_confirmed",
      source: "funnel_form",
      occurred_at: ago(4400),
      metadata: {},
    },
    {
      business_id: BUSINESS,
      contact_id: DANA,
      kind: "sms_inbound",
      source: "twilio",
      occurred_at: ago(2835),
      metadata: { body: messages[1].body },
    },
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      kind: "entry_point",
      source: "lead_magnet",
      occurred_at: ago(7200),
      metadata: {},
    },
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      kind: "sms_stop_received",
      source: "twilio",
      occurred_at: ago(4320),
      metadata: {},
    },
  ]
  const eventsIns = await supabase.from("contact_timeline_events").insert(events).select("id")
  if (eventsIns.error) throw new Error(`timeline insert failed: ${eventsIns.error.message}`)

  // The consent evidence panel. Append-only: Marcus's "granted" stays on file
  // underneath his later withdrawal, which is the honest shape of somebody who
  // signed up and later texted STOP.
  const wipeConsents = await supabase
    .from("contact_consents")
    .delete()
    .eq("business_id", BUSINESS)
    .in("contact_id", [DANA, MARCUS])
  if (wipeConsents.error) throw new Error(`consents wipe failed: ${wipeConsents.error.message}`)

  const consentWording =
    "Text me about coaching. Message and data rates may apply. Reply STOP at any time to stop receiving texts."
  const consents = [
    {
      business_id: BUSINESS,
      contact_id: DANA,
      channel: "sms",
      granted: true,
      source: "funnel_form",
      wording_shown: consentWording,
      occurred_at: ago(4400),
    },
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      channel: "sms",
      granted: true,
      source: "lead_magnet",
      wording_shown: consentWording,
      occurred_at: ago(7200),
    },
    {
      business_id: BUSINESS,
      contact_id: MARCUS,
      channel: "sms",
      granted: false,
      source: "sms_stop",
      wording_shown: consentWording,
      occurred_at: ago(4320),
    },
  ]
  const consentsIns = await supabase.from("contact_consents").insert(consents).select("id")
  if (consentsIns.error) throw new Error(`consents insert failed: ${consentsIns.error.message}`)
  console.log(`timeline events ${eventsIns.data.length} · consent rows ${consentsIns.data.length}`)

  // ------------------------------------------------------- 6. read it back
  // The script's own report is not evidence. Read the rows from the database.
  const back = await supabase
    .from("sms_messages")
    .select("phone, direction, status, error_code, contact_id, occurred_at")
    .eq("business_id", BUSINESS)
    .in("phone", [TALKING, STOPPED, STRANGER])
    .order("occurred_at", { ascending: true })
  if (back.error) throw new Error(`read-back failed: ${back.error.message}`)

  console.log("\nread back from the database:")
  for (const phone of [TALKING, STOPPED, STRANGER]) {
    const rows = back.data.filter((r) => r.phone === phone)
    const out = rows.filter((r) => r.direction === "outbound").length
    const inb = rows.filter((r) => r.direction === "inbound").length
    const failed = rows.filter((r) => r.status === "failed").map((r) => r.error_code)
    console.log(`  ${phone}  ${rows.length} texts (${out} out / ${inb} in)  failed=[${failed.join(",")}]`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
