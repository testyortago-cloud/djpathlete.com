// @vitest-environment node
//
// The seam, closed. app/api/webhooks/calendly/route.ts no longer guesses which
// coach a delivery belongs to: it derives the tenant from the
// coach_calendar_connections row whose event_type_uri matches the delivery.
// This file pins the route's four answers, two of which are safety properties
// rather than features:
//
//   * AN UNRECOGNISED EVENT TYPE GETS A 200, NEVER A 5xx. Calendly disables a
//     subscription after 24 hours of failed deliveries and a disabled
//     subscription has to be recreated by hand, so an event type belonging to
//     somebody else must not look like an outage.
//   * A FAILED READ IS NOT "NO MATCH". PostgREST resolves rather than throws,
//     so a missing table, an expired JWT and a transient fault all arrive
//     looking exactly like "nothing matched". Were that swallowed, it would
//     fall through to the platform ramp and file one coach's booking into
//     another coach's tenant — silently, with a 200, and with nothing
//     afterwards to say it happened. The route answers 500 instead, which
//     Calendly retries.
//
// resolveCalendlyTenant is deliberately NOT mocked here. The resolver and the
// route are one surface: a test that mocked the resolver would pass with the
// two placeholder constants (platformBusinessId / singletonHostId) still
// wired into the ingest call, which is exactly the bug this phase removes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "fs"

import { buildSignatureHeader } from "@/lib/calendly/signature"

const ingestBookingMock = vi.fn(
  async (..._a: any[]): Promise<{ action: "created" | "updated"; bookingId: string | null }> => ({
    action: "created",
    bookingId: "bk-cal-1",
  }),
)
vi.mock("@/lib/bookings/ingest", () => ({
  ingestBooking: (...a: unknown[]) => ingestBookingMock(...a),
}))

// The connection lookup — the tenant proof. Throws on a read error (see its
// own docstring in lib/db/coach-calendar-connections.ts); the rejection case
// below is that throw arriving at the route.
const findByEventTypeMock = vi.fn(async (..._a: any[]) => null as any)
vi.mock("@/lib/db/coach-calendar-connections", () => ({
  findCoachCalendarConnectionByEventType: (...a: unknown[]) => findByEventTypeMock(...a),
}))

const platformHostIdMock = vi.fn(async () => "host-platform" as string | null)
vi.mock("@/lib/tenancy/platform", () => ({
  platformBusinessId: () => "biz-platform",
  platformHostId: () => platformHostIdMock(),
}))

// Nothing in this route may reach the database directly. Any call through
// this mock is the failure the file exists to catch, so it THROWS.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => {
    throw new Error("the route reached the database — it must not")
  },
}))

const KEY = "tenant-resolution-signing-key"
const FIXTURE = JSON.parse(readFileSync("__tests__/fixtures/calendly/invitee-created.json", "utf8"))
const FIXTURE_EVENT_TYPE = "https://api.calendly.com/event_types/EVENTTYPE000001"

function signedRequest(eventType: string | null): Request {
  const scheduled = { ...FIXTURE.payload.scheduled_event }
  if (eventType === null) delete scheduled.event_type
  else scheduled.event_type = eventType
  const raw = JSON.stringify({ ...FIXTURE, payload: { ...FIXTURE.payload, scheduled_event: scheduled } })
  return new Request("http://localhost/api/webhooks/calendly", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "calendly-webhook-signature": buildSignatureHeader({
        rawBody: raw,
        signingKey: KEY,
        timestampSeconds: Math.floor(Date.now() / 1000),
      }),
    },
    body: raw,
  })
}

async function post(eventType: string | null) {
  const { POST } = await import("@/app/api/webhooks/calendly/route")
  return POST(signedRequest(eventType))
}

beforeEach(() => {
  vi.clearAllMocks()
  ingestBookingMock.mockReset().mockResolvedValue({ action: "created", bookingId: "bk-cal-1" })
  findByEventTypeMock.mockReset().mockResolvedValue(null)
  platformHostIdMock.mockReset().mockResolvedValue("host-platform")
  process.env.CALENDLY_WEBHOOK_SIGNING_KEY = KEY
  delete process.env.CALENDLY_EVENT_TYPE_URI
})

afterEach(() => {
  delete process.env.CALENDLY_WEBHOOK_SIGNING_KEY
  delete process.env.CALENDLY_EVENT_TYPE_URI
})

