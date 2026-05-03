import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  findAttributionByEmail: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }))
vi.mock("@/lib/db/marketing-attribution", () => ({
  findAttributionByEmail: mocks.findAttributionByEmail,
  upsertAttributionBySession: vi.fn(),
  getUnclaimedAttribution: vi.fn(),
  claimAttribution: vi.fn(),
}))

import { POST } from "@/app/api/webhooks/ghl-booking/route"

function makeReq(payload: unknown): Request {
  return new Request("http://localhost/api/webhooks/ghl-booking", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

describe("POST /api/webhooks/ghl-booking — gclid capture", () => {
  let bookingsInsert: ReturnType<typeof vi.fn>
  let bookingsSelectMaybeSingle: ReturnType<typeof vi.fn>
  let bookingsUpdateEq: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GHL_WEBHOOK_SECRET

    bookingsSelectMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    bookingsInsert = vi.fn().mockResolvedValue({ error: null })
    bookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })

    mocks.createServiceRoleClient.mockReturnValue({
      from: (table: string) => {
        if (table === "bookings") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: bookingsSelectMaybeSingle }) }),
            update: () => ({ eq: bookingsUpdateEq }),
            insert: bookingsInsert,
          }
        }
        if (table === "users") return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      },
    })

    mocks.findAttributionByEmail.mockResolvedValue(null)
  })

  it("uses gclid from payload when present", async () => {
    const res = await POST(makeReq({
      contact_email: "lead@example.com",
      contact_name: "Jane",
      booking_date: "2026-05-10T15:00:00Z",
      ghl_appointment_id: "appt-1",
      gclid: "g-from-payload",
    }))
    expect(res.status).toBe(201)
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "g-from-payload" }),
    )
    // Email-match fallback should NOT have been called when gclid is in payload
    expect(mocks.findAttributionByEmail).not.toHaveBeenCalled()
  })

  it("falls back to email-match when gclid absent from payload", async () => {
    mocks.findAttributionByEmail.mockResolvedValueOnce({
      id: "attr-x",
      gclid: "g-from-email",
      gbraid: null, wbraid: null, fbclid: null,
    })

    const res = await POST(makeReq({
      contact_email: "lead@example.com",
      contact_name: "Jane",
      booking_date: "2026-05-10T15:00:00Z",
      ghl_appointment_id: "appt-2",
    }))
    expect(res.status).toBe(201)
    expect(mocks.findAttributionByEmail).toHaveBeenCalledWith("lead@example.com")
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "g-from-email" }),
    )
  })

  it("inserts with gclid=null when neither payload nor email match", async () => {
    const res = await POST(makeReq({
      contact_email: "unknown@example.com",
      contact_name: "Unknown",
      booking_date: "2026-05-10T15:00:00Z",
      ghl_appointment_id: "appt-3",
    }))
    expect(res.status).toBe(201)
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: null, gbraid: null, wbraid: null, fbclid: null }),
    )
  })
})
