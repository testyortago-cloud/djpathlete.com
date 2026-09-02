// lib/db/contact-detail.ts — one person's whole history, assembled.
//
// THE TIMELINE IS A UNION OF THREE SOURCES, NOT A SELECT. Migration 00214's own
// header is the thing to read before changing this file:
//
//   "Reads across both identity spines — contact-native events here, plus the
//    payments and bookings that still hang off users."
//
// `contact_timeline_events` has every form, text and chat. It does NOT have the
// money. Payments hang off `users`, reachable only through `contacts.user_id`,
// which is nullable and null for most leads. Bookings hang off nothing at all —
// `bookings` has no `contact_id` (migration 00050 predates the contact spine),
// so they are matched on the identifiers instead. A screen that selects from
// contact_timeline_events alone shows the forms and silently omits the payments
// and the booked calls, which is the half the customer was actually sold.
//
// ---------------------------------------------------------------------------
// HOW A BOOKING IS MATCHED TO A CONTACT, and why it is not `.eq()`
// ---------------------------------------------------------------------------
// The design note for this phase said to "reuse the predicate in
// getBookingsForPipelineReconcile". There is no predicate in it — that function
// is a pure window read (`.in("status", …).gte("created_at", …)`, lib/db/bookings.ts)
// and the matching happens per-row in lib/automation/pipeline-reconcile.ts, which
// calls `findContactByIdentifiers` and therefore normalises the BOOKING side at
// read time. That direction is booking -> contact. This screen needs the
// opposite, and the naive inversion is broken three separate ways:
//
//   * PHONE. `bookings.contact_phone` is stored in US national format, exactly
//     as GoHighLevel sent it — "(617) 650-4548" is a real row on the dev clone.
//     `contacts.phone_e164` holds "+16176504548". `.eq()` between them matches
//     ZERO rows, always, and reads on screen as "this person never booked".
//   * EMAIL. `bookings.contact_email` is inserted raw-cased
//     (app/api/webhooks/ghl-booking/route.ts), while `contacts.email` is
//     lowercased on write. `.eq()` silently drops the mixed-case ones.
//   * `.ilike()` IS NOT THE FIX, it is a disclosure. PostgREST cannot apply
//     `lower()` to the column side, so `ilike` looks tempting — but `_` and `%`
//     are LIKE wildcards and both are legal characters in the emails
//     `EMAIL_RE` accepts (lib/lead-engine/identity.ts). `a_b@x.com` would then
//     match `axb@x.com`, putting a DIFFERENT person's booked calls on this
//     person's record. On a screen whose whole purpose is one individual's
//     history, that is the worst possible bug.
//
// So both sides are normalised in TypeScript through the same
// `normaliseEmail` / `normalisePhone` the writes use, and compared exactly.
// That is not a second definition of "this person's bookings" — it is the same
// definition the reconciler uses, applied in the other direction. The
// comparison is pure and unit-tested without a database (`bookingMatchesContact`).
//
// The cost is that the bookings window is read and filtered in memory. That is
// exactly what the reconciler already does, and `bookings` is a consult table,
// not an event log. The cap is stated and ordered so that if it is ever
// reached, it is the OLDEST bookings that fall out of view, never the newest.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { maskEmail, maskPhone } from "@/lib/lead-engine/mask"

function getClient() {
  return createServiceRoleClient()
}

/* ------------------------------------------------------------------ types */

export interface ContactRecord {
  id: string
  business_id: string
  user_id: string | null
  name: string | null
  email: string | null
  phone_e164: string | null
  created_at: string
  updated_at: string
  timezone: string | null
}

export interface TimelineEventRow {
  id: string
  kind: string
  source: string
  occurred_at: string
  metadata: Record<string, unknown>
  scrubbed_at: string | null
}

export interface PaymentRow {
  id: string
  amount_cents: number
  currency: string
  status: string
  description: string | null
  created_at: string
}

