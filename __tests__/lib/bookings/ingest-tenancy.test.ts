// @vitest-environment node
//
// Two behaviours that are invisible to the existing suites because both are
// correct-by-accident while one business exists: who gets notified, and in
// which timezone the notification is worded.
//
// The recipients query moves from `users where role='admin'` (a cross-tenant
// broadcast the day a second business exists) to `business_members` filtered
// by `business_id` — every member of THIS business, owner/coach/staff alike.
// The date string moves from an unqualified toLocaleString (the server
// process zone, which Vercel cannot even set — TZ is reserved) to the
// business's own timezone from `business_settings`.
import { describe, it, expect, vi, beforeEach } from "vitest"

const SINGLETON = "00000000-0000-0000-0000-000000000001"
const BUSINESS_B = "00000000-0000-0000-0000-0000000000b2"

const findContactByIdentifiersMock = vi.fn(async (..._a: any[]) => null as string | null)
const getContactUserIdMock = vi.fn(async (..._a: any[]) => null as string | null)
const exitRunsForContactMock = vi.fn(async (..._a: any[]) => 0)
const applyPipelineEventMock = vi.fn(async (..._a: any[]): Promise<any> => ({ decision: { kind: "noop", reason: "t" }, opportunityId: null }))
const enqueueBookingConversionMock = vi.fn(async (..._a: any[]) => null)
const findAttributionForContactMock = vi.fn(async (..._a: any[]) => null as any)
const recordAuditMock = vi.fn(async (..._a: any[]) => undefined)

vi.mock("@/lib/db/contacts", () => ({
  findContactByIdentifiers: (...a: unknown[]) => findContactByIdentifiersMock(...a),
  getContactUserId: (...a: unknown[]) => getContactUserIdMock(...a),
}))
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: (...a: unknown[]) => exitRunsForContactMock(...a) }))
vi.mock("@/lib/db/pipeline", () => ({ applyPipelineEvent: (...a: unknown[]) => applyPipelineEventMock(...a) }))
vi.mock("@/lib/ads/conversions", () => ({ enqueueBookingConversion: (...a: unknown[]) => enqueueBookingConversionMock(...a) }))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionForContact: (...a: unknown[]) => findAttributionForContactMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: vi.fn(async (id: string) => ({
    business_id: id,
    timezone: id === BUSINESS_B ? "Australia/Sydney" : "America/New_York",
    display_name: "Test",
  })),
}))

let memberRowsByBusiness: Record<string, Array<{ user_id: string }>>
let notificationsInserted: Array<Record<string, unknown>> | null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "bookings") {
        return {
          select: () => {
            const chain: any = { eq: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: null }) }
            return chain
          },
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "bk-1" }, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      if (table === "business_members") {
        return {
          select: () => ({
            eq: (_c: string, businessId: string) => Promise.resolve({ data: memberRowsByBusiness[businessId] ?? [], error: null }),
          }),
        }
      }
      if (table === "notifications") {
        return {
          insert: (rows: any) => {
            notificationsInserted = rows
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === "users") throw new Error("the fan-out must not read users directly any more")
      throw new Error(`unmocked table ${table}`)
    },
  }),
}))

import { ingestBooking, type BookingIngestInput } from "@/lib/bookings/ingest"

function input(overrides: Partial<BookingIngestInput> = {}): BookingIngestInput {
  return {
    source: "calendly",
    businessId: SINGLETON,
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
  findContactByIdentifiersMock.mockReset().mockResolvedValue(null)
  getContactUserIdMock.mockReset().mockResolvedValue(null)
  exitRunsForContactMock.mockReset().mockResolvedValue(0)
  applyPipelineEventMock.mockReset().mockResolvedValue({ decision: { kind: "noop", reason: "t" }, opportunityId: null })
  enqueueBookingConversionMock.mockReset().mockResolvedValue(null)
  findAttributionForContactMock.mockReset().mockResolvedValue(null)
  recordAuditMock.mockReset().mockResolvedValue(undefined)

  memberRowsByBusiness = {
    [SINGLETON]: [{ user_id: "admin-1" }, { user_id: "admin-2" }],
    [BUSINESS_B]: [{ user_id: "coach-b" }],
  }
  notificationsInserted = null
})

describe("booking notification fan-out", () => {
  it("notifies every member of THIS business — the presence control", async () => {
    await ingestBooking(input({ businessId: SINGLETON, status: "scheduled" }))
    expect(notificationsInserted).toHaveLength(2)
    expect(notificationsInserted!.map((n) => n.user_id).sort()).toEqual(["admin-1", "admin-2"])
  })

  it("notifies no member of another business", async () => {
    await ingestBooking(
      input({
        businessId: BUSINESS_B,
        status: "scheduled",
        key: { column: "calendly_event_uri", value: "https://api.calendly.com/scheduled_events/EB" },
      }),
    )
    expect(notificationsInserted).toHaveLength(1)
    expect(notificationsInserted![0].user_id).toBe("coach-b")
  })

  it("words the time in the business's zone, not the server's", async () => {
    // 2026-09-10T14:00Z is 10:00 AM in New York and 12:00 AM the next day in Sydney.
    await ingestBooking(
      input({
        businessId: BUSINESS_B,
        bookingDate: "2026-09-10T14:00:00.000Z",
        key: { column: "calendly_event_uri", value: "https://api.calendly.com/scheduled_events/EB2" },
      }),
    )
    expect(String(notificationsInserted![0].message)).toContain("Sep 11")
    expect(String(notificationsInserted![0].message)).not.toContain("Sep 10")
  })

  it("still notifies when the business has no settings row", async () => {
    const { getBusinessSettings } = await import("@/lib/db/businesses")
    vi.mocked(getBusinessSettings).mockRejectedValueOnce(new Error("business_settings row missing"))
    await ingestBooking(input({ businessId: SINGLETON, status: "scheduled" }))
    expect(notificationsInserted).toHaveLength(2)
  })
})

// enqueueBookingConversion's own second singleton (accounts[0], independent of
// business_id) is closed by making BookingConversionInput.business_id
// required — see lib/ads/conversions.ts and lib/db/google-ads-accounts.ts.
// This suite only owns the wiring: that ingest threads input.businessId
// through to the conversion enqueue call.
describe("ads conversion tenancy", () => {
  it("enqueues against this business's account", async () => {
    await ingestBooking(
      input({
        businessId: BUSINESS_B,
        status: "scheduled",
        key: { column: "calendly_event_uri", value: "https://api.calendly.com/scheduled_events/EB3" },
        clickIds: { gclid: "g1", gbraid: null, wbraid: null, fbclid: null },
      }),
    )
    expect(enqueueBookingConversionMock).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: BUSINESS_B }),
    )
  })
})
