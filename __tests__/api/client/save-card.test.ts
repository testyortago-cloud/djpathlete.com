import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const flagMock = vi.fn()
const getUserMock = vi.fn()
const custMock = vi.fn()
const setupMock = vi.fn()
const getCardMock = vi.fn()
const delCardMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/packs/flags", () => ({ cardOnFileEnabled: () => flagMock() }))
vi.mock("@/lib/db/users", () => ({ getUserById: (...a: unknown[]) => getUserMock(...a) }))
vi.mock("@/lib/stripe", () => ({
  getOrCreateStripeCustomer: (...a: unknown[]) => custMock(...a),
  createSetupCheckoutSession: (...a: unknown[]) => setupMock(...a),
}))
vi.mock("@/lib/db/payment-methods", () => ({
  getDefaultPaymentMethod: (...a: unknown[]) => getCardMock(...a),
  deletePaymentMethod: (...a: unknown[]) => delCardMock(...a),
}))

import { POST, DELETE } from "@/app/api/client/save-card/route"

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
  authMock.mockResolvedValue({ user: { id: "c1", role: "client" } })
  getUserMock.mockResolvedValue({ id: "c1", email: "c@example.com" })
  custMock.mockResolvedValue("cus_1")
  setupMock.mockResolvedValue({ id: "cs_setup", url: "https://stripe.test/setup" })
})

describe("POST /api/client/save-card", () => {
  it("403 when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await POST()).status).toBe(403)
  })

  it("403 for a non-client session", async () => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } })
    expect((await POST()).status).toBe(403)
  })

  it("401 when logged out", async () => {
    authMock.mockResolvedValue(null)
    expect((await POST()).status).toBe(401)
  })

  it("returns a hosted setup URL for the SESSION user (never a body id)", async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe("https://stripe.test/setup")
    expect(custMock).toHaveBeenCalledWith("c1", "c@example.com")
    expect(setupMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "c1", returnUrl: "/client/sessions" }))
  })
})

describe("DELETE /api/client/save-card", () => {
  it("removes the client's own default card", async () => {
    getCardMock.mockResolvedValue({ id: "pm-1" })
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(delCardMock).toHaveBeenCalledWith("pm-1")
  })
})
