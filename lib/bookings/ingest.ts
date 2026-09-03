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
import { getBusinessSettings } from "@/lib/db/businesses"

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
   * REQUIRED, and deliberately not defaulted. Every DAL function in the Lead
   * Engine takes `businessId = SINGLETON_BUSINESS_ID`, and that default is what
   * let the tenant leak this far — a booking's four consequences all landed in
   * the singleton because nobody had to say otherwise. A new field that
   * defaults the tenant is how the next leak ships.
   */
  businessId: string
  /** The host whose calendar this lands on. Null only until 00243 tightens. */
  hostId: string | null
  /** The coach_calendar_connections row this delivery matched. Null until phase 2 exists. */
  connectionId: string | null
  /** The chat conversation that produced this booking, if any. */
  chatConversationId: string | null
  /** The invitee's own timezone as the vendor reported it. */
  inviteeTimezone: string | null
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
  /**
   * The CREATE half of a reschedule: the invitee URI this booking replaces.
   * The row and the card are real (the cancel half left the card alone, so
   * this is what carries the booking forward) but the Google Ads conversion
   * and the "New Call Booked" notification are not — the person booked once
   * and moved it, and counting that twice is a lie to the bidder and to the
   * admin. Audited as `booking.rescheduled`, never `booking.created`.
   */
  rescheduledFrom?: string | null
  /**
   * True when this delivery is an immutable "it was created" event rather than
   * a state change — Calendly's invitee.created. If the row already exists in a
   * terminal state (cancelled, no_show, completed) the delivery is a LATE
   * REDELIVERY of something that has since been undone, and applying it would
   * flip the row back to scheduled and open a second card. GoHighLevel sends
   * status changes for one appointment id and leaves this false.
   */
  ignoreIfTerminal?: boolean
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

/** A booking in one of these states is over; a later "created" for it is stale. */
const TERMINAL_STATUSES = new Set(["cancelled", "no_show", "completed"])

/** Only a booking that is going to HAPPEN converts or is worth telling the admin about. */
function isLive(status: BookingStatus): boolean {
  return status === "scheduled" || status === "completed"
}

/** Carried through the four stages so each gets the same client and log prefix. */
type IngestCtx = { supabase: ReturnType<typeof createServiceRoleClient>; log: string }

/**
 * `Math.max(…, 1)` mirrors migration 00241's `greatest(…, 1)`: duration_minutes
 * has no positivity CHECK, and a stored 0 would give end_at === booking_date,
 * which 00243's range check refuses. Shared by writeRow's insert and
 * updateExisting's date-move update so the arithmetic cannot drift between them.
 */
function deriveEndAt(input: BookingIngestInput): string {
  return new Date(
    new Date(input.bookingDate).getTime() + Math.max(input.durationMinutes ?? 30, 1) * 60_000,
  ).toISOString()
}

/**
 * The seven columns migration 00241 adds to `bookings`. Migrations and the
 * Vercel build race, unsequenced, on a push to main (00241's own header).
 * `writeRow`'s insert names all seven, `updateExisting` names one
 * (`end_at`), and `readByKey` filters on one (`business_id`) — so if Vercel
 * wins that race, every booking webhook, both vendors, would 500 until the
 * migration Action finishes. The same trick 00239's header describes for its
 * three Calendly-only columns, generalised to these seven.
 */
const TENANT_COLUMNS = [
  "business_id",
  "host_id",
  "connection_id",
  "contact_id",
  "chat_conversation_id",
  "end_at",
  "invitee_timezone",
] as const

/**
 * Sticky for the life of this server instance. Once one write PROVES the
 * columns are missing, every later call in this instance skips straight to
 * the pre-00241 shape rather than paying for a doomed wide attempt first —
 * this function is on the hot path of every booking webhook, unlike the
 * one-off DAL functions that use the same PGRST204/42703 check per-call
 * (lib/db/lead-inquiries.ts, lib/db/funnels.ts). A fresh deploy starts this
 * false again, which is correct: the migration landing is exactly what a
 * redeploy would follow.
 *
 * Set ONLY after a narrowed retry actually SUCCEEDS, never on the bare
 * detection of a PGRST204/42703 — see isMissingTenantColumnsError for why
 * the error code alone is not proof that stripping TENANT_COLUMNS is
 * sufficient. Setting it on detection alone was review round 2's finding:
 * if more than one migration's columns are missing at once, the narrowed
 * retry can fail too, and a flag set on detection would then wedge this
 * instance into legacy mode — silently dropping contact_id, host_id,
 * chat_conversation_id, invitee_timezone and end_at on every booking after
 * that — even once every migration has landed.
 */
