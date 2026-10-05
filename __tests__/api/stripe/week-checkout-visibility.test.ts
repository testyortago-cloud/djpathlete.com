// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const getAssignmentById = vi.fn()
const getWeekAccess = vi.fn()
const createWeekCheckoutSession = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "u1" } }) }))
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: (...a: unknown[]) => getAssignmentById(...a) }))
vi.mock("@/lib/db/week-access", () => ({ getWeekAccess: (...a: unknown[]) => getWeekAccess(...a) }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn().mockResolvedValue({ name: "Prog" }) }))
vi.mock("@/lib/stripe", () => ({
  createWeekCheckoutSession: (...a: unknown[]) => createWeekCheckoutSession(...a),
}))
vi.mock("@/lib/marketing/cookies", () => ({ parseAttrCookie: () => null }))
vi.mock("@/lib/db/marketing-attribution", () => ({ getAttributionBySession: vi.fn() }))

import { POST } from "@/app/api/stripe/week-checkout/route"

const call = () =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ assignmentId: "00000000-0000-4000-8000-000000000001", weekNumber: 3 }),
    }),
  )

const access = (visibility: string) => ({ id: "wa1", payment_status: "pending", price_cents: 5000, visibility })

beforeEach(() => {
  getAssignmentById
    .mockReset()
    .mockResolvedValue({ user_id: "u1", program_id: "p1", release_base_week: null, release_anchor_at: null })
  getWeekAccess.mockReset()
  createWeekCheckoutSession.mockReset().mockResolvedValue({ url: "https://stripe/x" })
})

describe("week-checkout visibility", () => {
  it("403s a hidden week and creates no Stripe session", async () => {
    getWeekAccess.mockResolvedValue(access("hidden"))
    expect((await call()).status).toBe(403)
    expect(createWeekCheckoutSession).not.toHaveBeenCalled()
  })

  it("403s a week the schedule has not reached", async () => {
    getAssignmentById.mockResolvedValue({
      user_id: "u1",
      program_id: "p1",
      release_base_week: 1,
      release_anchor_at: new Date().toISOString(),
    })
    getWeekAccess.mockResolvedValue(access("auto"))
    expect((await call()).status).toBe(403)
    expect(createWeekCheckoutSession).not.toHaveBeenCalled()
  })

  it("proceeds for a visible week", async () => {
    getWeekAccess.mockResolvedValue(access("auto"))
    const res = await call()
    expect(res.status).toBe(200)
    expect(createWeekCheckoutSession).toHaveBeenCalled()
  })
})
