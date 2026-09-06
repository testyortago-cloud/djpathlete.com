// @vitest-environment node
//
// __tests__/api/admin/events-id-route.test.ts — PATCH + DELETE /api/admin/events/[id]
//
// No prior coverage existed for this route at all. Task 7 (tenancy phase 5a)
// adds `resolveAdminTenantForRequest` and threads `businessId` into
// `getEventById`, `updateEvent`, and `deleteEvent` — every one of those now
// takes TWO string arguments (businessId, id), a shape TypeScript cannot
// catch a swap on. Added so that argument order has a test behind it, not
// just code review.
//
// `@/lib/stripe` is mocked wholesale: the route imports `syncEventToStripe`,
// `archiveAndCreateNewPrice`, and `stripe` unconditionally, and this suite
// never wants a real Stripe call. `@/lib/indexnow` is mocked so the
// fire-and-forget submitUrlToIndexNow call (only reachable on a published
// clinic/camp save, not exercised here) can't reach the network either way.
//
// Sentinel is "admin-biz", never the platform id and never "host-biz" (the
// PUBLIC boundary's own sentinel).

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

const authMock = vi.fn()
const resolveTenantMock = vi.fn()
const getEventByIdMock = vi.fn()
const updateEventMock = vi.fn()
const deleteEventMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
  NoAccessibleBusinessError,
}))
vi.mock("@/lib/db/events", () => ({
  getEventById: (...a: unknown[]) => getEventByIdMock(...a),
  updateEvent: (...a: unknown[]) => updateEventMock(...a),
  deleteEvent: (...a: unknown[]) => deleteEventMock(...a),
  ALLOWED_STATUS_TRANSITIONS: {
    draft: ["published", "cancelled"],
    published: ["draft", "cancelled", "completed"],
    cancelled: [],
    completed: [],
  },
}))
vi.mock("@/lib/stripe", () => ({
  syncEventToStripe: vi.fn(),
  archiveAndCreateNewPrice: vi.fn(),
  stripe: { products: { update: vi.fn() } },
}))
vi.mock("@/lib/indexnow", () => ({ submitUrlToIndexNow: vi.fn(async () => undefined) }))

const currentEvent = {
  id: "evt-1",
  slug: "test-clinic",
  type: "clinic",
  status: "draft",
  price_cents: null,
  stripe_product_id: null,
  stripe_price_id: null,
}

function makePatchReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/events/evt-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeDeleteReq() {
  return new Request("http://localhost/api/admin/events/evt-1", { method: "DELETE" })
}

const ctx = { params: Promise.resolve({ id: "evt-1" }) }

describe("PATCH+DELETE /api/admin/events/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    resolveTenantMock.mockResolvedValue({ businessId: "admin-biz", choices: [], isOperator: true })
    getEventByIdMock.mockResolvedValue(currentEvent)
    updateEventMock.mockResolvedValue({ ...currentEvent, title: "New Title" })
    deleteEventMock.mockResolvedValue(undefined)
  })

  it("PATCH returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce(null)
    const { PATCH } = await import("@/app/api/admin/events/[id]/route")
    const res = await PATCH(makePatchReq({ title: "New Title" }), ctx)
    expect(res.status).toBe(403)
  })

  it("PATCH returns 403 when the caller has no accessible business", async () => {
    resolveTenantMock.mockRejectedValueOnce(new NoAccessibleBusinessError())
    const { PATCH } = await import("@/app/api/admin/events/[id]/route")
    const res = await PATCH(makePatchReq({ title: "New Title" }), ctx)
    expect(res.status).toBe(403)
    expect(getEventByIdMock).not.toHaveBeenCalled()
  })

  // MUTANT: getEventById(id) / updateEvent(id, merged) with no leading
  // businessId. Both remaining params are strings/objects, so a swap or drop
  // compiles clean; this is the only thing that would catch it.
  it("PATCH threads the resolved tenant into getEventById and updateEvent, not the platform id", async () => {
    const { PATCH } = await import("@/app/api/admin/events/[id]/route")
    const res = await PATCH(makePatchReq({ title: "New Title" }), ctx)
    expect(res.status).toBe(200)
    expect(getEventByIdMock).toHaveBeenCalledWith("admin-biz", "evt-1")
    expect(updateEventMock).toHaveBeenCalledWith("admin-biz", "evt-1", expect.objectContaining({ title: "New Title" }))
  })

  it("DELETE returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/admin/events/[id]/route")
    const res = await DELETE(makeDeleteReq(), ctx)
    expect(res.status).toBe(403)
  })

  it("DELETE returns 403 when the caller has no accessible business", async () => {
    resolveTenantMock.mockRejectedValueOnce(new NoAccessibleBusinessError())
    const { DELETE } = await import("@/app/api/admin/events/[id]/route")
    const res = await DELETE(makeDeleteReq(), ctx)
    expect(res.status).toBe(403)
    expect(getEventByIdMock).not.toHaveBeenCalled()
  })

  // MUTANT: getEventById(id) / deleteEvent(id, opts) with no leading
  // businessId — a coach could otherwise delete another tenant's event by id.
  it("DELETE threads the resolved tenant into getEventById and deleteEvent, not the platform id", async () => {
    const { DELETE } = await import("@/app/api/admin/events/[id]/route")
    const res = await DELETE(makeDeleteReq(), ctx)
    expect(res.status).toBe(200)
    expect(getEventByIdMock).toHaveBeenCalledWith("admin-biz", "evt-1")
    expect(deleteEventMock).toHaveBeenCalledWith("admin-biz", "evt-1", { force: false })
  })
})
