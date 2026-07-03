import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const flagMock = vi.fn()
const getUserMock = vi.fn()
const custMock = vi.fn()
const setupMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/packs/flags", () => ({ cardOnFileEnabled: () => flagMock() }))
vi.mock("@/lib/db/users", () => ({ getUserById: (...a: unknown[]) => getUserMock(...a) }))
vi.mock("@/lib/stripe", () => ({
  getOrCreateStripeCustomer: (...a: unknown[]) => custMock(...a),
  createSetupCheckoutSession: (...a: unknown[]) => setupMock(...a),
}))

import { POST } from "@/app/api/admin/clients/[id]/save-card/route"

const CLIENT = "5e7bdb51-594d-42b9-b821-4ee15dcde501"
const ctx = { params: Promise.resolve({ id: CLIENT }) }
const req = () => new Request("http://x/api/admin/clients/x/save-card", { method: "POST" })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  flagMock.mockResolvedValue(true)
  getUserMock.mockResolvedValue({ id: CLIENT, email: "c@example.com" })
  custMock.mockResolvedValue("cus_1")
  setupMock.mockResolvedValue({ id: "cs_setup", url: "https://stripe.test/setup" })
})

describe("POST /api/admin/clients/[id]/save-card", () => {
  it("403 for non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await POST(req(), ctx)).status).toBe(403)
  })

  it("403 when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await POST(req(), ctx)).status).toBe(403)
  })

  it("returns a hosted setup URL for the client's customer", async () => {
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe("https://stripe.test/setup")
    expect(custMock).toHaveBeenCalledWith(CLIENT, "c@example.com")
    expect(setupMock).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_1", userId: CLIENT }))
  })
})
