// @vitest-environment node
//
// __tests__/api/admin/events-duplicate-route.test.ts — POST /api/admin/events/[id]/duplicate
//
// No prior coverage existed for this route at all. Task 7 (tenancy phase 5a)
// adds `resolveAdminTenantForRequest` and threads `businessId` into
// `getEventById`, `getEventBySlug`, and `createEvent` — all now take a
// leading businessId string, a shape TypeScript cannot catch a swap on.
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
const getEventBySlugMock = vi.fn()
const createEventMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
  NoAccessibleBusinessError,
}))
vi.mock("@/lib/db/events", () => ({
  getEventById: (...a: unknown[]) => getEventByIdMock(...a),
  getEventBySlug: (...a: unknown[]) => getEventBySlugMock(...a),
  createEvent: (...a: unknown[]) => createEventMock(...a),
}))

const sourceEvent = {
  id: "evt-1",
  type: "clinic",
  slug: "test-clinic",
  title: "Test Clinic",
  summary: "S",
  description: "D",
  focus_areas: [],
  audience: [],
  location_name: "L",
  location_address: null,
  location_map_url: null,
  capacity: 10,
  hero_image_url: null,
  age_min: null,
  age_max: null,
  start_date: new Date(Date.now() + 86400000).toISOString(),
  end_date: null,
  session_schedule: null,
  price_cents: null,
}

function makeReq() {
  return new Request("http://localhost/api/admin/events/evt-1/duplicate", { method: "POST" })
}

const ctx = { params: Promise.resolve({ id: "evt-1" }) }

describe("POST /api/admin/events/[id]/duplicate", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    resolveTenantMock.mockResolvedValue({ businessId: "admin-biz", choices: [], isOperator: true })
    getEventByIdMock.mockResolvedValue(sourceEvent)
    getEventBySlugMock.mockResolvedValue(null)
    createEventMock.mockResolvedValue({ id: "evt-copy", slug: "test-clinic-copy" })
  })

  it("returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/admin/events/[id]/duplicate/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(403)
  })

  it("returns 403 when the caller has no accessible business", async () => {
    resolveTenantMock.mockRejectedValueOnce(new NoAccessibleBusinessError())
    const { POST } = await import("@/app/api/admin/events/[id]/duplicate/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(403)
    expect(getEventByIdMock).not.toHaveBeenCalled()
  })

  it("returns 404 when the source event does not exist in this tenant", async () => {
    getEventByIdMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/admin/events/[id]/duplicate/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(404)
  })

  // MUTANT: getEventById(id) / getEventBySlug(slug) / createEvent(input) with
  // no leading businessId. A dropped businessId here would duplicate (or
  // collide slugs against) another tenant's event.
  it("threads the resolved tenant into getEventById, getEventBySlug, and createEvent, not the platform id", async () => {
    const { POST } = await import("@/app/api/admin/events/[id]/duplicate/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(201)
    expect(getEventByIdMock).toHaveBeenCalledWith("admin-biz", "evt-1")
    expect(getEventBySlugMock).toHaveBeenCalledWith("admin-biz", "test-clinic-copy")
    expect(createEventMock).toHaveBeenCalledWith(
      "admin-biz",
      expect.objectContaining({ slug: "test-clinic-copy", type: "clinic" }),
    )
  })
})
