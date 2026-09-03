// @vitest-environment node
//
// lib/bookings/ingest.ts called DIRECTLY — the two behaviours the route suites
// cannot reach through a route's happy path:
//
//   * the 23505 race: two redeliveries both pass the read-by-key and both
//     insert; the partial unique index refuses the second and that must end as
//     "updated", not as a 500 the vendor will retry forever
//   * the ads conversion fires on CREATE only, with the click ids the payload
//     or the email fallback supplied
//
// Everything else about the ingest (contact resolution, the sequence/pipeline
// pair and its status gates, the reschedule skip) is covered through both
// routes by __tests__/api/webhooks/{pipeline-hooks,sequence-exit-hooks}.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const findContactByIdentifiersMock = vi.fn(async (..._a: any[]) => null as string | null)
const exitRunsForContactMock = vi.fn(async (..._a: any[]) => 0)
const applyPipelineEventMock = vi.fn(async (..._a: any[]): Promise<any> => ({ decision: { kind: "noop", reason: "t" }, opportunityId: null }))
const enqueueBookingConversionMock = vi.fn(async (..._a: any[]) => null)
const findAttributionByEmailMock = vi.fn(async (..._a: any[]) => null as any)
const recordAuditMock = vi.fn(async (..._a: any[]) => undefined)

vi.mock("@/lib/db/contacts", () => ({ findContactByIdentifiers: (...a: unknown[]) => findContactByIdentifiersMock(...a) }))
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: (...a: unknown[]) => exitRunsForContactMock(...a) }))
vi.mock("@/lib/db/pipeline", () => ({ applyPipelineEvent: (...a: unknown[]) => applyPipelineEventMock(...a) }))
vi.mock("@/lib/ads/conversions", () => ({ enqueueBookingConversion: (...a: unknown[]) => enqueueBookingConversionMock(...a) }))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionByEmail: (...a: unknown[]) => findAttributionByEmailMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

let selectMaybeSingle: ReturnType<typeof vi.fn>
let insertSingle: ReturnType<typeof vi.fn>
let updateEq: ReturnType<typeof vi.fn>
let notificationsInsert: ReturnType<typeof vi.fn>
let lastInsertedRow: Record<string, unknown> | null = null
// Records every .eq() applied to a `bookings` SELECT, in call order, so a
// test can assert the PREDICATE readByKey applies — not merely that a row
// came back. A mock that returns rows proves nothing about which rows the
// database would actually have matched; an argument-blind `eq: () => chain`
// tolerates any column/value (including a wrong-tenant mutant) silently.
let eqCalls: Array<[string, unknown]>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "bookings") {
        return {
          // readByKey chains TWO .eq()s (the vendor key, then business_id).
          // The chain records each call's arguments into eqCalls rather than
          // ignoring them, so the predicate itself is pinned, not just its arity.
          select: () => {
            const chain: any = {
              eq: (...args: unknown[]) => {
                eqCalls.push(args as [string, unknown])
                return chain
              },
              maybeSingle: selectMaybeSingle,
            }
            return chain
          },
          update: () => ({ eq: updateEq }),
          insert: (row: Record<string, unknown>) => {
            lastInsertedRow = row
            return { select: () => ({ single: insertSingle }) }
          },
        }
      }
      if (table === "business_members") return { select: () => ({ eq: () => Promise.resolve({ data: [{ user_id: "admin-1" }], error: null }) }) }
      if (table === "notifications") return { insert: notificationsInsert }
      throw new Error(`unmocked table ${table}`)
    },
  }),
}))

import { ingestBooking, type BookingIngestInput } from "@/lib/bookings/ingest"