let tenantColumnsAbsent = false

/**
 * PostgREST's schema-cache miss on a write, or Postgres' own undefined_column.
 *
 * Checks the CODE only, never WHICH column was missing — deliberately, but
 * with a known residual. This fallback strips exactly TENANT_COLUMNS, 00241's
 * seven. Migration 00239 (calendly_event_uri, reschedule_url, cancel_url —
 * three Calendly-only columns; see writeRow) is a SEPARATE, still-unmerged
 * migration living on feat/calendly-booking, never merged to main. If both
 * migrations are missing at once and a Calendly insert races
 * that window, the narrowed retry below still names all three 00239 columns,
 * still fails, and — because tenantColumnsAbsent is now only set once a
 * retry actually succeeds — correctly leaves the flag false rather than
 * wedging this instance into legacy mode. That one Calendly delivery is
 * genuinely lost. Accepted: 00239's own header records that the Calendly
 * webhook is registered with the vendor BY HAND, only after both the code
 * and the migration have landed, so no Calendly delivery can physically
 * arrive during that window at all. A GHL insert never names the 00239
 * columns in the first place (see writeRow), so it is unaffected either way.
 */
function isMissingTenantColumnsError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703"
}

function stripTenantColumns(row: Record<string, unknown>): Record<string, unknown> {
  const narrow = { ...row }
  for (const column of TENANT_COLUMNS) delete narrow[column]
  return narrow
}

function warnTenantColumnsAbsent(ctx: IngestCtx, where: string, error: { code?: string; message?: string }): void {
  console.warn(
    `${ctx.log} migration 00241's tenant columns are not on this instance's bookings table yet (${where}: ${error.code} ${error.message}); falling back to the pre-00241 shape until it lands`,
  )
}

/** The one place a booking becomes its four consequences. */
export async function ingestBooking(input: BookingIngestInput): Promise<BookingIngestResult> {
  const ctx: IngestCtx = { supabase: createServiceRoleClient(), log: `[booking-ingest:${input.source}]` }

  const { existing, staleReturn } = await readAndGate(ctx, input)
  if (staleReturn) return staleReturn

  const contactId = await runContactConsequences(ctx, input)

  const { result, bookingId, clickIds } = await writeRow(ctx, input, existing, contactId)
  if (result.action === "created") {
    await runPostWriteEffects(ctx, input, bookingId, clickIds)
  }
  return result
}

async function readAndGate(
  ctx: IngestCtx,
  input: BookingIngestInput,
): Promise<{ existing: ExistingRow | null; staleReturn: BookingIngestResult | null }> {
  // Read by the vendor key FIRST, so a stale redelivery can be recognised
  // before any consequence runs. (The GHL route read after the consequences;
  // for a plain status change the order makes no difference.)
  const existing = input.key ? await readByKey(ctx, input.key, input.businessId) : null

  if (existing && input.ignoreIfTerminal && input.status === "scheduled" && TERMINAL_STATUSES.has(existing.status ?? "")) {
    // Calendly retried an invitee.created that timed out, and the booking has
    // since been cancelled. Applying it would reopen the card and flip the row
    // back to scheduled. Acknowledged (so the retries stop) and left alone.
    console.warn(`${ctx.log} stale "created" for ${input.key?.value}: row is already ${existing.status}; ignored`)
    return { existing, staleReturn: { action: "updated", bookingId: existing.id } }
  }

  return { existing, staleReturn: null }
}

async function runContactConsequences(ctx: IngestCtx, input: BookingIngestInput): Promise<string | null> {
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
  if (input.rescheduled) return null

  // Hoisted above the try, and assigned the moment findContactByIdentifiers
  // resolves: a later throw in this block (exitRunsForContact or
  // applyPipelineEvent) must not erase a contact id that WAS successfully
  // resolved — the row still needs to carry it. `return contactId` used to
  // sit inside the try after applyPipelineEvent, so a pipeline failure (not
  // hypothetical — sequence-exit-hooks.test.ts exercises exactly this)
  // silently wrote contact_id: null for a contact that had, in fact, resolved.
  let contactId: string | null = null
  try {
    contactId = await findContactByIdentifiers({
      email: input.contact.email,
      phone: input.contact.phone,
      businessId: input.businessId,
    })
    if (contactId) {
      if (input.status === "scheduled" || input.status === "completed") {
        await exitRunsForContact(contactId, "booking", input.businessId)
      }
      await applyPipelineEvent({
        contactId,
        event: { kind: "booking", status: input.status, occurredAt: new Date() },
        businessId: input.businessId,
      })
    }
  } catch (err) {
    console.error(`${ctx.log} sequence/pipeline hook failed`, (err as Error).message)
  }
  return contactId
}

