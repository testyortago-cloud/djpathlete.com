import { describe, it, expect, vi, beforeEach } from "vitest"

const qrEnabledMock = vi.fn()
const verifyTokenMock = vi.fn()
const checkInClientMock = vi.fn()

vi.mock("@/lib/packs/flags", () => ({ qrCheckinEnabled: () => qrEnabledMock() }))
vi.mock("@/lib/qr/checkin-token", () => ({ verifyCheckinToken: (...a: unknown[]) => verifyTokenMock(...a) }))
vi.mock("@/lib/services/session-credits", () => ({ checkInClient: (...a: unknown[]) => checkInClientMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/checkin/route"

const CLIENT = "11111111-1111-4111-8111-111111111111"

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  qrEnabledMock.mockResolvedValue(true)
})

describe("POST /api/checkin (self check-in)", () => {
  it("401s on an invalid token", async () => {
    verifyTokenMock.mockReturnValue({ valid: false })
    const res = await POST(req({ clientUserId: CLIENT, token: "bad" }))
    expect(res.status).toBe(401)
    expect(checkInClientMock).not.toHaveBeenCalled()
  })

  it("checks in with a valid token", async () => {
    verifyTokenMock.mockReturnValue({ valid: true, coachId: "coach-1" })
    checkInClientMock.mockResolvedValue({ ok: true, remaining: 4, packageId: "p1" })
    const res = await POST(req({ clientUserId: CLIENT, token: "good.token" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, remaining: 4 })
    expect(checkInClientMock).toHaveBeenCalledWith(expect.objectContaining({ method: "qr_self", clientUserId: CLIENT }))
  })

  it("409s when the client has no credits", async () => {
    verifyTokenMock.mockReturnValue({ valid: true, coachId: "coach-1" })
    checkInClientMock.mockResolvedValue({ ok: false, reason: "no_credits" })
    const res = await POST(req({ clientUserId: CLIENT, token: "good.token" }))
    expect(res.status).toBe(409)
  })

  it("403s when self check-in is disabled", async () => {
    qrEnabledMock.mockResolvedValue(false)
    const res = await POST(req({ clientUserId: CLIENT, token: "good.token" }))
    expect(res.status).toBe(403)
  })
})
