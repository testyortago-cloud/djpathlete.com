import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const checkInClientMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/services/session-credits", () => ({ checkInClient: (...a: unknown[]) => checkInClientMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/admin/session-packs/checkin/route"

const CLIENT = "11111111-1111-4111-8111-111111111111"

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/session-packs/checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
})

describe("POST /api/admin/session-packs/checkin", () => {
  it("deducts a credit and returns remaining", async () => {
    checkInClientMock.mockResolvedValue({ ok: true, remaining: 6, packageId: "p1" })
    const res = await POST(req({ clientUserId: CLIENT }))
    expect(res.status).toBe(200)
    expect((await res.json()).remaining).toBe(6)
    expect(checkInClientMock).toHaveBeenCalledWith(expect.objectContaining({ clientUserId: CLIENT, method: "coach_tap" }))
  })

  it("returns 409 when no credits left", async () => {
    checkInClientMock.mockResolvedValue({ ok: false, reason: "no_credits" })
    const res = await POST(req({ clientUserId: CLIENT }))
    expect(res.status).toBe(409)
  })

  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ clientUserId: CLIENT }))
    expect(res.status).toBe(403)
  })
})
