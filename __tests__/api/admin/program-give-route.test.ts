// @vitest-environment node
// __tests__/api/admin/program-give-route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const authMock = vi.fn()
const resolveTenant = vi.fn()
const getProgramById = vi.fn()
const updateProgram = vi.fn()
const deleteProgram = vi.fn()
const getProgramFolder = vi.fn()
const copyProgram = vi.fn()
const assignProgram = vi.fn()
const createStripe = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenant(...a),
  NoAccessibleBusinessError: class extends Error {},
}))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
  deleteProgram: (...a: unknown[]) => deleteProgram(...a),
}))
vi.mock("@/lib/db/program-folders", () => ({ getProgramFolder: (...a: unknown[]) => getProgramFolder(...a) }))
vi.mock("@/lib/services/copy-program", () => ({ copyProgram: (...a: unknown[]) => copyProgram(...a) }))
vi.mock("@/lib/services/assign-program", () => ({ assignProgram: (...a: unknown[]) => assignProgram(...a) }))
vi.mock("@/lib/stripe", () => ({ createStripeProductAndPrice: (...a: unknown[]) => createStripe(...a) }))

import { POST } from "@/app/api/admin/programs/[id]/give/route"

const CLIENT = "44444444-4444-4444-8444-444444444444"
const TEMPLATE = { id: "tpl-1", name: "12-Week Strength", is_template: true, folder_id: "f1", duration_weeks: 12 }
const COPY = {
  id: "copy-1",
  name: "12-Week Strength – Jo",
  payment_type: "free",
  price_cents: null,
  description: null,
  billing_interval: null,
}
const body = (extra: Record<string, unknown> = {}) => ({
  user_id: CLIENT,
  name: "12-Week Strength – Jo",
  start_date: "2026-10-12",
  release_weekly: true,
  weeks_visible_at_start: 2,
  ...extra,
})
const req = (b: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(b) })
const ctx = { params: Promise.resolve({ id: "tpl-1" }) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-05T10:00:00Z"))
  authMock.mockReset().mockResolvedValue({ user: { id: "coach-1" } })
  resolveTenant.mockReset().mockResolvedValue({ businessId: "biz-1" })
  getProgramById.mockReset().mockResolvedValue(TEMPLATE)
  getProgramFolder.mockReset().mockResolvedValue({ id: "f1" })
  copyProgram.mockReset().mockResolvedValue(COPY)
  assignProgram.mockReset().mockResolvedValue({ assignment: { id: "a1" }, skipped: false })
  updateProgram.mockReset()
  deleteProgram.mockReset().mockResolvedValue(undefined)
  createStripe.mockReset().mockResolvedValue({ productId: "prod_new", priceId: "price_new" })
})
afterEach(() => vi.useRealTimers())

describe("POST /api/admin/programs/[id]/give", () => {
  it("copies, then assigns the COPY with the weekly schedule starting on the start date", async () => {
    const res = await POST(req(body()), ctx)
    expect(res.status).toBe(201)
    expect(res.headers.get("x-audit-target-id")).toBe("copy-1")
    expect(copyProgram).toHaveBeenCalledWith("tpl-1", {
      is_template: false,
      folder_id: null,
      is_public: false,
      name: "12-Week Strength – Jo",
    })
    expect(assignProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: "copy-1",
        userId: CLIENT,
        assignedBy: "coach-1",
        releaseBaseWeek: 2,
        releaseAnchorAt: "2026-10-12T00:00:00.000Z",
      }),
    )
  })

  it("with weekly release off, assigns with no schedule", async () => {
    await POST(req(body({ release_weekly: false })), ctx)
    expect(assignProgram).toHaveBeenCalledWith(
      expect.objectContaining({ releaseBaseWeek: null, releaseAnchorAt: null }),
    )
  })

  it("refuses a program that is not in the library, and copies nothing", async () => {
    getProgramById.mockResolvedValue({ ...TEMPLATE, is_template: false, folder_id: null })
    expect((await POST(req(body()), ctx)).status).toBe(400)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("refuses a library program from another business, and copies nothing", async () => {
    getProgramFolder.mockResolvedValue(null)
    expect((await POST(req(body()), ctx)).status).toBe(400)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("refuses more opening weeks than the program has", async () => {
    expect((await POST(req(body({ weeks_visible_at_start: 13 })), ctx)).status).toBe(400)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("creates a fresh Stripe price for a paid copy, keyed to the copy", async () => {
    copyProgram.mockResolvedValue({
      ...COPY,
      payment_type: "subscription",
      price_cents: 4900,
      billing_interval: "week",
    })
    await POST(req(body()), ctx)
    expect(createStripe).toHaveBeenCalledWith(expect.objectContaining({ programId: "copy-1", priceCents: 4900 }))
    expect(updateProgram).toHaveBeenCalledWith("copy-1", {
      stripe_product_id: "prod_new",
      stripe_price_id: "price_new",
    })
  })

  it("deletes the copy when assigning fails — nothing half-done is left behind", async () => {
    assignProgram.mockRejectedValue(new Error("boom"))
    expect((await POST(req(body()), ctx)).status).toBe(500)
    expect(deleteProgram).toHaveBeenCalledWith("copy-1")
  })

  it("deletes the copy when the assignment is skipped", async () => {
    assignProgram.mockResolvedValue({ assignment: null, skipped: true })
    expect((await POST(req(body()), ctx)).status).toBe(500)
    expect(deleteProgram).toHaveBeenCalledWith("copy-1")
  })
})
