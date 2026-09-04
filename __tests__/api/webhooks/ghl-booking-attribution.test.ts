// @vitest-environment node
//
// Pinned to node (Full Engine phase 2): these suites drive route handlers with
// Request/Response and never touch a DOM, and every jsdom suite in this repo
// currently fails to start (ERR_REQUIRE_ESM in html-encoding-sniffer). Without
// this line the file reports "no tests" rather than red.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  findAttributionForContact: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }))
vi.mock("@/lib/db/marketing-attribution", () => ({
  findAttributionForContact: mocks.findAttributionForContact,
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
  // findContactByIdentifiers and getContactUserId (lib/db/contacts.ts) are
  // NOT module-mocked in this file — they run for real against the mocked
  // supabase client below, the same way the real route does. Setting this
  // fixture is how a test gives the webhook "an existing contact who is
  // also a registered user", which is the only path that can now reach
  // findAttributionForContact — see its own docstring for why the lookup is
  // keyed on the CONTACT's user_id rather than the raw booking email.
  let contactFixture: { id: string; email: string; user_id: string | null } | null

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GHL_WEBHOOK_SECRET

    bookingsSelectMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    bookingsInsert = vi.fn().mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "bk-1" }, error: null }) }),
    })
    bookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })
    contactFixture = null

    mocks.createServiceRoleClient.mockReturnValue({
      from: (table: string) => {
        if (table === "bookings") {
          return {
            // readByKey chains TWO .eq()s now (the vendor key, then business_id).
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: bookingsSelectMaybeSingle }) }) }),
            update: () => ({ eq: bookingsUpdateEq }),
            insert: bookingsInsert,
          }
        }
        if (table === "users") return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }
        // platformHostId's chain: select().eq().order().limit().maybeSingle().
        // No booking_hosts row in these fixtures — hostId resolves to null,
        // which nothing in this suite asserts on.
        if (table === "booking_hosts") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
                }),
              }),
            }),
          }
        }
        // Generic double for findContactByIdentifiers (`.select("id").eq(business_id).eq(email).maybeSingle()`)
        // and getContactUserId (`.select("user_id").eq(business_id).eq(id).maybeSingle()`).
        // Both chain exactly select -> eq -> eq -> maybeSingle, so one fake
        // handles either shape by matching whichever filters were applied.
        if (table === "contacts") {
          return {
            select: (cols: string) => {
              const filters: Record<string, unknown> = {}
              const chain: Record<string, unknown> = {
                eq: (col: string, val: unknown) => {
                  filters[col] = val
                  return chain
                },
                maybeSingle: async () => {
                  if (!contactFixture) return { data: null, error: null }
                  if (filters.email !== undefined && filters.email !== contactFixture.email) {
                    return { data: null, error: null }
                  }
                  if (filters.id !== undefined && filters.id !== contactFixture.id) {
                    return { data: null, error: null }
                  }
                  const wantsUserId = cols.includes("user_id")
                  return { data: wantsUserId ? { user_id: contactFixture.user_id } : { id: contactFixture.id }, error: null }
                },
              }
              return chain
            },
          }
        }
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      },
    })

    mocks.findAttributionForContact.mockResolvedValue(null)
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
    // Attribution fallback should NOT have been called when gclid is in payload
    expect(mocks.findAttributionForContact).not.toHaveBeenCalled()
  })

  // Retargeted: the lookup is now keyed on the resolved contact's own
  // user_id, not the raw booking email — see findAttributionForContact's
  // docstring. A "lead@example.com" who is ALSO a registered user (a real
  // contact row with a linked user_id) is what makes the fallback reachable
  // at all now; most leads have no user_id and the lookup is skipped for them
  // (see the next test).
  it("falls back to the resolved contact's own attribution when gclid absent from payload", async () => {
    contactFixture = { id: "contact-2", email: "lead@example.com", user_id: "user-2" }
    mocks.findAttributionForContact.mockResolvedValueOnce({
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
    expect(mocks.findAttributionForContact).toHaveBeenCalledWith({ userId: "user-2" })
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "g-from-email" }),
    )
  })

  it("inserts with gclid=null when neither payload nor a linked user_id supplies one", async () => {
    // No contactFixture: this lead has no contact record (or none with a
    // user_id) — the ordinary case, and the attribution lookup must be
    // skipped entirely rather than falling back to anything looser.
    const res = await POST(makeReq({
      contact_email: "unknown@example.com",
      contact_name: "Unknown",
      booking_date: "2026-05-10T15:00:00Z",
      ghl_appointment_id: "appt-3",
    }))
    expect(res.status).toBe(201)
    expect(mocks.findAttributionForContact).not.toHaveBeenCalled()
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: null, gbraid: null, wbraid: null, fbclid: null }),
    )
  })
})
