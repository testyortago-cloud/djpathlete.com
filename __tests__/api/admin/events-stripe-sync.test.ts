import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getEventByIdMock = vi.fn()
const syncEventToStripeMock = vi.fn()

const updateChainMock = vi.fn(async () => ({
  data: { id: "evt-1", stripe_product_id: "prod_x", stripe_price_id: "price_x" },
  error: null,
}))

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/db/events", () => ({
  getEventById: (...a: unknown[]) => getEventByIdMock(...a),
}))
vi.mock("@/lib/stripe", () => ({
  syncEventToStripe: (...a: unknown[]) => syncEventToStripeMock(...a),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: updateChainMock,
          }),
        }),
      }),
    }),
  }),
}))

const camp = {
  id: "evt-1",
  type: "camp",
  price_cents: 29900,
  stripe_product_id: null,
  stripe_price_id: null,
}

function makeReq() {
  return new Request("http://localhost/api/admin/events/evt-1/stripe-sync", { method: "POST" })
}
const ctx = { params: Promise.resolve({ id: "evt-1" }) }

describe("POST /api/admin/events/[id]/stripe-sync", () => {
  beforeEach(() => {
    authMock.mockReset()
    getEventByIdMock.mockReset()
    syncEventToStripeMock.mockReset()
    updateChainMock.mockReset()
    authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
    updateChainMock.mockResolvedValue({
      data: { id: "evt-1", stripe_product_id: "prod_x", stripe_price_id: "price_x" },
      error: null,
    })
  })

  it("403 when not admin", async () => {
    authMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(403)
  })

  it("400 if event is a clinic", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...camp, type: "clinic" })
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(400)
  })

  it("400 if camp has no price_cents", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...camp, price_cents: null })
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(400)
  })

  it("happy path syncs and persists ids", async () => {
    getEventByIdMock.mockResolvedValueOnce(camp)
    syncEventToStripeMock.mockResolvedValueOnce({ productId: "prod_x", priceId: "price_x" })
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(200)
    expect(updateChainMock).toHaveBeenCalled()
  })

  it("502 when Stripe sync throws", async () => {
    getEventByIdMock.mockResolvedValueOnce(camp)
    syncEventToStripeMock.mockRejectedValueOnce(new Error("stripe down"))
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(502)
  })
})