async function writeRow(
  ctx: IngestCtx,
  input: BookingIngestInput,
  existing: ExistingRow | null,
  contactId: string | null,
): Promise<{ result: BookingIngestResult; bookingId: string | null; clickIds: ClickIds }> {
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

  const clickIds: ClickIds = { gclid, gbraid, wbraid, fbclid }

  // Upsert by the vendor key if present (so status updates and redeliveries
  // don't create duplicates). NOT a PostgREST .upsert(): the Calendly key's
  // unique index is PARTIAL, and ON CONFLICT cannot infer a partial index
  // without repeating its predicate, which PostgREST has no syntax for. Read
  // (done above), then update or insert — and let 23505 below catch the race.
  if (existing) {
    const result = await updateExisting(ctx, input, existing)
    return { result, bookingId: result.bookingId, clickIds }
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
  // Skipped entirely (not attempted-then-stripped) once this instance has
  // already proven the columns are missing — see TENANT_COLUMNS' header.
  if (!tenantColumnsAbsent) {
    row.business_id = input.businessId
    row.host_id = input.hostId
    row.connection_id = input.connectionId
    row.contact_id = contactId
    row.chat_conversation_id = input.chatConversationId
    row.end_at = deriveEndAt(input)
    row.invitee_timezone = input.inviteeTimezone
  }
  if (input.key) row[input.key.column] = input.key.value
  // Calendly's columns are only named on a Calendly row. A GHL insert never
  // mentions them, so it keeps working for the one deploy where the code has
  // landed and migration 00239 has not (see the migration header).
  if (input.source === "calendly") {
    row.reschedule_url = input.columns?.reschedule_url ?? null
    row.cancel_url = input.columns?.cancel_url ?? null
  }

  let insertResult = await ctx.supabase.from("bookings").insert(row).select("id").single()

  if (insertResult.error && !tenantColumnsAbsent && isMissingTenantColumnsError(insertResult.error)) {
    warnTenantColumnsAbsent(ctx, "insert", insertResult.error)
    // Nothing was written on the failed attempt above, so retrying cannot
    // double-insert.
    const retry = await ctx.supabase.from("bookings").insert(stripTenantColumns(row)).select("id").single()
    // Only believe the columns are missing once the narrower attempt PROVES
    // it by succeeding — see tenantColumnsAbsent's header. If this retry
    // also fails (e.g. a Calendly insert during the 00239-and-00241 merge
    // race, when three more columns are also missing), the flag stays
    // false and the NEXT booking gets a fresh, honest wide attempt instead
    // of being stuck in legacy mode forever.
    if (!retry.error) tenantColumnsAbsent = true
    insertResult = retry
  }

  const { data: insertedBooking, error } = insertResult

  if (error) {
    // Two redeliveries raced past the read above and both inserted; the
    // partial unique index refused this one. The other IS this booking, so
    // finish as an update rather than answering 500 to a vendor that will
    // only retry.
    if (error.code === PG_UNIQUE_VIOLATION && input.key) {
      const winner = await readByKey(ctx, input.key, input.businessId)
      if (winner) {
        const result = await updateExisting(ctx, input, winner)
        return { result, bookingId: result.bookingId, clickIds }
      }
    }
    throw error
  }

  const bookingId = (insertedBooking as { id?: string } | null)?.id ?? null

  // Audit the new row (system actor = the vendor's webhook). A row that is the
  // create half of a reschedule is a moved booking, not a new one.
  if (bookingId) {
    await recordAudit({
      action: input.rescheduledFrom ? "booking.rescheduled" : "booking.created",
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: input.actor, role: "system" },
      target: { type: "booking", id: bookingId, label: input.bookingDate ?? undefined },
      metadata: {
        ...(input.auditMetadata ?? {}),
        status: input.status,
        source: input.auditSource,
        ...(input.rescheduledFrom ? { rescheduled_from: input.rescheduledFrom } : {}),
      },
      request: input.request,
    })
  }

  return { result: { action: "created", bookingId }, bookingId, clickIds }
}

