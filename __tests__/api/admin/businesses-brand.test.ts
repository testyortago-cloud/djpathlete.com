// @vitest-environment node
// POST /api/admin/businesses/brand — the writer for `business_settings.brand_color`
// / `.accent_color` (see the route's own header for the three-guard reasoning).

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

const updates: { patch: unknown; businessId: string }[] = []
let updateImpl: (patch: unknown, businessId: string) => Promise<unknown> = (patch, businessId) =>
  Promise.resolve({ business_id: businessId, ...(patch as Record<string, unknown>) })

vi.mock("@/lib/db/businesses", () => ({
  updateBusinessSettings: (patch: unknown, businessId: string) => {
    updates.push({ patch, businessId })
    return updateImpl(patch, businessId)
  },
}))

let tenant: unknown = { businessId: "biz-1", choices: [], isOperator: true }
let resolveImpl: () => Promise<unknown> = () => Promise.resolve(tenant)
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => resolveImpl(),
  NoAccessibleBusinessError,
}))

let session: unknown = { user: { id: "op", role: "admin" } }
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: () => Promise.resolve() }))

import { POST } from "@/app/api/admin/businesses/brand/route"

function req(body: unknown) {
  return new Request("http://localhost/api/admin/businesses/brand", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  updates.length = 0
  updateImpl = (patch, businessId) =>
    Promise.resolve({ business_id: businessId, ...(patch as Record<string, unknown>) })
  session = { user: { id: "op", role: "admin" } }
  tenant = { businessId: "biz-1", choices: [], isOperator: true }
  resolveImpl = () => Promise.resolve(tenant)
})

describe("POST /api/admin/businesses/brand", () => {
  it("writes both colours to the CALLER'S resolved tenant, never a body-supplied id", async () => {
    const res = await POST(
      req({ brand_color: "#1e3a8a", accent_color: "#0e7490", businessId: "someone-elses-business" }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0].businessId).toBe("biz-1")
    expect(updates[0].patch).toEqual({ brand_color: "#1e3a8a", accent_color: "#0e7490" })
  })

  it("accepts a null accent_color to clear it without touching brand_color", async () => {
    const res = await POST(req({ brand_color: "#1e3a8a", accent_color: null }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(updates[0].patch).toEqual({ brand_color: "#1e3a8a", accent_color: null })
  })

  it.each([
    ["short hex", { brand_color: "#123", accent_color: null }],
    ["no hash", { brand_color: "1e3a8a", accent_color: null }],
    ["a CSS function, not a colour", { brand_color: "url(javascript:alert(1))", accent_color: null }],
    ["a named colour", { brand_color: "red", accent_color: null }],
    ["an invalid accent", { brand_color: "#1e3a8a", accent_color: "not-a-colour" }],
  ])("answers 400 on %s and never reaches the DAL", async (_label, body) => {
    const res = await POST(req(body), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(updates).toHaveLength(0)
  })

  it("answers 401 with no session", async () => {
    session = null
    const res = await POST(req({ brand_color: "#1e3a8a", accent_color: null }), { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
    expect(updates).toHaveLength(0)
  })

  it("answers 403, not 500, when the caller has no accessible business", async () => {
    resolveImpl = () => Promise.reject(new NoAccessibleBusinessError())
    const res = await POST(req({ brand_color: "#1e3a8a", accent_color: null }), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(updates).toHaveLength(0)
  })

  it("scopes the write to a non-operator's own selected business", async () => {
    session = { user: { id: "coach", role: "staff" } }
    tenant = {
      businessId: "coach-biz",
      choices: [{ id: "coach-biz", name: "Coach", slug: "coach" }],
      isOperator: false,
    }
    const res = await POST(req({ brand_color: "#1e3a8a", accent_color: null }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(updates[0].businessId).toBe("coach-biz")
  })
})
