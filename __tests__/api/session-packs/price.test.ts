import { describe, it, expect, vi, beforeEach } from "vitest"
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), get: vi.fn(), change: vi.fn(), audit: vi.fn() }))
const revalidate = vi.hoisted(() => vi.fn())
vi.mock("next/cache", () => ({ revalidatePath: revalidate }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: mocks.access }))
vi.mock("@/lib/db/client-packages", () => ({ getClientPackageByIdMaybe: mocks.get }))
vi.mock("@/lib/services/pack-payment-link", () => ({ changePackPrice: mocks.change }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: mocks.audit }))
import { PATCH } from "@/app/api/admin/session-packs/[id]/price/route"
const ctx = { params: Promise.resolve({ id: "pack-1" }) }
const request = (body: unknown) =>
  new Request("http://localhost/api/admin/session-packs/pack-1/price", { method: "PATCH", body: JSON.stringify(body) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "coach" } })
  mocks.access.mockResolvedValue(true)
  mocks.get.mockResolvedValue({ id: "pack-1", price_cents: 150000, client_user_id: "client", session_type: "training" })
  mocks.change.mockResolvedValue({ ok: true, url: "https://stripe.test/new" })
})
describe("PATCH pack price", () => {
  it("requires an authorized admin", async () => {
    mocks.access.mockResolvedValue(false)
    expect((await PATCH(request({ priceCents: 75000 }), ctx)).status).toBe(403)
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it.each([0, -5, 1.5, "75000", 100000000])("rejects invalid price %s", async (priceCents) => {
    expect((await PATCH(request({ priceCents }), ctx)).status).toBe(400)
    expect(mocks.change).not.toHaveBeenCalled()
  })
  it("returns 404 for an absent pack", async () => {
    mocks.get.mockResolvedValue(null)
    expect((await PATCH(request({ priceCents: 75000 }), ctx)).status).toBe(404)
  })
  it("returns the replacement and records both prices", async () => {
    const response = await PATCH(request({ priceCents: 75000 }), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ priceCents: 75000, url: "https://stripe.test/new" })
    expect(revalidate).toHaveBeenCalledWith("/admin/clients/client")
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pack.price_changed",
        metadata: expect.objectContaining({ previous_price_cents: 150000, price_cents: 75000 }),
      }),
    )
  })
  it("propagates a refusal without recording success", async () => {
    mocks.change.mockResolvedValue({ ok: false, status: 409, error: "Already paid" })
    const response = await PATCH(request({ priceCents: 75000 }), ctx)
    expect(response.status).toBe(409)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it("refreshes and audits a saved price even when replacement-link creation fails", async () => {
    mocks.change.mockResolvedValue({ ok: false, status: 502, error: "Link could not be created", priceSaved: true })
    const response = await PATCH(request({ priceCents: 75000 }), ctx)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ priceSaved: true })
    expect(revalidate).toHaveBeenCalledWith("/admin/clients/client")
    expect(mocks.audit).toHaveBeenCalled()
  })
})
