import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const verifyMock = vi.fn()
const checkInMock = vi.fn()
const flagMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/qr/checkin-token", () => ({ verifyCheckinToken: (...a: unknown[]) => verifyMock(...a) }))
vi.mock("@/lib/services/session-credits", () => ({ checkInClient: (...a: unknown[]) => checkInMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({ clientSelfCheckinEnabled: () => flagMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
const bridgeMock = vi.fn()
vi.mock("@/lib/services/session-schedule", () => ({
  bridgeCheckinToSchedule: (...a: unknown[]) => bridgeMock(...a),
}))

import { POST } from "@/app/api/checkin/self/route"

const req = (b: Record<string, unknown>) =>
  new Request("http://localhost/api/checkin/self", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  })

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
  authMock.mockResolvedValue({ user: { id: "c1", role: "client" } })
  verifyMock.mockReturnValue({ valid: true, coachId: "coach-1" })
})

describe("POST /api/checkin/self", () => {
  it("403 when the feature flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await POST(req({ token: "t" }))).status).toBe(403)
  })

  it("401 when there is no client session", async () => {
    authMock.mockResolvedValue(null)
    expect((await POST(req({ token: "t" }))).status).toBe(401)
  })

  it("403 for a non-client session", async () => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } })
    expect((await POST(req({ token: "t" }))).status).toBe(403)
  })

  it("401 on an invalid token", async () => {
    verifyMock.mockReturnValue({ valid: false })
    expect((await POST(req({ token: "bad" }))).status).toBe(401)
    expect(checkInMock).not.toHaveBeenCalled()
  })

  it("checks in as the SESSION user, ignoring any body id", async () => {
    checkInMock.mockResolvedValue({ ok: true, remaining: 5, packageId: "p1" })
    const res = await POST(req({ token: "t", clientUserId: "EVIL" }))
    expect(res.status).toBe(200)
    expect((await res.json()).remaining).toBe(5)
    expect(checkInMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientUserId: "c1", method: "qr_self", createdBy: "c1" }),
    )
  })

  it("409 when no credits", async () => {
    checkInMock.mockResolvedValue({ ok: false, reason: "no_credits" })
    expect((await POST(req({ token: "t" }))).status).toBe(409)
    expect(bridgeMock).not.toHaveBeenCalled()
  })

  it("bridges the check-in to today's scheduled session", async () => {
    checkInMock.mockResolvedValue({ ok: true, remaining: 5, packageId: "p1", checkin: { id: "chk-1" } })
    await POST(req({ token: "t" }))
    expect(bridgeMock).toHaveBeenCalledWith("c1", "chk-1", expect.any(Date))
  })
})
