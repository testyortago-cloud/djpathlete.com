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

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "bookings") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: selectMaybeSingle }) }),
          update: () => ({ eq: updateEq }),
          insert: (row: Record<string, unknown>) => {
            lastInsertedRow = row
            return { select: () => ({ single: insertSingle }) }
          },
        }
      }
      if (table === "users") return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "admin-1" }], error: null }) }) }
      if (table === "notifications") return { insert: notificationsInsert }
      throw new Error(`unmocked table ${table}`)
    },
  }),
}))

import { ingestBooking, type BookingIngestInput } from "@/lib/bookings/ingest"

function input(overrides: Partial<BookingIngestInput> = {}): BookingIngestInput {
  return {
    source: "calendly",
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
    insertSingle.mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column does not exist" } })
    await expect(ingestBooking(input())).rejects.toMatchObject({ code: "42703" })
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
