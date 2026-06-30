import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listPackagesMock = vi.fn()
const listCheckinsMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/client-packages", () => ({ listPackagesForClient: (...a: unknown[]) => listPackagesMock(...a) }))
vi.mock("@/lib/db/session-checkins", () => ({ listCheckinsForPackage: (...a: unknown[]) => listCheckinsMock(...a) }))
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))

import { loadMyPacksView, nearestActiveExpiry } from "@/lib/services/client-packs-view"

const NOW = new Date("2026-06-30T00:00:00Z")
const pack = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  client_user_id: "c1",
  assignment_id: null,
  status: "active",
  credits_total: 10,
  credits_used: 4,
  expires_at: "2026-07-14T00:00:00Z",
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  listCheckinsMock.mockResolvedValue([])
})

describe("nearestActiveExpiry", () => {
  it("returns the earliest active expiry and ignores expired/depleted", () => {
    const r = nearestActiveExpiry(
      [
        pack({ expires_at: "2026-08-01T00:00:00Z" }),
        pack({ expires_at: "2026-07-10T00:00:00Z" }),
        pack({ status: "depleted", expires_at: "2026-07-01T00:00:00Z" }),
      ],
      NOW,
    )
    expect(r).toBe("2026-07-10T00:00:00Z")
  })

  it("returns null when nothing active", () => {
    expect(nearestActiveExpiry([pack({ status: "expired" })], NOW)).toBeNull()
  })
})

describe("loadMyPacksView", () => {
  it("returns null when there is no client session", async () => {
    authMock.mockResolvedValue(null)
    expect(await loadMyPacksView(NOW)).toBeNull()
  })

  it("loads the session user's packs + summary", async () => {
    authMock.mockResolvedValue({ user: { id: "c1", role: "client" } })
    listPackagesMock.mockResolvedValue([pack()])
    const view = await loadMyPacksView(NOW)
    expect(listPackagesMock).toHaveBeenCalledWith("c1")
    expect(view?.summary.activeRemaining).toBe(6)
    expect(view?.nearestExpiry).toBe("2026-07-14T00:00:00Z")
  })

  it("ignores a non-client session", async () => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } })
    expect(await loadMyPacksView(NOW)).toBeNull()
  })
})
