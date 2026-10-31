import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  getLink: vi.fn(),
  getRefreshToken: vi.fn(),
  markSynced: vi.fn(),
  setConnectionError: vi.fn(),
  storeRefreshToken: vi.fn(),
  upsertImportedTests: vi.fn(),
  deleteImportedTests: vi.fn(),
  listConnections: vi.fn(),
  listLinks: vi.fn(),
}))
const api = vi.hoisted(() => ({ listMeasurements: vi.fn(), refreshAccess: vi.fn() }))
const recomputeDownstream = vi.hoisted(() => vi.fn())
const checkGoals = vi.hoisted(() => vi.fn())
const settings = vi.hoisted(() => ({
  getBusinessSettings: vi.fn(),
  BusinessSettingsMissingError: class BusinessSettingsMissingError extends Error {},
}))

vi.mock("@/lib/db/output-sports", () => db)
vi.mock("@/lib/output-sports/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/output-sports/api")>()),
  ...api,
}))
vi.mock("@/lib/db/performance-tests", () => ({ recomputeDownstream }))
vi.mock("@/lib/db/businesses", () => settings)
vi.mock("@/lib/coach-intel/check-goals", () => ({ checkGoals }))

import {
  syncClient,
  syncAllLinkedClients,
  outputAccessToken,
  removeImportedTests,
  OutputNotConnectedError,
} from "@/lib/output-sports/sync"
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
  settings.getBusinessSettings.mockResolvedValue({ timezone: "UTC" })
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
    // The window starts 2026-10-30T12:00Z: that day is only half read.
    api.listMeasurements.mockResolvedValue([
      cmj("2026-10-30T15:00:00Z", 0.4),
      cmj("2026-10-31T09:00:00Z", 0.42),
      cmj("2026-11-02T15:00:00Z", 0.45),
    ])
    const summary = await syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))
    const written = db.upsertImportedTests.mock.calls[0][1] as { output_key: string }[]
    // 10-31 is three days before the last sync: a result uploaded late from that day is still read.
    expect(written.map((r) => r.output_key)).toEqual(["cmj:2026-10-31", "cmj:2026-11-02"])
    expect(summary).toMatchObject({ imported: 2, added: 2, updated: 0 })
  })

  it("recomputes PRs from the day before the earliest imported day and stamps the sync time", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: null })
    api.listMeasurements.mockResolvedValueOnce([cmj("2026-01-10T15:00:00Z", 0.4), cmj("2026-03-01T15:00:00Z", 0.5)])
    const now = new Date("2026-11-03T20:00:00Z")
    await syncClient("biz", "client", "coach", now)
    expect(recomputeDownstream).toHaveBeenCalledWith("client", "cmj", "2026-01-09")
    expect(db.markSynced).toHaveBeenCalledWith("biz", "client", now)
  })

  it("marks goals achieved with recent results only, never with a jump from months ago", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: null })
    api.listMeasurements.mockResolvedValue([])
    api.listMeasurements.mockResolvedValueOnce([cmj("2026-03-01T15:00:00Z", 0.6)])
    await syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))
    expect(checkGoals).not.toHaveBeenCalled()

    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: "2026-11-01T12:00:00Z" })
    api.listMeasurements.mockResolvedValueOnce([cmj("2026-10-29T15:00:00Z", 0.6), cmj("2026-11-02T15:00:00Z", 0.47)])
    await syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))
    expect(checkGoals).toHaveBeenCalledWith("client", { testType: "cmj", testValue: 47 })
  })

  it("stops rather than filing results under UTC days when the time zone cannot be read", async () => {
    db.getLink.mockResolvedValue({ output_athlete_id: "ath1", last_synced_at: null })
    settings.getBusinessSettings.mockRejectedValue(new Error("connection reset"))
    await expect(syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))).rejects.toThrow(
      "connection reset",
    )
    expect(db.upsertImportedTests).not.toHaveBeenCalled()

    settings.getBusinessSettings.mockRejectedValue(new settings.BusinessSettingsMissingError("none"))
    await expect(syncClient("biz", "client", "coach", new Date("2026-11-03T20:00:00Z"))).resolves.toBeDefined()
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

  it("clears an earlier refusal once Output accepts the token again", async () => {
    await outputAccessToken("biz")
    expect(db.setConnectionError).toHaveBeenCalledWith("biz", null)
  })

  it("keeps a rotated refresh token, and leaves an unchanged one alone", async () => {
    await outputAccessToken("biz")
    expect(db.storeRefreshToken).not.toHaveBeenCalled()
    api.refreshAccess.mockResolvedValue({ accessToken: "a", refreshToken: "refresh-2" })
    await outputAccessToken("biz")
    expect(db.storeRefreshToken).toHaveBeenCalledWith("biz", "refresh-2")
  })
})