export interface BookingRow {
  id: string
  contact_email: string
  contact_phone: string | null
  booking_date: string
  duration_minutes: number | null
  status: string
  source: string | null
  created_at: string
}

export interface ConsentRow {
  id: string
  channel: "email" | "sms"
  granted: boolean
  source: string
  wording_shown: string
  occurred_at: string
}

export interface SuppressionRow {
  id: string
  identifier: string
  reason: string
  created_at: string
}

export interface SequenceRunRow {
  id: string
  status: string
  current_position: number
  enrolled_at: string
  completed_at: string | null
  exit_reason: string | null
  last_error: string | null
  next_run_at: string
  sequence_key: string
  sequence_name: string
}

/** Where one timeline row came from. Rendered as a differently-toned marker. */
export type TimelineOrigin = "event" | "payment" | "booking"

/**
 * A semantic classification, not a colour. The component maps it onto a
 * `DataTableBadge` tone; keeping it semantic here is what lets the whole merge
 * be unit-tested with no React and no database.
 */
export type TimelineTone = "neutral" | "success" | "warning" | "info" | "danger"

export interface TimelineEntry {
  /** Stable React key. Prefixed by origin because ids are only unique per table. */
  key: string
  origin: TimelineOrigin
  occurredAt: string
  title: string
  detail: string | null
  tone: TimelineTone
  /** True when the retention cron has emptied this row's metadata. */
  scrubbed: boolean
}

export interface ContactDetail {
  contact: ContactRecord
  timeline: TimelineEntry[]
  consents: ConsentRow[]
  suppressions: SuppressionRow[]
  runs: SequenceRunRow[]
  tags: string[]
  /** True when the bookings window hit its cap — the view may be incomplete. */
  bookingsWindowFull: boolean
  /** True when the timeline hit its cap — older entries exist but are not shown. */
  timelineWindowFull: boolean
}

/* ------------------------------------------------------- pure: describing */

