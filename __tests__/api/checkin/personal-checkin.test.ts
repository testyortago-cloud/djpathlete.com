import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const checkInMock = vi.fn()
const flagMock = vi.fn()
const getUserMock = vi.fn()
const listPackagesMock = vi.fn()

vi.mock("@/lib/qr/checkin-token", () => ({ verifyPersonalCheckinToken: (...a: unknown[]) => verifyMock(...a) }))
vi.mock("@/lib/services/session-credits", () => ({ checkInClient: (...a: unknown[]) => checkInMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({ clientPersonalCheckinEnabled: () => flagMock() }))
vi.mock("@/lib/db/users", () => ({ getUserById: (...a: unknown[]) => getUserMock(...a) }))
vi.mock("@/lib/db/client-packages", () => ({ listPackagesForClient: (...a: unknown[]) => listPackagesMock(...a) }))
vi.mock("@/lib/services/client-packs-view", () => ({
  summarizeClientPacks: (packs: { remaining?: number }[]) => ({
    activeRemaining: packs.reduce((s, p) => s + (p.remaining ?? 0), 0),
    hasActiveCredits: true,
    byAssignment: new Map(),
  }),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
const bridgeMock = vi.fn()
vi.mock("@/lib/services/session-schedule", () => ({
  bridgeCheckinToSchedule: (...a: unknown[]) => bridgeMock(...a),
}))

import { GET, POST } from "@/app/api/checkin/personal/route"

const CLIENT = "5e7bdb51-594d-42b9-b821-4ee15dcde501"
const getReq = (token: string) => new Request(`http://localhost/api/checkin/personal?token=${encodeURIComponent(token)}`)
const postReq = (b: Record<string, unknown>) =>
  new Request("http://localhost/api/checkin/personal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  })

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
  verifyMock.mockReturnValue({ valid: true, clientUserId: CLIENT })
  getUserMock.mockResolvedValue({ id: CLIENT, first_name: "Aean" })
  listPackagesMock.mockResolvedValue([{ remaining: 4 }])
})

describe("GET /api/checkin/personal (resolve name + balance)", () => {
  it("403 when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await GET(getReq("t"))).status).toBe(403)
  })

  it("401 on an invalid token", async () => {
    verifyMock.mockReturnValue({ valid: false })
    expect((await GET(getReq("bad"))).status).toBe(401)
  })

  it("returns the client's first name and remaining credits", async () => {
    const res = await GET(getReq("good"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ firstName: "Aean", remaining: 4 })
  })
})

describe("POST /api/checkin/personal (check in)", () => {
  it("403 when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await POST(postReq({ token: "t" }))).status).toBe(403)
  })

  it("401 on an invalid token, without checking anyone in", async () => {
    verifyMock.mockReturnValue({ valid: false })
    expect((await POST(postReq({ token: "bad" }))).status).toBe(401)
    expect(checkInMock).not.toHaveBeenCalled()
  })

  it("checks in the token's client and returns remaining", async () => {
    checkInMock.mockResolvedValue({ ok: true, remaining: 3, packageId: "p1" })
    const res = await POST(postReq({ token: "good" }))
    expect(res.status).toBe(200)
    expect((await res.json()).remaining).toBe(3)
    expect(checkInMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientUserId: CLIENT, method: "qr_self", createdBy: null }),
    )
  })

  it("409 when the client has no credits", async () => {
    checkInMock.mockResolvedValue({ ok: false, reason: "no_credits" })
    expect((await POST(postReq({ token: "good" }))).status).toBe(409)
    expect(bridgeMock).not.toHaveBeenCalled()
  })

  it("bridges the check-in to today's scheduled session", async () => {
    checkInMock.mockResolvedValue({ ok: true, remaining: 3, packageId: "p1", checkin: { id: "chk-1" } })
    await POST(postReq({ token: "good" }))
    expect(bridgeMock).toHaveBeenCalledWith(CLIENT, "chk-1", expect.any(Date))
  })
})
