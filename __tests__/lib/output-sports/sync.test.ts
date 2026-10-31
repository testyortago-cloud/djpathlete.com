import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  getLink: vi.fn(),
  getRefreshToken: vi.fn(),
  markSynced: vi.fn(),
  setConnectionError: vi.fn(),
  storeRefreshToken: vi.fn(),
  upsertImportedTests: vi.fn(),
}))
const api = vi.hoisted(() => ({ listMeasurements: vi.fn(), refreshAccess: vi.fn() }))
const recomputeDownstream = vi.hoisted(() => vi.fn())
const checkGoals = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/output-sports", () => db)
vi.mock("@/lib/output-sports/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/output-sports/api")>()),
  ...api,
}))
vi.mock("@/lib/db/performance-tests", () => ({ recomputeDownstream }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn().mockResolvedValue({ timezone: "UTC" }) }))
vi.mock("@/lib/coach-intel/check-goals", () => ({ checkGoals }))

import { syncClient, outputAccessToken, OutputNotConnectedError } from "@/lib/output-sports/sync"
import { OutputAuthError } from "@/lib/output-sports/api"

const cmj = (completedDate: string, jumpHeight: number, athleteId = "ath1") => ({
  id: completedDate,
  athleteId,
  exerciseId: "BILATERAL_CMJ",
  exerciseCategory: "Jumps",
  completedDate,
  variant: null,
  metrics: [{ field: "jumpHeight", value: jumpHeight }],
})

beforeEach(() => {
  vi.clearAllMocks()
  db.getRefreshToken.mockResolvedValue("refresh-1")
  api.refreshAccess.mockResolvedValue({ accessToken: "access", refreshToken: "refresh-1" })
  db.upsertImportedTests.mockImplementation(async (_c: string, rows: unknown[]) => rows.length)
  api.listMeasurements.mockResolvedValue([])
})

describe("syncClient", () => {
  it("asks Output for the linked athlete only, never for everyone", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: null })
    await syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))
    expect(api.listMeasurements).toHaveBeenCalled()
    for (const [, q] of api.listMeasurements.mock.calls) expect(q.athleteIds).toEqual(["ath1"])
  })

  it("reads a year back on the first sync, in windows Output accepts", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: null })
    await syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))
    const windows = api.listMeasurements.mock.calls.map(([, q]) => q)
    expect(windows[0].start.toISOString()).toBe("2025-11-03T20:00:00.000Z")
    expect(windows.at(-1).end.toISOString()).toBe("2026-11-03T20:00:00.000Z")
    expect(windows.length).toBe(12)
  })

  it("writes complete days only: the window's cut-off first day is left as it was", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: "2026-11-03T12:00:00Z" })
    // The window starts 2026-10-31T12:00Z: that day is only half read.
    api.listMeasurements.mockResolvedValue([cmj("2026-10-31T15:00:00Z", 0.4), cmj("2026-11-02T15:00:00Z", 0.45)])
    const summary = await syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))
    const written = db.upsertImportedTests.mock.calls[0][1] as { output_key: string }[]
    expect(written.map((r) => r.output_key)).toEqual(["cmj:2026-11-02"])
    expect(summary).toMatchObject({ imported: 1, added: 1, updated: 0 })
  })

  it("recomputes PRs from the day before the earliest imported day and stamps the sync time", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: null })
    api.listMeasurements.mockResolvedValueOnce([cmj("2026-01-10T15:00:00Z", 0.4), cmj("2026-03-01T15:00:00Z", 0.5)])
    const now = new Date("2026-11-03T20:00:00Z")
    await syncClient("biz", "client", "coach", now)
    expect(recomputeDownstream).toHaveBeenCalledWith("client", "cmj", "2026-01-09")
    expect(checkGoals).toHaveBeenCalledWith("client", { testType: "cmj", testValue: 50 })
    expect(db.markSynced).toHaveBeenCalledWith("biz", "client", now)
  })

  it("ignores a result Output returns for another athlete", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: null })
    api.listMeasurements.mockResolvedValueOnce([cmj("2026-03-01T15:00:00Z", 0.9, "ath2")])
    const summary = await syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))
    expect(summary.imported).toBe(0)
  })
})

describe("outputAccessToken", () => {
  it("says so when the business has not connected Output", async () => {
    db.getRefreshToken.mockResolvedValue(null)
    await expect(outputAccessToken("biz")).rejects.toBeInstanceOf(OutputNotConnectedError)
  })

  it("saves Output's refusal on the connection so Settings can ask for a reconnect", async () => {
    api.refreshAccess.mockRejectedValue(new OutputAuthError("OAuth error. Invalid refresh token!"))
    await expect(outputAccessToken("biz")).rejects.toBeInstanceOf(OutputAuthError)
    expect(db.setConnectionError).toHaveBeenCalledWith("biz", "OAuth error. Invalid refresh token!")
  })

  it("keeps a rotated refresh token, and leaves an unchanged one alone", async () => {
    await outputAccessToken("biz")
    expect(db.storeRefreshToken).not.toHaveBeenCalled()
    api.refreshAccess.mockResolvedValue({ accessToken: "a", refreshToken: "refresh-2" })
    await outputAccessToken("biz")
    expect(db.storeRefreshToken).toHaveBeenCalledWith("biz", "refresh-2")
  })
})