describe("the Calendly webhook resolves its tenant from the connection row", () => {
  it("ingests against the MATCHED ROW's business, host and connection — not the platform's", async () => {
    findByEventTypeMock.mockResolvedValue({
      id: "conn-coach-2",
      business_id: "biz-coach-2",
      host_id: "host-coach-2",
      event_type_uri: FIXTURE_EVENT_TYPE,
    })

    const res = await post(FIXTURE_EVENT_TYPE)

    expect(res.status).toBe(201)
    expect(findByEventTypeMock).toHaveBeenCalledWith(FIXTURE_EVENT_TYPE)
    expect(ingestBookingMock).toHaveBeenCalledTimes(1)
    // The VALUES, not merely that ingest was called: a test asserting only
    // "it ingested" is just as green with the two placeholders still in place.
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.businessId).toBe("biz-coach-2")
    expect(input.hostId).toBe("host-coach-2")
    expect(input.connectionId).toBe("conn-coach-2")
  })

  it("matches on the event type even when a DIFFERENT one is the configured ramp", async () => {
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/PLATFORM"
    findByEventTypeMock.mockResolvedValue({
      id: "conn-coach-3",
      business_id: "biz-coach-3",
      host_id: "host-coach-3",
      event_type_uri: FIXTURE_EVENT_TYPE,
    })

    const res = await post(FIXTURE_EVENT_TYPE)

    expect(res.status).toBe(201)
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.businessId).toBe("biz-coach-3")
    expect(input.hostId).toBe("host-coach-3")
    expect(input.connectionId).toBe("conn-coach-3")
  })
})

describe("the platform ramp", () => {
  // Approach A, not a hard cutover: migrations apply to production on push to
  // main while Vercel is still building, so between the deploy and the owner
  // clicking Connect there would otherwise be a window in which every real
  // booking was silently dropped. The ramp keeps today's single-coach install
  // working, and warns so its use is visible in the logs.
  it("ingests against the PLATFORM's ids, with no connection, when only the env event type matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.CALENDLY_EVENT_TYPE_URI = FIXTURE_EVENT_TYPE
    findByEventTypeMock.mockResolvedValue(null)

    const res = await post(FIXTURE_EVENT_TYPE)

    expect(res.status).toBe(201)
    expect(ingestBookingMock).toHaveBeenCalledTimes(1)
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.businessId).toBe("biz-platform")
    expect(input.hostId).toBe("host-platform")
    expect(input.connectionId).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(FIXTURE_EVENT_TYPE))
    warn.mockRestore()
  })
})

describe("an event type this install does not know about", () => {
  it("answers 200 and ingests NOTHING when neither a row nor the env matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/PLATFORM"
    findByEventTypeMock.mockResolvedValue(null)

    const res = await post("https://api.calendly.com/event_types/SOMEONE_ELSE")

    expect(res.status).toBe(200)
    expect((await res.json()).ignored).toBe(true)
    expect(ingestBookingMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // CONTROL for the constraint itself, stated as a range rather than a value:
  // Calendly disables a subscription after 24 hours of failed deliveries, and
  // a disabled subscription must be recreated by hand. This is the state of a
  // fresh deploy — the migration has landed, nobody has clicked Connect, and
  // no ramp is configured. It must not be an outage.
  it("NEVER answers 5xx for an unrecognised event type, even with no ramp configured at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    findByEventTypeMock.mockResolvedValue(null)

    const res = await post("https://api.calendly.com/event_types/SOMEONE_ELSE")

    expect(res.status).toBe(200)
    expect(res.status).toBeLessThan(500)
    expect(ingestBookingMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("fails CLOSED on a delivery carrying no event type at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.CALENDLY_EVENT_TYPE_URI = FIXTURE_EVENT_TYPE
    findByEventTypeMock.mockResolvedValue(null)

    const res = await post(null)

    expect(res.status).toBe(200)
    expect(ingestBookingMock).not.toHaveBeenCalled()
    expect(findByEventTypeMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("a failed read is not 'no match'", () => {
  it("answers 500 so Calendly RETRIES, rather than filing the booking under the platform", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    // The control that makes this test meaningful: the env ramp is configured
    // for THIS event type, so a swallowed read error would take the ramp and
    // answer 201 with the platform's ids. The failure is distinguishable.
    process.env.CALENDLY_EVENT_TYPE_URI = FIXTURE_EVENT_TYPE
    findByEventTypeMock.mockRejectedValue(
      new Error("findCoachCalendarConnectionByEventType failed (PGRST301): JWT expired"),
    )

    const res = await post(FIXTURE_EVENT_TYPE)

    expect(res.status).toBe(500)
    expect(ingestBookingMock).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
