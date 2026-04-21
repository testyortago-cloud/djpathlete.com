import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listRecentVoiceDriftFlagsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/voice-drift-flags", () => ({
  listRecentVoiceDriftFlags: (opts: unknown) => listRecentVoiceDriftFlagsMock(opts),
}))

import { GET } from "@/app/api/admin/ai/voice-drift/route"

describe("GET /api/admin/ai/voice-drift", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 403 when no session", async () => {
    authMock.mockResolvedValueOnce(null)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it("returns 403 for non-admin sessions", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u", role: "client" } })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it("returns flags and the newest scanned_at on happy path", async () => {
    const rows = [
      {
        id: "f1",
        entity_type: "social_post",
        entity_id: "p1",
        drift_score: 75,
        severity: "high",
        issues: [{ issue: "x", suggestion: "y" }],
        content_preview: "preview",
        scanned_at: "2026-04-21T04:00:00Z",
        created_at: "2026-04-21T04:00:00Z",
      },
      {
        id: "f2",
        entity_type: "blog_post",
        entity_id: "b1",
        drift_score: 55,
        severity: "medium",
        issues: [],
        content_preview: "preview2",
        scanned_at: "2026-04-21T03:55:00Z",
        created_at: "2026-04-21T03:55:00Z",
      },
    ]
    listRecentVoiceDriftFlagsMock.mockResolvedValue(rows)

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.flags).toHaveLength(2)
    expect(body.lastScanAt).toBe("2026-04-21T04:00:00Z")
  })

  it("filters to medium + high severity in the DAL call", async () => {
    listRecentVoiceDriftFlagsMock.mockResolvedValue([])
    await GET()
    const callArg = listRecentVoiceDriftFlagsMock.mock.calls[0][0] as {
      severity?: string[]
      limit?: number
      since?: Date
    }
    expect(callArg.severity).toEqual(["medium", "high"])
    expect(callArg.limit).toBe(50)
    expect(callArg.since).toBeInstanceOf(Date)
  })

  it("returns lastScanAt null when there are no flags", async () => {
    listRecentVoiceDriftFlagsMock.mockResolvedValue([])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.flags).toEqual([])
    expect(body.lastScanAt).toBeNull()
  })

  it("returns 500 when the DAL throws", async () => {
    listRecentVoiceDriftFlagsMock.mockRejectedValue(new Error("db down"))
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