function input(overrides: Partial<BookingIngestInput> = {}): BookingIngestInput {
  return {
    source: "calendly",
    businessId: SINGLETON_BUSINESS_ID,
    hostId: "host-singleton",
    connectionId: null,
    chatConversationId: null,
    inviteeTimezone: null,
    key: { column: "calendly_event_uri", value: "https://api.calendly.com/scheduled_events/E1" },
    contact: { name: "Priya Raman", email: "priya@example.test", phone: "+16176504548" },
    bookingDate: "2026-09-08T14:00:00.000Z",
    durationMinutes: 30,
    status: "scheduled",
    notes: null,
    clickIds: { gclid: null, gbraid: null, wbraid: null, fbclid: null },
    columns: { calendly_event_uri: "https://api.calendly.com/scheduled_events/E1", reschedule_url: "https://r", cancel_url: "https://c" },
    actor: "calendly",
    auditSource: "calendly_webhook",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  lastInsertedRow = null
  eqCalls = []
  selectMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  insertSingle = vi.fn().mockResolvedValue({ data: { id: "bk-new" }, error: null })
  updateEq = vi.fn().mockResolvedValue({ error: null })
  notificationsInsert = vi.fn(async () => ({ data: null, error: null }))
  findContactByIdentifiersMock.mockReset().mockResolvedValue(null)
  exitRunsForContactMock.mockReset().mockResolvedValue(0)
  applyPipelineEventMock.mockReset().mockResolvedValue({ decision: { kind: "noop", reason: "t" }, opportunityId: null })
  enqueueBookingConversionMock.mockReset().mockResolvedValue(null)
  findAttributionByEmailMock.mockReset().mockResolvedValue(null)
  recordAuditMock.mockReset().mockResolvedValue(undefined)
})

describe("the 23505 race", () => {
  it("treats a unique violation on insert as 'the other redelivery won' and finishes as an update", async () => {
    // First read: nothing. Insert: refused by the partial unique index.
    // Second read: the row the other delivery inserted.
    insertSingle.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } })
    selectMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: "bk-winner", status: "scheduled", booking_date: "2026-09-08T14:00:00.000Z" }, error: null })

    const result = await ingestBooking(input())

    expect(result).toEqual({ action: "updated", bookingId: "bk-winner" })
    expect(updateEq).toHaveBeenCalledWith("id", "bk-winner")
    // Not a second card, not a second conversion: the create-only consequences did not run.
    expect(enqueueBookingConversionMock).not.toHaveBeenCalled()
    expect(notificationsInsert).not.toHaveBeenCalled()
  })

  it("still throws on any other insert error", async () => {
    // NOT 42703/PGRST204: those two codes are now the deploy-race fallback's
    // own trigger (review round 1, Important 2) and would be silently retried
    // rather than thrown — see "the deploy-race fallback" describe below.
    // 23514 (check_violation) is a genuinely different, unrecoverable failure.
    insertSingle.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "check constraint violated" } })
    await expect(ingestBooking(input())).rejects.toMatchObject({ code: "23514" })
  })

  it("throws on a 23505 with no key to re-read by (nothing sensible to update)", async () => {
    insertSingle.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } })
    await expect(ingestBooking(input({ key: null }))).rejects.toMatchObject({ code: "23505" })
  })
})

describe("the create path", () => {
  it("writes the row, audits booking.created, enqueues the ads conversion with the payload's gclid, and notifies admins", async () => {
    const result = await ingestBooking(input({ clickIds: { gclid: "g-1", gbraid: null, wbraid: null, fbclid: null } }))

    expect(result).toEqual({ action: "created", bookingId: "bk-new" })
    expect(findAttributionByEmailMock).not.toHaveBeenCalled()
    expect(enqueueBookingConversionMock).toHaveBeenCalledWith({
      booking_id: "bk-new",
      booking_date: "2026-09-08T14:00:00.000Z",
      business_id: SINGLETON_BUSINESS_ID,
      gclid: "g-1",
      gbraid: null,
      wbraid: null,
    })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "booking.created",
        actor: { id: null, email: "calendly", role: "system" },
        metadata: expect.objectContaining({ source: "calendly_webhook", status: "scheduled" }),
      }),
    )
    expect(notificationsInsert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: "admin-1", title: "New Call Booked", link: "/admin/bookings" }),
    ])
  })

  it("falls back to the email-matched attribution when the payload carried no gclid", async () => {
    findAttributionByEmailMock.mockResolvedValueOnce({ gclid: "g-email", gbraid: null, wbraid: "w-email", fbclid: null })
    await ingestBooking(input())
    expect(findAttributionByEmailMock).toHaveBeenCalledWith("priya@example.test")
    expect(enqueueBookingConversionMock).toHaveBeenCalledWith(expect.objectContaining({ gclid: "g-email", wbraid: "w-email" }))
  })

  it("does not fail the booking when the ads enqueue throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    enqueueBookingConversionMock.mockRejectedValueOnce(new Error("ads down"))
    const result = await ingestBooking(input({ clickIds: { gclid: "g-1", gbraid: null, wbraid: null, fbclid: null } }))
    expect(result.action).toBe("created")
    err.mockRestore()
  })

  it("runs the contact consequences BEFORE the row is written, in one never-rethrow catch", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("c-1")
    const order: string[] = []
    exitRunsForContactMock.mockImplementationOnce(async () => {
      order.push("exit")
      return 1
    })
    applyPipelineEventMock.mockImplementationOnce(async () => {
      order.push("pipeline")
      return { decision: { kind: "create", toStageKey: "consult_booked", trigger: "booking" }, opportunityId: "o-1" }
    })
    insertSingle.mockImplementationOnce(async () => {
      order.push("insert")
      return { data: { id: "bk-new" }, error: null }
    })
    await ingestBooking(input())
    expect(order).toEqual(["exit", "pipeline", "insert"])
    expect(exitRunsForContactMock).toHaveBeenCalledWith("c-1", "booking", SINGLETON_BUSINESS_ID)
  })
})

