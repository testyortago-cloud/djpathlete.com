/**
 * Seeds the one visitor the Calendly booking acceptance run and screenshots
 * are about, and clears what an earlier run left behind.
 *
 * WHY THIS EXISTS. "A booking made through the assistant appears in the
 * pipeline as a card, exits that person's sequences, and fires the ads
 * conversion" needs a person who HAS a sequence run to exit and an ad click to
 * attribute. The dev clone's fourteen contacts have one active run between
 * them (Maya Sorensen's, from the phase-1 seed) and nobody with a click id, so
 * driving it against them would prove only the empty branches while looking
 * healthy — the "pick the demo subject that lacks the thing" failure.
 *
 * DEV CLONE ONLY. Refuses any other project ref. This writes rows.
 *
 * IDS. Never `aaaaaaaa-0000-4000-8000-…` — those are the phase-1 demo contacts
 * and were destroyed once already by a script that assumed they were
 * placeholders. Every row this script OWNS uses the prefix
 * `ca1e0d1e-0002-4000-8000-` and is deleted by id.
 *
 * WHAT ELSE THE CLEAR TOUCHES, so nobody is surprised (all dev clone only):
 *   - bookings whose calendly_event_uri starts with the acceptance run's
 *     `…/scheduled_events/DEMO-` prefix, and their conversion uploads — the
 *     webhook wrote those, so they carry its key, not the id prefix;
 *   - every LOCAL chat conversation from the last hour (the rate-limit
 *     bucket, see clearPrevious), whoever started it on this machine;
 *   - `system_settings.chat_assistant_enabled` is set TRUE and never set back.
 *
 * IDEMPOTENT. Clear, then insert. Safe to re-run.
 *
 * Run: node scripts/seed-calendly-booking-demo.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { createHash } from "node:crypto"
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

// The prefix every row this script owns carries. The delete below is BY PREFIX.
export const DEMO_PREFIX = "ca1e0d1e-0002-4000-8000-"
export const DEMO_CONTACT = `${DEMO_PREFIX}000000000001`
export const DEMO_RUN = `${DEMO_PREFIX}000000000011`
export const DEMO_ATTRIBUTION = `${DEMO_PREFIX}000000000021`
export const DEMO_SESSION = "ca1e0d1e-demo-session-0001" // the djp_attr cookie value the browser will carry
export const DEMO_GCLID = "CaLeNdLyDemoGclid0001_ab-cd"
export const DEMO_EMAIL = "noor.haddad@djpathlete.demo"
export const DEMO_NAME = "Noor Haddad"
export const DEMO_PHONE = "+16175550142"

async function must(label, promise) {
  const { data, error } = await promise
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function clearPrevious() {
  // Bookings a previous acceptance run created (the webhook writes them with a
  // DEMO- scheduled_event URI), and their conversion uploads, in dependency
  // order. Bookings have no contact_id, so they are found by the key the
  // webhook wrote, not by the contact.
  const bookings = await must(
    "read demo bookings",
    supabase.from("bookings").select("id").like("calendly_event_uri", "https://api.calendly.com/scheduled_events/DEMO-%"),
  )
  const bookingIds = (bookings ?? []).map((b) => b.id)
  if (bookingIds.length > 0) {
    await must("delete demo conversion uploads", supabase.from("google_ads_conversion_uploads").delete().in("source_id", bookingIds))
    await must("delete demo bookings", supabase.from("bookings").delete().in("id", bookingIds))
  }
  // Everything hanging off the demo contact. Chat rows and opportunities
  // cascade or set-null from contacts, but deleting them by hand keeps the
  // run readable in the admin screens.
  await must("delete demo opportunities", supabase.from("opportunities").delete().eq("contact_id", DEMO_CONTACT))
  await must("delete demo runs", supabase.from("sequence_runs").delete().eq("contact_id", DEMO_CONTACT))
  const convs = await must("read demo conversations", supabase.from("chat_conversations").select("id").eq("contact_id", DEMO_CONTACT))
  const convIds = (convs ?? []).map((c) => c.id)
  if (convIds.length > 0) {
    await must("delete demo chat messages", supabase.from("chat_messages").delete().in("conversation_id", convIds))
    await must("delete demo conversations", supabase.from("chat_conversations").delete().in("id", convIds))
  }
  await must("delete demo attribution", supabase.from("marketing_attribution").delete().like("session_id", "ca1e0d1e-demo-session-%"))
  // The contact itself; its event/consent/tag children cascade from the FK.
  // `id` is a uuid, which LIKE cannot scan — so the prefix rule is enforced by
  // construction (every id above is DEMO_PREFIX + a suffix) and the delete
  // names the ids explicitly.
  await must("delete demo contact", supabase.from("contacts").delete().in("id", [DEMO_CONTACT]))

  // THE LOCAL RATE-LIMIT WINDOW. /api/ask keys its per-hour limits (5 new
  // conversations, 40 messages) on sha256(ip + CHAT_IP_SALT). Under `next dev`
  // the request arrives with `x-forwarded-for: ::1`, so every local browser,
  // script and Playwright run on this machine hashes to ONE bucket, and two
  // acceptance runs in an hour hit 429 on the third conversation. (A bare curl
  // with no forwarded header hashes the literal "unknown" instead — the first
  // version of this block cleared only that one and cleared nothing, every
  // time, while printing "cleared 0"; measured 2026-09-03 by grouping
  // chat_conversations by ip_hash.) Clearing every local spelling's rows — and
  // only those — keeps the run repeatable without touching anything a remote
  // visitor created. Dev clone only, like everything here.
  const salt = process.env.CHAT_IP_SALT
  if (salt) {
    const localHashes = ["::1", "127.0.0.1", "::ffff:127.0.0.1", "unknown"].map((ip) =>
      createHash("sha256").update(`${ip}${salt}`).digest("hex"),
    )
    const since = new Date(Date.now() - 3_600_000).toISOString()
    const local = await must(
      "read local conversations",
      supabase.from("chat_conversations").select("id").in("ip_hash", localHashes).gte("created_at", since),
    )
    const localIds = (local ?? []).map((c) => c.id)
    if (localIds.length > 0) {
      await must("delete local chat messages", supabase.from("chat_messages").delete().in("conversation_id", localIds))
      await must("delete local conversations", supabase.from("chat_conversations").delete().in("id", localIds))
    }
    console.log(`  cleared ${localIds.length} local conversation(s) from the last hour (rate-limit bucket)`)
  }
  console.log(`  cleared ${bookingIds.length} booking(s), ${convIds.length} conversation(s), and the demo contact`)
}

async function seed() {
  await must(
    "insert demo contact",
    supabase.from("contacts").insert({
      id: DEMO_CONTACT,
      business_id: BUSINESS,
      email: DEMO_EMAIL,
      phone_e164: DEMO_PHONE,
      name: DEMO_NAME,
      first_touch_session_id: DEMO_SESSION,
      timezone: "America/New_York",
    }),
  )

  // The sequence she must EXIT when she books. The clone's one active
  // sequence; a draft one would never have enrolled her.
  const seq = await must(
    "read active sequence",
    supabase.from("sequences").select("id, key").eq("business_id", BUSINESS).eq("status", "active").limit(1).maybeSingle(),
  )
  if (!seq) throw new Error("no active sequence on the dev clone — cannot demonstrate the exit")
  await must(
    "insert demo run",
    supabase.from("sequence_runs").insert({
      id: DEMO_RUN,
      business_id: BUSINESS,
      sequence_id: seq.id,
      contact_id: DEMO_CONTACT,
      current_position: 1,
      status: "active",
      next_run_at: new Date(Date.now() + 86_400_000).toISOString(),
      attempts: 0,
      enrolled_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    }),
  )

  // The ad click that brought her. The browser will present DEMO_SESSION as its
  // djp_attr cookie; the chat conversation records it; book_consult reads this
  // row through it and puts the gclid on the scheduling link.
  await must(
    "insert demo attribution",
    supabase.from("marketing_attribution").insert({
      id: DEMO_ATTRIBUTION,
      session_id: DEMO_SESSION,
      gclid: DEMO_GCLID,
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "consult-demo",
      landing_url: "http://localhost:3050/?gclid=" + DEMO_GCLID,
      first_seen_at: new Date(Date.now() - 3_600_000).toISOString(),
      last_seen_at: new Date().toISOString(),
    }),
  )

  // The assistant is off by default and 404s when off. Turned on here because
  // the acceptance run drives /ask; the flag is a dev-clone row.
  await must(
    "enable chat assistant",
    supabase
      .from("system_settings")
      .upsert({ key: "chat_assistant_enabled", value: true, updated_at: new Date().toISOString() }, { onConflict: "key" }),
  )

  console.log(`  contact   ${DEMO_CONTACT}  ${DEMO_NAME} <${DEMO_EMAIL}> ${DEMO_PHONE}`)
  console.log(`  run       ${DEMO_RUN}  active on ${seq.key}`)
  console.log(`  attribution session ${DEMO_SESSION}  gclid ${DEMO_GCLID}`)
  console.log(`  chat_assistant_enabled = true`)
}

// Is the ads path live on this clone? enqueueBookingConversion no-ops without
// an active account AND an active booking_created action. Report, don't seed:
// those rows are Google Ads configuration and this script must not invent them.
async function reportAdsReadiness() {
  const accounts = await must("read ads accounts", supabase.from("google_ads_accounts").select("customer_id").eq("is_active", true))
  const active = accounts?.[0]?.customer_id ?? null
  const action = active
    ? await must(
        "read booking action",
        supabase
          .from("google_ads_conversion_actions")
          .select("conversion_action_id")
          .eq("customer_id", active)
          .eq("trigger_type", "booking_created")
          .eq("is_active", true)
          .maybeSingle(),
      )
    : null
  if (active && action) {
    console.log(`  ads: account ${active} has active booking_created action ${action.conversion_action_id} — the conversion WILL enqueue`)
  } else {
    console.log(`  ads: NO active account/booking_created action — the conversion will no-op (acceptance will report it)`)
  }
}

/** Clear + seed, for the acceptance and screenshot scripts to call between runs. */
export async function resetDemo() {
  await clearPrevious()
  await seed()
  await reportAdsReadiness()
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  console.log("Seeding the Calendly booking demo on the dev clone…")
  await resetDemo()
  console.log("done")
}
