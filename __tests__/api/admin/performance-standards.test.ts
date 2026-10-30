// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccess = vi.fn()
const tenant = vi.fn()
const saveStandard = vi.fn()
const deleteStandard = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (...a: unknown[]) => canAccess(...a) }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenantForRequest: (...a: unknown[]) => tenant(...a) }))
vi.mock("@/lib/db/performance-standards", () => ({
  listStandards: vi.fn(async () => []),
  saveStandard: (...a: unknown[]) => saveStandard(...a),
  deleteStandard: (...a: unknown[]) => deleteStandard(...a),
}))

import { DELETE, POST } from "@/app/api/admin/performance-standards/route"

const ctx = { params: Promise.resolve({}) }
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/admin/performance-standards", { method: "POST", body: JSON.stringify(body) }),
    ctx,
  )
const good = { test_type: "cmj", age_min: 12, age_max: 15, floor_value: 20, trained_value: 35, elite_value: 50 }
const ID = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  canAccess.mockReset().mockResolvedValue(true)
  tenant.mockReset().mockResolvedValue({ businessId: "biz-A" })
  saveStandard.mockReset().mockImplementation(async (_b: string, r: object) => ({ id: ID, business_id: "biz-A", ...r }))
  deleteStandard.mockReset().mockResolvedValue(true)
})

describe("POST /api/admin/performance-standards", () => {
  it("403s for someone without admin access and writes nothing", async () => {
    canAccess.mockResolvedValue(false)
    expect((await post(good)).status).toBe(403)
    expect(saveStandard).not.toHaveBeenCalled()
  })
  it("saves into the caller's own business, never one named in the body", async () => {
    const res = await post({ ...good, business_id: "biz-B" })
    expect(res.status).toBe(200)
    expect(saveStandard).toHaveBeenCalledWith("biz-A", good, undefined)
  })
  it("refuses numbers in the wrong order for the test", async () => {
    const res = await post({ ...good, trained_value: 60 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/go up/)
    expect(saveStandard).not.toHaveBeenCalled()
  })
  it("refuses an age group whose youngest age is above its oldest", async () => {
    expect((await post({ ...good, age_min: 16, age_max: 12 })).status).toBe(400)
    expect(saveStandard).not.toHaveBeenCalled()
  })
  it("refuses a test that has no standards (custom)", async () => {
    expect((await post({ ...good, test_type: "custom" })).status).toBe(400)
  })
  it("409s when the business already has that test and age group", async () => {
    saveStandard.mockResolvedValue("duplicate")
    expect((await post(good)).status).toBe(409)
  })
  it("404s an update of a row that is not in the caller's business", async () => {
    saveStandard.mockResolvedValue(null)
    expect((await post({ ...good, id: ID })).status).toBe(404)
    expect(saveStandard).toHaveBeenCalledWith("biz-A", good, ID)
  })
})

describe("DELETE /api/admin/performance-standards", () => {
  const del = (q: string) =>
    DELETE(new Request(`http://localhost/api/admin/performance-standards${q}`, { method: "DELETE" }), ctx)
  it("deletes only inside the caller's business", async () => {
    expect((await del(`?id=${ID}`)).status).toBe(200)
    expect(deleteStandard).toHaveBeenCalledWith("biz-A", ID)
  })
  it("400s without a valid id", async () => {
    expect((await del("?id=nope")).status).toBe(400)
    expect(deleteStandard).not.toHaveBeenCalled()
  })
})
