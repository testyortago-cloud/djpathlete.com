// @vitest-environment node
//
// __tests__/api/admin/events.test.ts — POST /api/admin/events
//
// Historically this file mocked ONLY `@/lib/auth`, so its two pre-existing
// tests (400 on invalid body, 403 when not admin) both short-circuit before
// the route ever reaches `resolveAdminTenantForRequest` or the DAL — neither
// touches the real Supabase client `@/lib/db/events` calls into. Task 7 adds
// `resolveAdminTenant`/`resolveAdminTenantForRequest` to this route, and the
// success path threads a `businessId` into `createEvent`/`updateEvent`.
//
// `@/lib/db/events` and `@/lib/tenancy/resolve` are now BOTH mocked so the
// new happy-path/tenant-threading tests never reach the dev clone
// (project anjvztjiokcgiyhobknq, per `.env.local`) — the pre-existing 400/403
// tests already didn't, and mocking the DAL here keeps it that way for the
// new tests too, so this file creates no rows and needs no cleanup.
//
// Sentinel is "admin-biz", never the platform id and never "host-biz" (that
// one is the PUBLIC boundary's sentinel — using it here would let a bug that
// crossed the admin/public boundary pass unnoticed).

import { describe, it, expect, vi, beforeEach } from "vitest"

const { NoAccessibleBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {
    constructor() {
      super("This account has no business it can access")
      this.name = "NoAccessibleBusinessError"
    }
  }
  return { NoAccessibleBusinessError }
})

const createEventMock = vi.fn()
const updateEventMock = vi.fn()
const resolveTenantMock = vi.fn()

// Mock auth() to return an admin session.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "admin-1", email: "a@x.com", role: "admin" } })),
}))

vi.mock("@/lib/db/events", () => ({
  createEvent: (...a: unknown[]) => createEventMock(...a),
  updateEvent: (...a: unknown[]) => updateEventMock(...a),
}))

// Mocked, or the route's resolveAdminTenantForRequest reaches a real
// Supabase client and this stops being a unit test — same reasoning as
// app/api/admin/pipeline/move/route.ts's test.
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
  NoAccessibleBusinessError,
}))

const validClinicBody = {
  type: "clinic",
  title: "Test Clinic",
  slug: "test-clinic",
  summary: "A clinic",
  description: "A clinic for testing",
  location_name: "Somewhere",
  capacity: 10,
  start_date: new Date(Date.now() + 86400000).toISOString(),
  status: "draft",
}

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

describe("POST /api/admin/events", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resolveTenantMock.mockResolvedValue({ businessId: "admin-biz", choices: [], isOperator: true })
    createEventMock.mockResolvedValue({ id: "evt-new", status: "draft", price_cents: null })
  })

  it("returns 400 on invalid body", async () => {
    const authMod = await import("@/lib/auth")
    vi.mocked(authMod.auth).mockResolvedValue({ user: { id: "admin-1", email: "a@x.com", role: "admin" } } as never)
    const { POST } = await import("@/app/api/admin/events/route")
    const res = await POST(makeReq({ type: "clinic" }))
    expect(res.status).toBe(400)
  })

  it("returns 403 when not admin", async () => {
    const authMod = await import("@/lib/auth")
    vi.mocked(authMod.auth).mockResolvedValueOnce(null as never)
    const { POST } = await import("@/app/api/admin/events/route")
    const res = await POST(makeReq({}))
    expect(res.status).toBe(403)
  })

  it("returns 403 when the caller has no accessible business", async () => {
    const authMod = await import("@/lib/auth")
    vi.mocked(authMod.auth).mockResolvedValue({ user: { id: "admin-1", email: "a@x.com", role: "admin" } } as never)
    resolveTenantMock.mockRejectedValueOnce(new NoAccessibleBusinessError())
    const { POST } = await import("@/app/api/admin/events/route")
    const res = await POST(makeReq(validClinicBody))
    expect(res.status).toBe(403)
    expect(createEventMock).not.toHaveBeenCalled()
  })

  // MUTANT: createEvent(result.data) with no businessId. That is exactly the
  // bug this test exists to catch — a coach's event would be created under
  // whatever business_id lib/db/events.ts's createEvent might otherwise
  // fall back to, rather than the caller's own tenant.
  it("threads the resolved tenant into createEvent, not the platform id", async () => {
    const authMod = await import("@/lib/auth")
    vi.mocked(authMod.auth).mockResolvedValue({ user: { id: "admin-1", email: "a@x.com", role: "admin" } } as never)
    const { POST } = await import("@/app/api/admin/events/route")
    const res = await POST(makeReq(validClinicBody))
    expect(res.status).toBe(201)
    expect(createEventMock).toHaveBeenCalledWith("admin-biz", expect.objectContaining({ slug: "test-clinic" }))
  })
})
