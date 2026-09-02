// lib/bookings/ingest.ts — what a booking MEANS, in one place.
//
// Extracted from app/api/webhooks/ghl-booking/route.ts (Full Engine phase 2) so
// that the Calendly webhook and the GoHighLevel webhook share one definition.
// A booking has four consequences here, and only the first is obvious:
//
//   1. a `bookings` row (upsert by the source's own key, so a redelivery or a
//      status change never makes a second row)
//   2. `exitRunsForContact` — someone who books stops being nurtured
//   3. `enqueueBookingConversion` — the Google Ads offline conversion
//   4. `applyPipelineEvent` — the card moves to Consult Booked (or closes lost)
//
// Two webhooks each carrying their own copy of those four is two sets of rules,
// and you find out which one was more careful at the worst moment — the same
// reason migration 00235 pulled `grantFunnelPurchase` out of the Stripe route.
// The routes are ADAPTERS now: they verify their vendor's signature, translate
// their vendor's payload into `BookingIngestInput`, and call this.
//
// BEHAVIOUR IS THE GHL ROUTE'S, MOVED, NOT REWRITTEN. The ordering (contact
// consequences first, then the row, then ads, then admin notifications), the
// never-rethrow catch around the sequence/pipeline pair, the status gate on
// `exitRunsForContact`, the audit slugs — all of it is what shipped, and the
// three existing GHL suites exercise it through the route unchanged.
//
// Two additions, both forced by Calendly and both documented in the spec's §8:
//
//   * `rescheduled` — Calendly delivers a reschedule as a CANCEL of the old
//     invitee plus a CREATE of the new one, in no guaranteed order. The cancel
//     half must not reach the pipeline, or a person who moved their call by a
//     day gets a Lost card. The row is still marked cancelled.
//   * the `23505` path — two redeliveries can both pass the read-by-key and
//     both insert; the partial unique index refuses the second, and that is
//     "the other one won", not a failure. It re-reads and takes the update path.

import type { Booking, BookingStatus } from "@/types/database"
import { createServiceRoleClient } from "@/lib/supabase"
import { findAttributionByEmail } from "@/lib/db/marketing-attribution"
import { enqueueBookingConversion } from "@/lib/ads/conversions"
import { recordAudit } from "@/lib/audit/record"
import { findContactByIdentifiers } from "@/lib/db/contacts"
import { exitRunsForContact } from "@/lib/db/sequences"
import { applyPipelineEvent } from "@/lib/db/pipeline"

export type BookingSource = "ghl" | "calendly"

export type BookingKeyColumn = "ghl_appointment_id" | "calendly_event_uri"

export type ClickIds = {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
}

export type BookingIngestInput = {
  source: BookingSource
  /**
   * The vendor's own identifier for this booking, and the column it lives in.
   * Null means "no key" — the row is inserted blind, which is how a GHL
   * payload without an appointment id has always behaved.
   */
  key: { column: BookingKeyColumn; value: string } | null
  contact: { name: string; email: string; phone: string | null }
  /** ISO 8601. */
  bookingDate: string
  durationMinutes: number
  status: BookingStatus
  notes: string | null
  /** Whatever the payload itself carried. The email-match fallback fills gaps. */
  clickIds: ClickIds
  /** Vendor columns to write on INSERT. The key column is added automatically. */
  columns?: Partial<Pick<Booking, "ghl_contact_id" | "calendly_event_uri" | "reschedule_url" | "cancel_url">>
  /**
   * True for the cancel half of a Calendly reschedule. The row is marked
   * cancelled and audited as `booking.rescheduled`, but neither the sequence
   * exit nor the pipeline sees it — the paired create carries the booking on.
   */
  rescheduled?: boolean
  /** Audit actor email, e.g. "ghl" or "calendly". */
  actor: string
  /** Audit metadata `source`, e.g. "ghl_webhook" or "calendly_webhook". */
  auditSource: string
  /** Extra audit metadata the adapter wants on the row (vendor ids, conversation id). */
  auditMetadata?: Record<string, unknown>
  request?: Request
}