/** Plain-language names for the ten `entry_point` sources that actually get written. */
const SOURCE_LABELS: Record<string, string> = {
  funnel_form: "Filled in a form on a landing page",
  contact_form: "Sent a message through the contact form",
  newsletter: "Signed up for the newsletter",
  lead_magnet: "Downloaded a free guide",
  event_signup: "Signed up for an event",
  step_up: "Asked about stepping up",
  inquiry: "Made an enquiry",
  purchase: "Made a purchase",
  quiz: "Finished the quiz",
  ai_chat: "Talked to the assistant on the website",
  ghl_import: "Imported from the old system",
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Turns one raw timeline row into a line a coach can read.
 *
 * PURE — no client, no clock, no React. Every branch is reachable from a real
 * writer in the repo; the DEFAULT ARM IS LOAD-BEARING, because
 * `contact_timeline_events.kind` is plain `text` with NO check constraint
 * (00214), so a new kind can start being written without any migration and
 * must not render as a blank row.
 *
 * `identifier_conflict` is the one kind whose metadata holds SOMEBODY ELSE'S
 * raw identifier — `submitted` and `existing` are literal email addresses or
 * phone numbers. They are masked through lib/lead-engine/mask.ts rather than
 * printed: the operator needs to know a conflict happened and roughly which
 * value, not to be handed a second person's contact details on a screen that
 * already logs an `admin_read_sensitive` audit row for this one.
 */
export function describeTimelineEvent(row: TimelineEventRow): {
  title: string
  detail: string | null
  tone: TimelineTone
} {
  const meta = row.metadata ?? {}

  switch (row.kind) {
    case "entry_point": {
      const label = SOURCE_LABELS[row.source] ?? `Came in through ${humanise(row.source)}`
      return { title: label, detail: null, tone: "info" }
    }

    case "identifier_conflict": {
      // `meta.field` is the literal "email" | "phone" written by
      // recordContactEvent. Keep it SEPARATE from the human label: masking a
      // phone number with maskEmail produces plausible-looking nonsense rather
      // than an error, so the branch has to key on the raw value.
      const isPhone = asString(meta.field) === "phone"
      const field = isPhone ? "phone number" : "email address"
      const submitted = asString(meta.submitted)
      const masked = submitted ? (isPhone ? maskPhone(submitted) : maskEmail(submitted)) : null
      return {
        title: `Gave a different ${field}`,
        detail: masked
          ? `They submitted ${masked}, which did not match the ${field} already on file. The record was left as it was.`
          : "The record was left as it was.",
        tone: "warning",
      }
    }

    case "ghl_import":
      return { title: "Imported from the old system", detail: null, tone: "neutral" }

    case "sms_repermission_candidate":
      return {
        title: "Marked as needing a fresh text-message permission",
        detail: null,
        tone: "neutral",
      }

    case "unsubscribed":
      return {
        title: "Unsubscribed from emails",
        detail: "They used the link at the bottom of an email.",
        tone: "danger",
      }

    case "sms_consent_confirmed":
      return { title: "Agreed to receive text messages", detail: null, tone: "success" }

    case "chat_escalated":
      return {
        title: "Asked to speak to a person",
        detail: "The website assistant handed the conversation over. The words are kept with the chat, not here.",
        tone: "warning",
      }

    case "sms_stop_received":
      return { title: "Texted STOP", detail: "They will not be sent any more text messages.", tone: "danger" }

    case "sms_start_received":
      return { title: "Texted START", detail: "They asked to receive text messages again.", tone: "success" }

    case "sms_help_received":
      return { title: "Texted HELP", detail: null, tone: "neutral" }

    case "sms_inbound": {
      const body = asString(meta.body)
      return { title: "Sent a text message", detail: body, tone: "info" }
    }

    case "sequence_step_unsupported": {
      const kind = asString(meta.step_kind)
      const reason = asString(meta.reason)
      return {
        title: kind ? `A ${kind} in a sequence could not be sent` : "A sequence step could not be sent",
        detail: reason ? `Reason recorded: ${humanise(reason)}.` : null,
        tone: "warning",
      }
    }

    case "sequence_alert":
      return { title: "A sequence raised an alert", detail: asString(meta.reason), tone: "warning" }

    case "sequence_run_repaired":
      return { title: "A stuck sequence was put right", detail: null, tone: "neutral" }

    case "user_id_conflict":
      return {
        title: "Two records were merged, and each had its own account",
        detail: "The accounts were left alone. Worth checking which one this person should keep.",
        tone: "warning",
      }

    default:
      // NOT unreachable — see the doc comment. A new kind lands here and still
      // renders something truthful rather than an empty line.
      return { title: humanise(row.kind), detail: null, tone: "neutral" }
  }
}

/** `sms_stop_received` -> `Sms stop received`. Used only for values with no hand-written label. */
function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim()
  if (spaced.length === 0) return "Something happened"
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Money, as a person writes it. `amount_cents` is an integer number of minor
 * units; `currency` is the ISO code stored alongside it.
 */
export function formatMoney(amountCents: number, currency: string): string {
  const code = (currency || "usd").toUpperCase()
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amountCents / 100)
  } catch {
    // An unknown or malformed currency code must not take down the whole page.
    return `${(amountCents / 100).toFixed(2)} ${code}`
  }
}