describe("removeImportedTests", () => {
  it("fixes PRs from the start for every test type it removed results from", async () => {
    db.deleteImportedTests.mockResolvedValue(["cmj", "back_squat_1rm"])
    await removeImportedTests("client")
    expect(recomputeDownstream.mock.calls).toEqual([
      ["client", "cmj", "1900-01-01"],
      ["client", "back_squat_1rm", "1900-01-01"],
    ])
  })
})

describe("syncAllLinkedClients (the hourly job)", () => {
  const now = new Date("2026-11-03T20:00:00Z")
  const link = (client_user_id: string, output_athlete_id: string, linked_by: string | null = "coach-1") => ({
    client_user_id,
    output_athlete_id,
    linked_by,
    last_synced_at: "2026-11-03T10:00:00Z",
  })

  beforeEach(() => {
    db.listConnections.mockResolvedValue([{ business_id: "biz-A", connected_by: "owner-A" }])
    db.listLinks.mockResolvedValue([link("c1", "ath1"), link("c2", "ath2")])
    db.getLink.mockImplementation(async (_b: string, c: string) =>
      c === "c1" ? link("c1", "ath1") : link("c2", "ath2"),
    )
    api.listMeasurements.mockImplementation(async (_t: string, q: { athleteIds: string[] }) => [
      cmj("2026-11-03T15:00:00Z", 0.45, q.athleteIds[0]),
    ])
  })

  it("syncs every linked client, each with their own athlete, on one token per business", async () => {
    const summary = await syncAllLinkedClients(now)
    expect(api.refreshAccess).toHaveBeenCalledTimes(1)
    expect(api.listMeasurements.mock.calls.map(([, q]) => q.athleteIds)).toEqual([["ath1"], ["ath2"]])
    expect(db.upsertImportedTests.mock.calls.map(([c]) => c)).toEqual(["c1", "c2"])
    expect(summary).toMatchObject({ businesses: 1, clients: 2, added: 2, failures: [] })
  })

  it("skips a business whose token Output refuses, and still syncs the next business", async () => {
    db.listConnections.mockResolvedValue([
      { business_id: "biz-A", connected_by: "owner-A" },
      { business_id: "biz-B", connected_by: "owner-B" },
    ])
    db.getRefreshToken.mockImplementation(async (b: string) => (b === "biz-A" ? "bad" : "good"))
    api.refreshAccess.mockImplementation(async (t: string) => {
      if (t === "bad") throw new OutputAuthError("OAuth error. Invalid refresh token!")
      return { accessToken: "access", refreshToken: t }
    })
    const summary = await syncAllLinkedClients(now)
    expect(summary.failures).toEqual([{ businessId: "biz-A", message: "OAuth error. Invalid refresh token!" }])
    expect(db.listLinks).toHaveBeenCalledWith("biz-B")
    expect(db.listLinks).not.toHaveBeenCalledWith("biz-A")
    expect(summary.clients).toBe(2)
  })

  it("keeps going when one client fails", async () => {
    api.listMeasurements.mockRejectedValueOnce(new Error("Output Sports answered 500"))
    const summary = await syncAllLinkedClients(now)
    expect(summary.failures).toEqual([
      { businessId: "biz-A", clientUserId: "c1", message: "Output Sports answered 500" },
    ])
    expect(summary.clients).toBe(1)
  })

  it("records results under the coach who linked them, else whoever connected Output", async () => {
    db.listLinks.mockResolvedValue([link("c1", "ath1", null), link("c2", "ath2", "coach-2")])
    await syncAllLinkedClients(now)
    expect(db.upsertImportedTests.mock.calls.map(([c, , actor]) => [c, actor])).toEqual([
      ["c1", "owner-A"],
      ["c2", "coach-2"],
    ])
  })
})