describe("the update path", () => {
  const existing = { id: "bk-old", status: "scheduled", booking_date: "2026-09-08T14:00:00.000Z" }

  it("audits booking.cancelled on a status change and does not re-fire create-only consequences", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: existing, error: null })
    const result = await ingestBooking(input({ status: "cancelled" }))
    expect(result).toEqual({ action: "updated", bookingId: "bk-old" })
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "booking.cancelled" }))
    expect(enqueueBookingConversionMock).not.toHaveBeenCalled()
    expect(notificationsInsert).not.toHaveBeenCalled()
  })

  it("audits booking.rescheduled when only the date moved", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: existing, error: null })
    await ingestBooking(input({ bookingDate: "2026-09-09T14:00:00.000Z" }))
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "booking.rescheduled" }))
  })

  it("audits nothing when nothing changed (a plain redelivery)", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: existing, error: null })
    await ingestBooking(input())
    expect(recordAuditMock).not.toHaveBeenCalled()
  })

  it("audits booking.rescheduled, not booking.cancelled, for the cancel half of a reschedule", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: existing, error: null })
    findContactByIdentifiersMock.mockResolvedValueOnce("c-1")
    await ingestBooking(input({ status: "cancelled", rescheduled: true }))
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "booking.rescheduled" }))
    expect(applyPipelineEventMock).not.toHaveBeenCalled()
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })
})

describe("the row each source writes", () => {
  it("never names the Calendly columns on a GHL insert, so the deploy-race window cannot 42703", async () => {
    await ingestBooking(
      input({
        source: "ghl",
        key: { column: "ghl_appointment_id", value: "appt-1" },
        columns: { ghl_contact_id: "ghl-c-1" },
        actor: "ghl",
        auditSource: "ghl_webhook",
      }),
    )
    expect(lastInsertedRow).not.toBeNull()
    const keys = Object.keys(lastInsertedRow!)
    expect(keys).not.toContain("reschedule_url")
    expect(keys).not.toContain("cancel_url")
    expect(keys).not.toContain("calendly_event_uri")
    expect(lastInsertedRow).toMatchObject({ source: "ghl", ghl_appointment_id: "appt-1", ghl_contact_id: "ghl-c-1" })
  })

  it("writes the key column and both invitee links on a Calendly insert", async () => {
    await ingestBooking(input())
    expect(lastInsertedRow).toMatchObject({
      source: "calendly",
      calendly_event_uri: "https://api.calendly.com/scheduled_events/E1",
      reschedule_url: "https://r",
      cancel_url: "https://c",
      ghl_appointment_id: null,
      ghl_contact_id: null,
      contact_phone: "+16176504548",
    })
  })
})