function describePayment(row: PaymentRow): { title: string; detail: string | null; tone: TimelineTone } {
  const money = formatMoney(row.amount_cents, row.currency)
  // `payments` has NO program_id or product relation (verified against the live
  // schema — its only foreign key is user_id). The human-readable label is
  // `description`, which is what the Stripe webhook writes.
  const what = row.description ? ` — ${row.description}` : ""
  switch (row.status) {
    case "succeeded":
      return { title: `Paid ${money}${what}`, detail: null, tone: "success" }
    case "refunded":
      // NOT `Refunded ${money}` — `amount_cents` is the ORIGINAL charge and is
      // never reduced on refund (the Stripe webhook only flips `status`), while
      // Stripe fires `charge.refunded` for PARTIAL refunds too. Printing the
      // charge as the refund would tell a coach they gave back $180 when they
      // returned $20. This wording asserts only what the row actually knows.
      return { title: `A payment of ${money}${what} was refunded`, detail: null, tone: "warning" }
    case "failed":
      return { title: `A payment of ${money} failed${what}`, detail: null, tone: "danger" }
    default:
      return { title: `Payment of ${money}${what}`, detail: `Status: ${humanise(row.status)}.`, tone: "neutral" }
  }
}

function describeBooking(row: BookingRow): { title: string; detail: string | null; tone: TimelineTone } {
  const when = new Date(row.booking_date)
  const readable = Number.isNaN(when.getTime())
    ? row.booking_date
    : when.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      })
  const base = `Booked a call for ${readable}`
  switch (row.status) {
    case "cancelled":
      return { title: `${base} — cancelled`, detail: null, tone: "danger" }
    case "completed":
      return { title: `${base} — went ahead`, detail: null, tone: "success" }
    case "no_show":
      return { title: `${base} — did not turn up`, detail: null, tone: "warning" }
    default:
      return { title: base, detail: null, tone: "info" }
  }
}

/* --------------------------------------------------------- pure: matching */

/**
 * Does this booking belong to this contact?
 *
 * PURE and exported so it can be tested without a database — this is the one
 * comparison on the page that can put the WRONG PERSON'S calls on someone's
 * record, so it is tested directly rather than only through the read.
 *
 * Both sides go through the same normalisers the writes use, then are compared
 * for exact equality. An identifier that will not normalise (null, blank,
 * unparseable) never matches — it does not fall back to a looser comparison,
 * because every looser comparison available here is one that can match a
 * different human.
 */
export function bookingMatchesContact(
  booking: Pick<BookingRow, "contact_email" | "contact_phone">,
  identity: { email: string | null; phone: string | null },
): boolean {
  const contactEmail = normaliseEmail(identity.email)
  if (contactEmail !== null && normaliseEmail(booking.contact_email) === contactEmail) return true

  const contactPhone = normalisePhone(identity.phone)
  if (contactPhone !== null && normalisePhone(booking.contact_phone) === contactPhone) return true

  return false
}

/* ------------------------------------------------------------ pure: merge */

/**
 * Merges the three sources into one list, newest first.
 *
 * PURE. Given the same rows it returns the same list, with no clock and no
 * client — which is the whole reason the reads below are kept separate from it.
 *
 * THE SORT HAS AN EXPLICIT TIEBREAK. `contact_timeline_events` has no ordering
 * column beyond `occurred_at`, and one submission legitimately writes several
 * rows within the same millisecond (an `entry_point` plus one
 * `identifier_conflict` per conflicting field). Without the tiebreak those rows
 * would swap places between two renders of the same data, which looks like the
 * history changing on its own.
 */