export type BookingIngestResult = {
  action: "created" | "updated"
  bookingId: string | null
}

type ExistingRow = { id: string; status: string | null; booking_date: string | null }

const PG_UNIQUE_VIOLATION = "23505"

/** The one place a booking becomes its four consequences. */
export async function ingestBooking(input: BookingIngestInput): Promise<BookingIngestResult> {
  const supabase = createServiceRoleClient()
  const log = `[booking-ingest:${input.source}]`

  // Lead Engine: neither the sequence exit nor the pipeline card move may
  // ever fail a booking webhook — catch, log, keep going to the normal
  // response. One contact resolution, two consumers, same catch.
  //
  // exitRunsForContact stays gated to scheduled/completed only: a
  // cancelled or no-show booking means the lead did NOT convert, and this
  // branch has no re-enrolment path anywhere (enrollIfTriggered only fires
  // from ContactEventSource values, none of which is "booking cancelled")
  // — so exiting on a bad-outcome status would silently end the
  // conversation forever, with nothing left to ever restart it.
  //
  // applyPipelineEvent, by contrast, cares about all four statuses:
  // cancelled and no_show close a card as lost (decideMove in
  // lib/lead-engine/pipeline-move.ts). Do not "simplify" these into one
  // shared condition — the two consumers legitimately fire on different
  // status sets from the same resolved contact.
  //
  // A RESCHEDULE'S CANCEL HALF SKIPS BOTH. See the header.
  if (!input.rescheduled) {
    try {
      const contactId = await findContactByIdentifiers({
        email: input.contact.email,
        phone: input.contact.phone,
      })
      if (contactId) {
        if (input.status === "scheduled" || input.status === "completed") {
          await exitRunsForContact(contactId, "booking")
        }
        await applyPipelineEvent({
          contactId,
          event: { kind: "booking", status: input.status, occurredAt: new Date() },
        })
      }
    } catch (err) {
      console.error(`${log} sequence/pipeline hook failed`, (err as Error).message)
    }
  }

  let gclid = input.clickIds.gclid ?? null
  let gbraid = input.clickIds.gbraid ?? null
  let wbraid = input.clickIds.wbraid ?? null
  let fbclid = input.clickIds.fbclid ?? null

  // Email-match fallback if no gclid in payload
  if (!gclid) {
    const attr = await findAttributionByEmail(input.contact.email).catch(() => null)
    if (attr) {
      gclid = attr.gclid
      gbraid ||= attr.gbraid
      wbraid ||= attr.wbraid
      fbclid ||= attr.fbclid
    }
  }

  // Upsert by the vendor key if present (so status updates and redeliveries
  // don't create duplicates). NOT a PostgREST .upsert(): the Calendly key's
  // unique index is PARTIAL, and ON CONFLICT cannot infer a partial index
  // without repeating its predicate, which PostgREST has no syntax for. Read,
  // then update or insert — and let 23505 below catch the race.
  if (input.key) {
    const existing = await readByKey(supabase, input.key)
    if (existing) {
      return updateExisting(supabase, input, existing)
    }
  }

  // Insert new booking
  const row: Record<string, unknown> = {
    contact_name: input.contact.name,
    contact_email: input.contact.email,
    contact_phone: input.contact.phone ?? null,
    booking_date: input.bookingDate,
    duration_minutes: input.durationMinutes,
    status: input.status,
    source: input.source,
    notes: input.notes ?? null,
    ghl_contact_id: input.columns?.ghl_contact_id ?? null,
    ghl_appointment_id: null,
    gclid,
    gbraid,
    wbraid,
    fbclid,
  }
  if (input.key) row[input.key.column] = input.key.value
  // Calendly's columns are only named on a Calendly row. A GHL insert never
  // mentions them, so it keeps working for the one deploy where the code has
  // landed and migration 00239 has not (see the migration header).
  if (input.source === "calendly") {
    row.reschedule_url = input.columns?.reschedule_url ?? null
    row.cancel_url = input.columns?.cancel_url ?? null
  }

  const { data: insertedBooking, error } = await supabase.from("bookings").insert(row).select("id").single()

  if (error) {
    // Two redeliveries raced past the read above and both inserted; the
    // partial unique index refused this one. The other IS this booking, so
    // finish as an update rather than answering 500 to a vendor that will
    // only retry.
    if (error.code === PG_UNIQUE_VIOLATION && input.key) {
      const winner = await readByKey(supabase, input.key)
      if (winner) return updateExisting(supabase, input, winner)
    }
    throw error
  }

  const bookingId = (insertedBooking as { id?: string } | null)?.id ?? null

  // Audit booking creation (system actor = the vendor's webhook).
  if (bookingId) {
    await recordAudit({
      action: "booking.created",
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: input.actor, role: "system" },
      target: { type: "booking", id: bookingId, label: input.bookingDate ?? undefined },
      metadata: {
        ...(input.auditMetadata ?? {}),
        status: input.status,
        source: input.auditSource,
      },
      request: input.request,
    })
  }

  // Phase 1.5c — enqueue an offline conversion upload to Google Ads.
  // No-ops silently when there's no gclid/gbraid/wbraid OR no active
  // 'booking_created' conversion action configured. Wrapped in try/catch
  // so a Google Ads enqueue failure can't break the booking webhook.
  if (bookingId) {
    try {
      await enqueueBookingConversion({
        booking_id: bookingId,
        booking_date: input.bookingDate,
        gclid,
        gbraid,
        wbraid,
      })
    } catch (enqueueErr) {
      console.error(`${log} enqueueBookingConversion failed:`, enqueueErr)
    }
  }

  // Notify admins
  const { data: admins } = await supabase.from("users").select("id").eq("role", "admin")

  if (admins && admins.length > 0) {
    const bookingDate = new Date(input.bookingDate).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    })

    const notifications = (admins as Array<{ id: string }>).map((admin) => ({
      user_id: admin.id,
      type: "success" as const,
      title: "New Call Booked",
      message: `${input.contact.name} (${input.contact.email}) booked a call for ${bookingDate}`,
      is_read: false,
      link: "/admin/bookings",
    }))

    await supabase.from("notifications").insert(notifications)
  }

  return { action: "created", bookingId }
}