describe("stale redelivery of a 'created' event (review finding 2)", () => {
  const cancelledRow = { id: "bk-old", status: "cancelled", booking_date: "2026-09-08T14:00:00.000Z" }

  it("with ignoreIfTerminal, a scheduled delivery for a cancelled row is acknowledged and changes NOTHING", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    selectMaybeSingle.mockResolvedValueOnce({ data: cancelledRow, error: null })
    findContactByIdentifiersMock.mockResolvedValueOnce("c-1")

    const result = await ingestBooking(input({ ignoreIfTerminal: true }))

    expect(result).toEqual({ action: "updated", bookingId: "bk-old" })
    expect(updateEq).not.toHaveBeenCalled() // the row stays cancelled, note intact
    expect(applyPipelineEventMock).not.toHaveBeenCalled() // no second card
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
    expect(enqueueBookingConversionMock).not.toHaveBeenCalled()
    expect(recordAuditMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("without ignoreIfTerminal (a GoHighLevel status change) the old behaviour stands: the row is updated and the consequences run", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: cancelledRow, error: null })
    findContactByIdentifiersMock.mockResolvedValueOnce("c-1")

    const result = await ingestBooking(input({ source: "ghl", key: { column: "ghl_appointment_id", value: "a-1" } }))

    expect(result.action).toBe("updated")
    expect(updateEq).toHaveBeenCalledWith("id", "bk-old")
    expect(applyPipelineEventMock).toHaveBeenCalled()
  })

  it("ignoreIfTerminal does not swallow a genuine cancel of a scheduled row", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: { ...cancelledRow, status: "scheduled" }, error: null })
    findContactByIdentifiersMock.mockResolvedValueOnce("c-1")
    await ingestBooking(input({ status: "cancelled", ignoreIfTerminal: false }))
    expect(updateEq).toHaveBeenCalledWith("id", "bk-old")
    expect(applyPipelineEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ status: "cancelled" }) }))
  })
})

describe("what counts as a NEW booking (review findings 3 and 4)", () => {
  it("the create half of a reschedule writes the row and moves the card but fires no second conversion or notification, and audits as rescheduled", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("c-1")
    const result = await ingestBooking(
      input({
        clickIds: { gclid: "g-1", gbraid: null, wbraid: null, fbclid: null },
        rescheduledFrom: "https://api.calendly.com/scheduled_events/E0/invitees/I0",
      }),
    )
    expect(result.action).toBe("created")
    expect(applyPipelineEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ status: "scheduled" }) }))
    expect(exitRunsForContactMock).toHaveBeenCalledWith("c-1", "booking", SINGLETON_BUSINESS_ID)
    expect(enqueueBookingConversionMock).not.toHaveBeenCalled()
    expect(notificationsInsert).not.toHaveBeenCalled()
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "booking.rescheduled",
        metadata: expect.objectContaining({ rescheduled_from: "https://api.calendly.com/scheduled_events/E0/invitees/I0" }),
      }),
    )
  })

  it("a first-seen CANCELLED row (create lost, or webhook registered late) gets no conversion and no 'New Call Booked'", async () => {
    const result = await ingestBooking(input({ status: "cancelled", clickIds: { gclid: "g-1", gbraid: null, wbraid: null, fbclid: null } }))
    expect(result.action).toBe("created")
    expect(enqueueBookingConversionMock).not.toHaveBeenCalled()
    expect(notificationsInsert).not.toHaveBeenCalled()
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "booking.created", metadata: expect.objectContaining({ status: "cancelled" }) }))
  })

  it("an ordinary scheduled first booking still converts and notifies (the control)", async () => {
    await ingestBooking(input({ clickIds: { gclid: "g-1", gbraid: null, wbraid: null, fbclid: null } }))
    expect(enqueueBookingConversionMock).toHaveBeenCalledTimes(1)
    expect(notificationsInsert).toHaveBeenCalledTimes(1)
  })
})

const BUSINESS_B = "00000000-0000-0000-0000-0000000000b2"