export function mergeTimeline(input: {
  events: TimelineEventRow[]
  payments: PaymentRow[]
  bookings: BookingRow[]
}): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const row of input.events) {
    const described = describeTimelineEvent(row)
    entries.push({
      key: `event:${row.id}`,
      origin: "event",
      occurredAt: row.occurred_at,
      title: described.title,
      // A scrubbed row has had its metadata emptied by the retention cron, so
      // any detail built from it would be a confident-looking blank. Say what
      // actually happened to it instead.
      detail: row.scrubbed_at !== null ? "The details of this were removed after 365 days." : described.detail,
      tone: described.tone,
      scrubbed: row.scrubbed_at !== null,
    })
  }

  for (const row of input.payments) {
    const described = describePayment(row)
    entries.push({
      key: `payment:${row.id}`,
      origin: "payment",
      occurredAt: row.created_at,
      title: described.title,
      detail: described.detail,
      tone: described.tone,
      scrubbed: false,
    })
  }

  for (const row of input.bookings) {
    const described = describeBooking(row)
    entries.push({
      key: `booking:${row.id}`,
      origin: "booking",
      // The booked SLOT, not the row's created_at — "when is the call" is the
      // question this line answers on a history.
      occurredAt: row.booking_date,
      title: described.title,
      detail: described.detail,
      tone: described.tone,
      scrubbed: false,
    })
  }

  return entries.sort((a, b) => {
    if (a.occurredAt > b.occurredAt) return -1
    if (a.occurredAt < b.occurredAt) return 1
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/* ------------------------------------------------------------------ reads */

/**
 * The most bookings to pull into memory for the identifier match.
 *
 * Ordered `booking_date DESC` so that if a business ever holds more than this,
 * it is the OLDEST calls that fall out of a contact's view and never the
 * newest. Removing the cap properly means putting `contact_id` on `bookings`
 * and backfilling it, which changes the reconciler's matching predicate and is
 * deliberately not done here.
 */
export const BOOKINGS_WINDOW = 1000

/**
 * The most timeline rows to show.
 *
 * ANNOUNCED, NOT SILENT — `timelineWindowFull` below. A cap with no flag renders
 * a truncated history as a complete one, and on a screen whose whole claim is
 * "this person's whole history" that is the worst kind of quiet wrong: the
 * operator reads the oldest visible row as the first thing that ever happened.
 * The retention cron scrubs metadata but never DELETES rows, so this bound is
 * reached by long tenure (and by merges, which re-point the loser's rows onto
 * the survivor) rather than being self-limiting.
 */
export const TIMELINE_WINDOW = 500

/** One contact, or null when there is no such row. A failed READ throws. */
export async function getContactById(
  contactId: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<ContactRecord | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("id, business_id, user_id, name, email, phone_e164, created_at, updated_at, timezone")
    .eq("business_id", businessId)
    .eq("id", contactId)
    .maybeSingle()
  // A read failure and "no such contact" are different answers: the first must
  // reach the error boundary, the second is a 404. Only `null` means the second.
  if (error) throw new Error(`getContactById: ${error.message}`)
  return (data as ContactRecord | null) ?? null
}

/**
 * Everything the detail screen shows, for one contact.
 *
 * NOT WRAPPED IN try/catch, deliberately, and for the reason
 * app/(admin)/admin/contacts/page.tsx states in its own header: a failed read
 * must not render as "this person has no history". Letting it throw reaches
 * app/(admin)/admin/error.tsx, which is visibly not an empty page. `null` and
 * `[]` are different answers and only one of them means "stop and look".
 */
export async function getContactDetail(contact: ContactRecord): Promise<ContactDetail> {
  const supabase = getClient()
  const businessId = contact.business_id

  const [eventsRes, consentsRes, runsRes, tagsRes] = await Promise.all([
    supabase
      .from("contact_timeline_events")
      .select("id, kind, source, occurred_at, metadata, scrubbed_at")
      .eq("business_id", businessId)
      .eq("contact_id", contact.id)
      .order("occurred_at", { ascending: false })
      .limit(TIMELINE_WINDOW),
    supabase
      .from("contact_consents")
      .select("id, channel, granted, source, wording_shown, occurred_at")
      .eq("business_id", businessId)
      .eq("contact_id", contact.id)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("sequence_runs")
      .select(
        "id, status, current_position, enrolled_at, completed_at, exit_reason, last_error, next_run_at, sequences(key, name)",
      )
      .eq("business_id", businessId)
      .eq("contact_id", contact.id)
      .order("enrolled_at", { ascending: false }),
    supabase
      .from("contact_tags")
      .select("tag")
      .eq("business_id", businessId)
      .eq("contact_id", contact.id)
      .order("tag", { ascending: true }),
  ])

  if (eventsRes.error) throw new Error(`getContactDetail events: ${eventsRes.error.message}`)
  if (consentsRes.error) throw new Error(`getContactDetail consents: ${consentsRes.error.message}`)
  if (runsRes.error) throw new Error(`getContactDetail runs: ${runsRes.error.message}`)
  if (tagsRes.error) throw new Error(`getContactDetail tags: ${tagsRes.error.message}`)

  // PAYMENTS ONLY EXIST FOR A CONTACT THAT REACHED A USER. `contacts.user_id`
  // is null for most leads, and a null here means "no account", not "no money":
  // skipping the query entirely is correct, and querying `.eq("user_id", null)`
  // would be a filter on NULL that matches nothing anyway.
  let payments: PaymentRow[] = []
  if (contact.user_id) {
    const { data, error } = await supabase
      .from("payments")
      .select("id, amount_cents, currency, status, description, created_at")
      .eq("user_id", contact.user_id)
      .order("created_at", { ascending: false })
    if (error) throw new Error(`getContactDetail payments: ${error.message}`)
    payments = (data ?? []) as PaymentRow[]
  }

  // BOOKINGS ARE MATCHED IN MEMORY — see this file's header for why `.eq()`
  // and `.ilike()` are both wrong. Skipped entirely when the contact has
  // neither identifier, since nothing could match.
  let bookings: BookingRow[] = []
  let bookingsWindowFull = false
  if (contact.email || contact.phone_e164) {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, contact_email, contact_phone, booking_date, duration_minutes, status, source, created_at")
      .order("booking_date", { ascending: false })
      .limit(BOOKINGS_WINDOW)
    if (error) throw new Error(`getContactDetail bookings: ${error.message}`)
    const window = (data ?? []) as BookingRow[]
    bookingsWindowFull = window.length >= BOOKINGS_WINDOW
    bookings = window.filter((row) => bookingMatchesContact(row, { email: contact.email, phone: contact.phone_e164 }))
  }

  // SUPPRESSIONS ARE KEYED BY IDENTIFIER, NOT BY CONTACT (00215) — deliberately,
  // so a STOP survives a merge, a delete, and the same person arriving again.
  // `suppress` lowercases what it stores, so the lookup does too.
  const identifiers = [contact.email, contact.phone_e164]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase())

  let suppressions: SuppressionRow[] = []
  if (identifiers.length > 0) {
    const { data, error } = await supabase
      .from("contact_suppressions")
      .select("id, identifier, reason, created_at")
      .eq("business_id", businessId)
      .in("identifier", identifiers)
    if (error) throw new Error(`getContactDetail suppressions: ${error.message}`)
    suppressions = (data ?? []) as SuppressionRow[]
  }

  const runs: SequenceRunRow[] = ((runsRes.data ?? []) as Record<string, unknown>[]).map((row) => {
    // PostgREST returns an embedded one-to-one as an object, but types it wide.
    const sequence = (row.sequences ?? null) as { key?: string; name?: string } | null
    return {
      id: String(row.id),
      status: String(row.status),
      current_position: Number(row.current_position ?? 0),
      enrolled_at: String(row.enrolled_at),
      completed_at: (row.completed_at as string | null) ?? null,
      exit_reason: (row.exit_reason as string | null) ?? null,
      last_error: (row.last_error as string | null) ?? null,
      next_run_at: String(row.next_run_at),
      sequence_key: sequence?.key ?? "unknown",
      sequence_name: sequence?.name ?? "A sequence that no longer exists",
    }
  })

  const events = (eventsRes.data ?? []) as TimelineEventRow[]

  return {
    contact,
    timeline: mergeTimeline({
      events,
      payments,
      bookings,
    }),
    consents: (consentsRes.data ?? []) as ConsentRow[],
    suppressions,
    runs,
    tags: ((tagsRes.data ?? []) as { tag: string }[]).map((row) => row.tag),
    bookingsWindowFull,
    timelineWindowFull: events.length >= TIMELINE_WINDOW,
  }
}
