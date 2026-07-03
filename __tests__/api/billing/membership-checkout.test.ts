import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const flagMock = vi.fn()
const getPlanMock = vi.fn()
const getUserMock = vi.fn()
const custMock = vi.fn()
const checkoutMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/packs/flags", () => ({ sessionMembershipsEnabled: () => flagMock() }))
vi.mock("@/lib/db/membership-plans", () => ({ getMembershipPlanById: (...a: unknown[]) => getPlanMock(...a) }))
vi.mock("@/lib/db/users", () => ({ getUserById: (...a: unknown[]) => getUserMock(...a) }))
vi.mock("@/lib/stripe", () => ({
  getOrCreateStripeCustomer: (...a: unknown[]) => custMock(...a),
  createMembershipCheckoutSession: (...a: unknown[]) => checkoutMock(...a),
}))

import { POST } from "@/app/api/admin/memberships/checkout/route"

const USER = "5e7bdb51-594d-42b9-b821-4ee15dcde501"
const PLAN = "22222222-2222-4222-8222-222222222222"
const req = (b: Record<string, unknown>) =>
  new Request("http://x/api/admin/memberships/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  flagMock.mockResolvedValue(true)
  getPlanMock.mockResolvedValue({ id: PLAN, name: "2x/week", price_cents: 12000, billing_interval: "month", stripe_price_id: null, is_active: true })
  getUserMock.mockResolvedValue({ id: USER, email: "c@example.com" })
  custMock.mockResolvedValue("cus_1")
  checkoutMock.mockResolvedValue({ id: "cs_sub", url: "https://stripe.test/sub" })
})

describe("POST /api/admin/memberships/checkout", () => {
  it("403 for non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await POST(req({ userId: USER, planId: PLAN }))).status).toBe(403)
  })

  it("403 when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await POST(req({ userId: USER, planId: PLAN }))).status).toBe(403)
  })

  it("404 for an inactive plan", async () => {
    getPlanMock.mockResolvedValue({ id: PLAN, is_active: false })
    expect((await POST(req({ userId: USER, planId: PLAN }))).status).toBe(404)
  })

  it("returns a subscription checkout URL", async () => {
    const res = await POST(req({ userId: USER, planId: PLAN }))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe("https://stripe.test/sub")
    expect(checkoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_1", userId: USER, plan: expect.objectContaining({ id: PLAN }) }),
    )
  })
})