async function readByKey(
  supabase: ReturnType<typeof createServiceRoleClient>,
  key: { column: BookingKeyColumn; value: string },
): Promise<ExistingRow | null> {
  const { data } = await supabase
    .from("bookings")
    .select("id, status, booking_date")
    .eq(key.column, key.value)
    .maybeSingle()
  return (data as ExistingRow | null) ?? null
}

async function updateExisting(
  supabase: ReturnType<typeof createServiceRoleClient>,
  input: BookingIngestInput,
  existing: ExistingRow,
): Promise<BookingIngestResult> {
  const { error } = await supabase
    .from("bookings")
    .update({
      status: input.status,
      booking_date: input.bookingDate,
      notes: input.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)

  if (error) throw error

  // Dispatch audit slug on transition (reschedule or status change).
  const prevStatus = existing.status ?? null
  const prevDate = existing.booking_date ?? null

  let slug: string | null = null
  if (input.rescheduled) {
    slug = "booking.rescheduled"
  } else if (prevStatus !== input.status) {
    if (input.status === "completed") slug = "booking.completed"
    else if (input.status === "cancelled") slug = "booking.cancelled"
    else if (input.status === "no_show") slug = "booking.no_show"
  } else if (prevDate && prevDate !== input.bookingDate) {
    slug = "booking.rescheduled"
  }

  if (slug) {
    await recordAudit({
      action: slug,
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: input.actor, role: "system" },
      target: { type: "booking", id: existing.id, label: input.bookingDate ?? undefined },
      metadata: {
        ...(input.auditMetadata ?? {}),
        source: input.auditSource,
        from_status: prevStatus,
        to_status: input.status,
        from_booking_date: prevDate,
        to_booking_date: input.bookingDate,
      },
      request: input.request,
    })
  }

  return { action: "updated", bookingId: existing.id }
}
