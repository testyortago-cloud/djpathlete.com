import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getProductByIdMock = vi.fn()
const createClientPackageMock = vi.fn()
const createPackCheckoutSessionMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/session-pack-products", () => ({ getProductById: (...a: unknown[]) => getProductByIdMock(...a) }))
vi.mock("@/lib/db/client-packages", () => ({ createClientPackage: (...a: unknown[]) => createClientPackageMock(...a) }))
vi.mock("@/lib/db/session-checkins", () => ({}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/stripe", () => ({ createPackCheckoutSession: (...a: unknown[]) => createPackCheckoutSessionMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/admin/session-packs/checkout/route"

const CLIENT = "11111111-1111-4111-8111-111111111111"
const PRODUCT = "22222222-2222-4222-8222-222222222222"

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/session-packs/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  getProductByIdMock.mockResolvedValue({
    id: PRODUCT,
    name: "10× 1-on-1",
    session_type: "1-on-1",
    credits: 10,
    price_cents: 50000,
    validity_days: 90,
    stripe_price_id: null,
  })
  createClientPackageMock.mockImplementation(async (p) => ({ id: "pkg-1", ...p }))
  createPackCheckoutSessionMock.mockResolvedValue({ id: "cs_test_1", url: "https://stripe.test/cs_test_1" })
})

describe("POST /api/admin/session-packs/checkout", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ clientUserId: CLIENT, productId: PRODUCT, paymentMethod: "stripe" }))
    expect(res.status).toBe(403)
  })

  it("returns a Stripe url and creates a pending pack for stripe payment", async () => {
    const res = await POST(req({ clientUserId: CLIENT, productId: PRODUCT, paymentMethod: "stripe" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toBe("https://stripe.test/cs_test_1")
    expect(createClientPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_user_id: CLIENT,
        credits_total: 10,
        payment_method: "stripe",
        payment_status: "pending",
        status: "active",
        stripe_session_id: "cs_test_1",
      }),
    )
  })

  it("creates a paid pack directly for cash payment", async () => {
    const res = await POST(req({ clientUserId: CLIENT, productId: PRODUCT, paymentMethod: "cash" }))
    expect(res.status).toBe(201)
    expect(createClientPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: "cash", payment_status: "paid", status: "active" }),
    )
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("marks comp packs not_required", async () => {
    const res = await POST(req({ clientUserId: CLIENT, productId: PRODUCT, paymentMethod: "comp" }))
    expect(res.status).toBe(201)
    expect(createClientPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: "comp", payment_status: "not_required" }),
    )
  })

  it("supports an ad-hoc pack with no catalogue product", async () => {
    const res = await POST(
      req({
        clientUserId: CLIENT,
        adhoc: { sessionType: "30-min", credits: 5, priceCents: 20000, validityDays: 60 },
        paymentMethod: "cash",
      }),
    )
    expect(res.status).toBe(201)
    expect(getProductByIdMock).not.toHaveBeenCalled()
    expect(createClientPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({ session_type: "30-min", credits_total: 5 }),
    )
  })
})
