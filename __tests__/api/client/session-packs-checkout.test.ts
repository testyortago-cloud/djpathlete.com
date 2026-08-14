import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getProductMock = vi.fn()
const createPkgMock = vi.fn()
const checkoutMock = vi.fn()
const flagMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/session-pack-products", () => ({ getProductById: (...a: unknown[]) => getProductMock(...a) }))
vi.mock("@/lib/db/client-packages", () => ({ createClientPackage: (...a: unknown[]) => createPkgMock(...a) }))
vi.mock("@/lib/stripe", () => ({ createPackCheckoutSession: (...a: unknown[]) => checkoutMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({ clientSelfPurchaseEnabled: () => flagMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/client/session-packs/checkout/route"

const PRODUCT = "22222222-2222-4222-8222-222222222222"
const req = (b: Record<string, unknown>) =>
  new Request("http://localhost/api/client/session-packs/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  })

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
  authMock.mockResolvedValue({ user: { id: "c1", role: "client" } })
  getProductMock.mockResolvedValue({
    id: PRODUCT,
    name: "10x",
    session_type: "1-on-1",
    credits: 10,
    price_cents: 50000,
    validity_days: 90,
    stripe_price_id: null,
    is_active: true,
  })
  createPkgMock.mockImplementation(async (p) => ({ id: "pkg-1", ...p }))
  checkoutMock.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" })
})

describe("POST /api/client/session-packs/checkout", () => {
  it("403 when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await POST(req({ productId: PRODUCT }))).status).toBe(403)
  })

  it("403 for non-clients", async () => {
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
    expect((await POST(req({ productId: PRODUCT }))).status).toBe(403)
  })

  it("404 for an inactive product", async () => {
    getProductMock.mockResolvedValue({ id: PRODUCT, is_active: false })
    expect((await POST(req({ productId: PRODUCT }))).status).toBe(404)
  })

  it("creates a pending UNLINKED stripe pack for the session user and returns the url", async () => {
    const res = await POST(req({ productId: PRODUCT }))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe("https://stripe.test/cs_1")
    expect(createPkgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_user_id: "c1",
        assignment_id: null,
        payment_method: "stripe",
        payment_status: "pending",
        stripe_session_id: "cs_1",
      }),
    )
  })

  // I2 regression guard: nothing else in the suite asserts on autoRenew, so
  // deleting the forwarding from the route would stay green without these —
  // exactly the silent-arming failure this wiring exists to prevent.
  it("forwards autoRenew to createPackCheckoutSession when consented, and records it on the pending pack", async () => {
    await POST(req({ productId: PRODUCT, autoRenew: true }))
    expect(checkoutMock).toHaveBeenCalledWith(expect.objectContaining({ autoRenew: true }))
    expect(createPkgMock).toHaveBeenCalledWith(expect.objectContaining({ auto_renew: true }))
  })

  it("defaults autoRenew to false when the checkbox is omitted", async () => {
    await POST(req({ productId: PRODUCT }))
    expect(checkoutMock).toHaveBeenCalledWith(expect.objectContaining({ autoRenew: false }))
    expect(createPkgMock).toHaveBeenCalledWith(expect.objectContaining({ auto_renew: false }))
  })
})