describe("tenant threading", () => {
  it("passes the input's business to every consequence and stamps it on the row", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("c-9")
    selectMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    insertSingle.mockResolvedValueOnce({ data: { id: "b-9" }, error: null })

    await ingestBooking(input({ businessId: BUSINESS_B, hostId: "host-b", status: "scheduled" }))

    expect(findContactByIdentifiersMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_B }),
    )
    expect(exitRunsForContactMock).toHaveBeenCalledWith("c-9", "booking", BUSINESS_B)
    expect(applyPipelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_B }),
    )
    expect(lastInsertedRow).toMatchObject({
      business_id: BUSINESS_B,
      host_id: "host-b",
      contact_id: "c-9",
    })
  })

  it("derives end_at from booking_date and duration", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    insertSingle.mockResolvedValueOnce({ data: { id: "b-10" }, error: null })

    await ingestBooking(input({ bookingDate: "2026-09-10T14:00:00.000Z", durationMinutes: 45 }))

    expect(lastInsertedRow).toMatchObject({ end_at: "2026-09-10T14:45:00.000Z" })
  })

  // Review round 1, Important 1: the previous version of this suite pinned
  // the INSERT row's business_id but never the READ predicate. A reviewer
  // mutated readByKey's `.eq("business_id", businessId)` to
  // `.eq("business_id", "MUTANT-WRONG-TENANT")` and all tests stayed green,
  // because every mock's eq() was argument-blind. This test pins the actual
  // arguments readByKey applies to the read, so that mutation goes red here.
  it("filters the read by the vendor key AND business_id, so a redelivered key can never match another tenant's row", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    insertSingle.mockResolvedValueOnce({ data: { id: "b-11" }, error: null })

    await ingestBooking(
      input({
        businessId: BUSINESS_B,
        key: { column: "calendly_event_uri", value: "https://api.calendly.com/scheduled_events/E11" },
      }),
    )

    expect(eqCalls).toContainEqual(["calendly_event_uri", "https://api.calendly.com/scheduled_events/E11"])
    expect(eqCalls).toContainEqual(["business_id", BUSINESS_B])
  })

  // Review round 1, Minor 3: `return contactId` used to sit inside the try,
  // after applyPipelineEvent — so a throw there returned null even though the
  // contact WAS resolved, and the row was written with a wrong contact_id: null.
  it("keeps the resolved contact id even when the pipeline hook throws after resolution", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    findContactByIdentifiersMock.mockResolvedValueOnce("c-12")
    applyPipelineEventMock.mockRejectedValueOnce(new Error("pipeline down"))
    selectMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    insertSingle.mockResolvedValueOnce({ data: { id: "b-12" }, error: null })

    await ingestBooking(input())

    expect(lastInsertedRow).toMatchObject({ contact_id: "c-12" })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe("the deploy-race fallback (00241's tenant columns not yet on this instance)", () => {
  // Each test here runs a FRESH copy of lib/bookings/ingest.ts (via
  // resetModules + a dynamic import) so the module-level `tenantColumnsAbsent`
  // sticky flag this fallback sets cannot leak into any other test in this
  // file. The original statically-imported `ingestBooking` used everywhere
  // else keeps its own untouched instance — see __tests__/db/sequences-tenancy
  // .test.ts for the same pattern.

  it("falls back to the pre-00241 row shape when the insert reports PGRST204, and retries once without double-inserting", async () => {
    const insertedRows: Record<string, unknown>[] = []
    let insertCount = 0
    vi.resetModules()
    vi.doMock("@/lib/supabase", () => ({
      createServiceRoleClient: () => ({
        from: (table: string) => {
          if (table !== "bookings") return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
            insert: (row: Record<string, unknown>) => {
              insertedRows.push(row)
              insertCount++
              return {
                select: () => ({
                  single: async () =>
                    insertCount === 1
                      ? {
                          data: null,
                          error: { code: "PGRST204", message: "Could not find the 'business_id' column of 'bookings' in the schema cache" },
                        }
                      : { data: { id: "bk-fallback" }, error: null },
                }),
              }
            },
          }
        },
      }),
    }))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { ingestBooking: freshIngestBooking } = await import("@/lib/bookings/ingest")
    const result = await freshIngestBooking(input({ status: "cancelled" }))

    expect(result).toEqual({ action: "created", bookingId: "bk-fallback" })
    expect(insertCount).toBe(2)
    expect(insertedRows[0]).toMatchObject({ business_id: SINGLETON_BUSINESS_ID, end_at: expect.any(String) })
    for (const col of ["business_id", "host_id", "connection_id", "contact_id", "chat_conversation_id", "end_at", "invitee_timezone"]) {
      expect(insertedRows[1]).not.toHaveProperty(col)
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("00241"))
    warn.mockRestore()
  })

  // Review round 2: the merge race isn't only against 00241. Migration 00239
  // (calendly_event_uri, reschedule_url, cancel_url) is a SEPARATE, still-
  // unmerged migration (feat/calendly-booking, never merged to main). If both
  // are missing at once, a Calendly insert still names 00239's three columns
  // even after 00241's seven are stripped, so the narrowed retry fails too.
  // Setting tenantColumnsAbsent on the bare detection of the FIRST failure
  // (round 1's behaviour) would wedge the instance into legacy mode forever
  // — silently dropping contact_id, host_id, chat_conversation_id,
  // invitee_timezone and end_at on every booking after that, even once every
  // migration has landed. The fix: only set the flag once a narrower retry
  // actually PROVES it by succeeding.
  it("does NOT set the sticky flag when the narrowed retry also fails, so the next booking still attempts the wide row", async () => {
    const insertedRows: Record<string, unknown>[] = []
    let insertCount = 0
    vi.resetModules()
    vi.doMock("@/lib/supabase", () => ({
      createServiceRoleClient: () => ({
        from: (table: string) => {
          if (table !== "bookings") return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
            insert: (row: Record<string, unknown>) => {
              insertedRows.push(row)
              insertCount++
              return {
                select: () => ({
                  single: async () =>
                    // Both the first booking's wide attempt (call 1) AND its
                    // narrowed retry (call 2) fail — simulating 00239 also
                    // being absent, so stripping only 00241's seven columns
                    // is not enough. Call 3 (a SECOND booking) only succeeds
                    // if it is still attempting the wide shape.
                    insertCount <= 2
                      ? {
                          data: null,
                          error: {
                            code: "PGRST204",
                            message: "Could not find the 'calendly_event_uri' column of 'bookings' in the schema cache",
                          },
                        }
                      : { data: { id: "bk-second-call" }, error: null },
                }),
              }
            },
          }
        },
      }),
    }))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { ingestBooking: freshIngestBooking } = await import("@/lib/bookings/ingest")

    // First booking: both attempts fail. The booking is genuinely lost for
    // this one delivery — it must throw, not silently swallow it.
    await expect(freshIngestBooking(input({ status: "cancelled" }))).rejects.toMatchObject({ code: "PGRST204" })
    expect(insertCount).toBe(2)

    // Second booking, same (fresh) module instance. If the flag had been set
    // on the first failure alone, this row would already be narrow. It is
    // not: the instance is still willing to try the wide shape.
    const result = await freshIngestBooking(input({ status: "cancelled", bookingDate: "2026-09-11T14:00:00.000Z" }))
    expect(result).toEqual({ action: "created", bookingId: "bk-second-call" })
    expect(insertCount).toBe(3)
    expect(insertedRows[2]).toMatchObject({ business_id: SINGLETON_BUSINESS_ID, end_at: expect.any(String) })

    warn.mockRestore()
  })

  it("falls back to the pre-00241 row shape when the update reports 42703 for end_at, and retries once", async () => {
    const updatePayloads: Record<string, unknown>[] = []
    let updateCount = 0
    vi.resetModules()
    vi.doMock("@/lib/supabase", () => ({
      createServiceRoleClient: () => ({
        from: (table: string) => {
          if (table !== "bookings") return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: "bk-existing", status: "scheduled", booking_date: "2026-09-08T14:00:00.000Z" },
                    error: null,
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updatePayloads.push(payload)
              updateCount++
              return {
                eq: async () =>
                  updateCount === 1
                    ? { error: { code: "42703", message: `column "end_at" of relation "bookings" does not exist` } }
                    : { error: null },
              }
            },
          }
        },
      }),
    }))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { ingestBooking: freshIngestBooking } = await import("@/lib/bookings/ingest")
    const result = await freshIngestBooking(input({ status: "completed" }))

    expect(result).toEqual({ action: "updated", bookingId: "bk-existing" })
    expect(updateCount).toBe(2)
    expect(updatePayloads[0]).toHaveProperty("end_at")
    expect(updatePayloads[1]).not.toHaveProperty("end_at")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("00241"))
    warn.mockRestore()
  })

  it("falls back to reading without the business_id predicate when the column is missing (42703), and can still recognise the existing row", async () => {
    let selectCount = 0
    vi.resetModules()
    vi.doMock("@/lib/supabase", () => ({
      createServiceRoleClient: () => ({
        from: (table: string) => {
          if (table !== "bookings") return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
          return {
            select: () => {
              selectCount++
              const attempt = selectCount
              const chain: any = {
                eq: () => chain,
                maybeSingle: async () =>
                  attempt === 1
                    ? { data: null, error: { code: "42703", message: "column bookings.business_id does not exist" } }
                    : {
                        data: { id: "bk-legacy", status: "scheduled", booking_date: "2026-09-08T14:00:00.000Z" },
                        error: null,
                      },
              }
              return chain
            },
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: "bk-new" }, error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        },
      }),
    }))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { ingestBooking: freshIngestBooking } = await import("@/lib/bookings/ingest")
    const result = await freshIngestBooking(input({ status: "completed" }))

    expect(selectCount).toBe(2)
    expect(result).toEqual({ action: "updated", bookingId: "bk-legacy" })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("00241"))
    warn.mockRestore()
  })
})