async function runPostWriteEffects(
  ctx: IngestCtx,
  input: BookingIngestInput,
  bookingId: string | null,
  clickIds: ClickIds,
): Promise<void> {
  const { gclid, gbraid, wbraid } = clickIds

  // A conversion and a notification are for a booking that is going to HAPPEN
  // and has not been counted before. A first-seen cancellation (the create was
  // lost, or the webhook was registered after the booking) is neither, and the
  // create half of a reschedule was already counted when it was first booked.
  const countsAsNew = isLive(input.status) && !input.rescheduledFrom

  // Phase 1.5c — enqueue an offline conversion upload to Google Ads.
  // No-ops silently when there's no gclid/gbraid/wbraid OR no active
  // 'booking_created' conversion action configured. Wrapped in try/catch
  // so a Google Ads enqueue failure can't break the booking webhook.
  if (bookingId && countsAsNew) {
    try {
      await enqueueBookingConversion({
        booking_id: bookingId,
        booking_date: input.bookingDate,
        gclid,
        gbraid,
        wbraid,
      })
    } catch (enqueueErr) {
      console.error(`${ctx.log} enqueueBookingConversion failed:`, enqueueErr)
    }
  }

  // The recipients are this business's MEMBERS — owner, coach and staff alike —
  // not every role='admin' user in the deployment, which was a cross-tenant
  // broadcast waiting for a second business. 00240's backfill made every current
  // admin an owner of the singleton, so this is behaviour-identical today.
  const { data: members } = countsAsNew
    ? await ctx.supabase.from("business_members").select("user_id").eq("business_id", input.businessId)
    : { data: null }

  if (members && members.length > 0) {
    // The FOURTH timezone. This string was built with toLocaleString and no
    // timeZone, i.e. the server process zone — and TZ is a reserved Vercel
    // environment variable, so the project cannot even choose it. A missing
    // settings row must not fail a booking webhook, hence the catch.
    const settings = await getBusinessSettings(input.businessId).catch(() => null)
    const bookingDate = new Date(input.bookingDate).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: settings?.timezone || "UTC",
    })

    const notifications = (members as Array<{ user_id: string }>).map((m) => ({
      user_id: m.user_id,
      type: "success" as const,
      title: "New Call Booked",
      message: `${input.contact.name} (${input.contact.email}) booked a call for ${bookingDate}`,
      is_read: false,
      link: "/admin/bookings",
    }))

    await ctx.supabase.from("notifications").insert(notifications)
  }
}

async function readByKey(
  ctx: IngestCtx,
  key: { column: BookingKeyColumn; value: string },
  businessId: string,
): Promise<ExistingRow | null> {
  if (!tenantColumnsAbsent) {
    const { data, error } = await ctx.supabase
      .from("bookings")
      .select("id, status, booking_date")
      .eq(key.column, key.value)
      .eq("business_id", businessId)
      .maybeSingle()
    if (!error || !isMissingTenantColumnsError(error)) {
      return (data as ExistingRow | null) ?? null
    }
    warnTenantColumnsAbsent(ctx, "read", error)
    // Do NOT set tenantColumnsAbsent here — only the narrow retry below,
    // if it succeeds, actually proves the columns are missing. See
    // tenantColumnsAbsent's header.
  }

  // business_id isn't on this instance's bookings table yet — either just
  // proven above, or already known from an earlier call in this instance. A
  // redelivered vendor key could theoretically match a different business's
  // row here — accepted rather than thrown on, because only one business
  // exists until phase 1 ships createBusiness; there is nothing to
  // cross-match against yet.
  const { data, error } = await ctx.supabase
    .from("bookings")
    .select("id, status, booking_date")
    .eq(key.column, key.value)
    .maybeSingle()
  if (!tenantColumnsAbsent && !error) tenantColumnsAbsent = true
  return (data as ExistingRow | null) ?? null
}

async function updateExisting(
  ctx: IngestCtx,
  input: BookingIngestInput,
  existing: ExistingRow,
): Promise<BookingIngestResult> {
  const updates: Record<string, unknown> = {
    status: input.status,
    booking_date: input.bookingDate,
    notes: input.notes,
    updated_at: new Date().toISOString(),
  }
  if (!tenantColumnsAbsent) updates.end_at = deriveEndAt(input)

  const firstAttempt = await ctx.supabase.from("bookings").update(updates).eq("id", existing.id)
  let error = firstAttempt.error

  if (error && !tenantColumnsAbsent && isMissingTenantColumnsError(error)) {
    warnTenantColumnsAbsent(ctx, "update", error)
    // A fresh object, not a mutation of `updates` in place: the caller (or a
    // test capturing the payload by reference, as this one does) must still
    // see what the FIRST attempt actually sent.
    const retry = await ctx.supabase.from("bookings").update(stripTenantColumns(updates)).eq("id", existing.id)
    // Only believe the columns are missing once the narrower attempt PROVES
    // it by succeeding — see tenantColumnsAbsent's header for why the
    // ordering matters.
    if (!retry.error) tenantColumnsAbsent = true
    error = retry.error
  }

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
