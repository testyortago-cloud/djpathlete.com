// @vitest-environment node
//
// PATCH /api/admin/bookings — the status change behind the row menu on
// /admin/bookings (components/admin/BookingList.tsx).
//
// G35. This route resolved NO tenant, and both DAL calls under it filtered on
// `id` alone. `schedule` is a grantable permission (the Coach preset carries
// it), and the route answers with the updated row, contact name, email and
// phone included — so any holder could change, and read back, any business's
// booking by id. Three things this file holds:
//
//  1. THE TENANT IS RESOLVED, NEVER TAKEN FROM THE CALLER. A `businessId` in
//     the body changes nothing; both DAL calls get the RESOLVED one, first.
//  2. A BOOKING OF ANOTHER BUSINESS IS A 404, and nothing is written or
//     audited. The DAL answers `null` for it (its own suite proves that with
//     a row-narrowing fake); this file proves the route turns `null` into a
//     404 before the write, instead of the 500 a PGRST116 used to produce.
//  3. NO ACCESSIBLE BUSINESS IS A 403, before any read.
//
// Node environment pinned: see __tests__/app/api/admin/contacts/contacts-route.test.ts
// for why a suite under this folder that inherits jsdom can report "no tests".
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const resolveTenantMock = vi.fn()
const getBookingByIdMock = vi.fn()
const updateBookingStatusMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessMock(...a),
}))
vi.mock("@/lib/db/bookings", () => ({
  getBookingById: (...a: unknown[]) => getBookingByIdMock(...a),
  updateBookingStatus: (...a: unknown[]) => updateBookingStatusMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({
  recordAudit: (...a: unknown[]) => recordAuditMock(...a),
}))
// Declared INSIDE the factory and imported back below — vi.mock is hoisted, so
// a top-level class referenced from the factory would still be in its temporal
// dead zone when the factory runs.
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

import { PATCH } from "@/app/api/admin/bookings/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

/** The coach's own tenant — deliberately NOT a platform-looking id. */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
/** Somebody else's. Only ever sent by a caller trying it on. */
const OTHER_BUSINESS_ID = "33333333-3333-3333-3333-333333333333"
const BOOKING_ID = "44444444-4444-4444-8444-444444444444"

const BOOKING = {
  id: BOOKING_ID,
  business_id: BUSINESS_ID,
  contact_name: "Dana Reyes",
  contact_email: "dana@example.com",
  contact_phone: "+12025550123",
  booking_date: "2026-09-26T15:00:00.000Z",
  status: "scheduled",
}

function patch(body: unknown) {
  return PATCH(
    new Request("https://www.darrenjpaul.com/api/admin/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left
  // behind by a previous test leaks otherwise.
  vi.resetAllMocks()
  authMock.mockResolvedValue({ user: { id: "staff-1", role: "staff", permissions: {} } })
  canAccessMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
  getBookingByIdMock.mockResolvedValue(BOOKING)
  updateBookingStatusMock.mockResolvedValue({ ...BOOKING, status: "completed" })
  recordAuditMock.mockResolvedValue(undefined)
})

describe("PATCH /api/admin/bookings — tenant scope (G35)", () => {
  it("reads and writes under the RESOLVED business, not one from the body (MUTANT: route skips resolveAdminTenantForRequest)", async () => {
    const res = await patch({ id: BOOKING_ID, status: "completed", businessId: OTHER_BUSINESS_ID })

    expect(res.status).toBe(200)
    expect(getBookingByIdMock).toHaveBeenCalledWith(BUSINESS_ID, BOOKING_ID)
    expect(updateBookingStatusMock).toHaveBeenCalledWith(BUSINESS_ID, BOOKING_ID, "completed", undefined)
    // The id in the body reached neither call.
    expect(JSON.stringify(getBookingByIdMock.mock.calls)).not.toContain(OTHER_BUSINESS_ID)
    expect(JSON.stringify(updateBookingStatusMock.mock.calls)).not.toContain(OTHER_BUSINESS_ID)
  })

  it("404s a booking of another business, writes nothing and audits nothing (MUTANT: no null check before the write)", async () => {
    // What the scoped DAL answers for an id filed under another business.
    getBookingByIdMock.mockResolvedValue(null)

    const res = await patch({ id: BOOKING_ID, status: "cancelled" })

    expect(res.status).toBe(404)
    expect(updateBookingStatusMock).not.toHaveBeenCalled()
    expect(recordAuditMock).not.toHaveBeenCalled()
    // Nothing of the booking leaks in the refusal.
    const text = await res.text()
    expect(text).not.toContain("dana@example.com")
  })

  it("control: the same request for this business's booking succeeds, returns it, and audits the transition", async () => {
    // The presence half of the 404 above: without it, a route that refused
    // everything would pass that test too.
    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; booking: { id: string; status: string } }
    expect(json.success).toBe(true)
    expect(json.booking).toMatchObject({ id: BOOKING_ID, status: "completed" })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "booking.completed",
        target: expect.objectContaining({ type: "booking", id: BOOKING_ID }),
        metadata: { from_status: "scheduled", to_status: "completed" },
      }),
    )
  })

  it("404s, and audits nothing, when the scoped write matches no row", async () => {
    // The row stopped matching between the read and the write. The write
    // carries the predicate too, and its `null` must not become a 200 with no
    // booking in it — nor an audit row for a change that never happened.
    updateBookingStatusMock.mockResolvedValue(null)

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(404)
    expect(recordAuditMock).not.toHaveBeenCalled()
  })

  it("403s when no business can be resolved for this user, before any read", async () => {
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(403)
    expect(getBookingByIdMock).not.toHaveBeenCalled()
    expect(updateBookingStatusMock).not.toHaveBeenCalled()
  })

  it("500s, and writes nothing, when the snapshot read fails (it used to be swallowed)", async () => {
    // `.catch(() => null)` on this read turned a failed read into "no
    // snapshot" and went on to write. A 404 would be a lie here too: the
    // booking may well exist.
    getBookingByIdMock.mockRejectedValue(new Error("connection reset"))

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(500)
    expect(updateBookingStatusMock).not.toHaveBeenCalled()
  })

  it("401s without a session, before resolving a tenant", async () => {
    authMock.mockResolvedValue(null)

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(401)
    expect(resolveTenantMock).not.toHaveBeenCalled()
    expect(getBookingByIdMock).not.toHaveBeenCalled()
  })
})
