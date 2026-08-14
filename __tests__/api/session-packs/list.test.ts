import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessAdminPathMock = vi.fn()
const loadClientPacksViewMock = vi.fn()
const listRenewalAttemptsForUserMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessAdminPathMock(...a),
}))
vi.mock("@/lib/services/client-packs-view", () => ({
  loadClientPacksView: (...a: unknown[]) => loadClientPacksViewMock(...a),
}))
vi.mock("@/lib/db/pack-renewal-attempts", () => ({
  listRenewalAttemptsForUser: (...a: unknown[]) => listRenewalAttemptsForUserMock(...a),
}))

function req(clientUserId = "client-1") {
  return new Request(`http://localhost/api/admin/session-packs?clientUserId=${clientUserId}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  canAccessAdminPathMock.mockResolvedValue(true)
  loadClientPacksViewMock.mockResolvedValue([{ id: "pack-1" }])
  listRenewalAttemptsForUserMock.mockResolvedValue([{ id: "attempt-1" }])
})

describe("GET /api/admin/session-packs", () => {
  it("returns packages and attempts on the happy path", async () => {
    const { GET } = await import("@/app/api/admin/session-packs/route")
    const res = await GET(req())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.packages).toEqual([{ id: "pack-1" }])
    expect(data.attempts).toEqual([{ id: "attempt-1" }])
  })

  it("degrades to an empty attempts list when the attempts query fails, without losing the packages", async () => {
    listRenewalAttemptsForUserMock.mockRejectedValue(new Error("pack_renewal_attempts unavailable"))
    const { GET } = await import("@/app/api/admin/session-packs/route")
    const res = await GET(req())
    // The whole point: a broken attempts query must not turn into a 500 that
    // also loses the pack list, which is what this route exists for.
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.packages).toEqual([{ id: "pack-1" }])
    expect(data.attempts).toEqual([])
  })

  it("still fails the whole request when the packages query itself fails", async () => {
    loadClientPacksViewMock.mockRejectedValue(new Error("db down"))
    const { GET } = await import("@/app/api/admin/session-packs/route")
    const res = await GET(req())
    // Confirms the degrade-on-failure behavior is scoped to the attempts
    // query specifically, not a blanket catch that would mask a real
    // packages failure as an empty-but-200 response.
    expect(res.status).toBe(500)
  })

  it("requires clientUserId before querying either source", async () => {
    const { GET } = await import("@/app/api/admin/session-packs/route")
    const res = await GET(new Request("http://localhost/api/admin/session-packs"))
    expect(res.status).toBe(400)
    expect(loadClientPacksViewMock).not.toHaveBeenCalled()
    expect(listRenewalAttemptsForUserMock).not.toHaveBeenCalled()
  })
})
