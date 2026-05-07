import { describe, it, expect, vi, beforeEach } from "vitest"

const listFormReviewsByStatusMock = vi.fn()
const listClientsWithoutLogSinceMock = vi.fn()
const listRecentVoiceDriftFlagsMock = vi.fn()
const getAllProgressMock = vi.fn()

vi.mock("@/lib/db/form-reviews", () => ({
  listFormReviewsByStatus: (...a: unknown[]) => listFormReviewsByStatusMock(...a),
}))
vi.mock("@/lib/db/progress", () => ({
  listClientsWithoutLogSince: (...a: unknown[]) => listClientsWithoutLogSinceMock(...a),
  getAllProgress: (...a: unknown[]) => getAllProgressMock(...a),
}))
vi.mock("@/lib/db/voice-drift-flags", () => ({
  listRecentVoiceDriftFlags: (...a: unknown[]) => listRecentVoiceDriftFlagsMock(...a),
}))

import { buildDailyCoaching } from "@/lib/analytics/sections/coaching-daily"

const referenceDate = new Date("2026-05-07T07:00:00-05:00")

describe("buildDailyCoaching", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listFormReviewsByStatusMock.mockResolvedValue([])
    listClientsWithoutLogSinceMock.mockResolvedValue([])
    listRecentVoiceDriftFlagsMock.mockResolvedValue([])
    getAllProgressMock.mockResolvedValue([])
  })

  it("returns null when nothing notable", async () => {
    const result = await buildDailyCoaching({ referenceDate })
    expect(result).toBeNull()
  })

  it("surfaces pending form reviews with the oldest age", async () => {
    const olderIso = new Date(referenceDate.getTime() - 50 * 3600 * 1000).toISOString()
    const newerIso = new Date(referenceDate.getTime() - 4 * 3600 * 1000).toISOString()
    listFormReviewsByStatusMock.mockResolvedValue([
      { id: "fr-1", created_at: newerIso },
      { id: "fr-2", created_at: olderIso },
    ])
    const result = await buildDailyCoaching({ referenceDate })
    expect(result).not.toBeNull()
    expect(result!.formReviewsAwaiting).toEqual({ count: 2, oldestAgeHours: 50 })
  })

  it("surfaces at-risk clients (3+ days no log)", async () => {
    listClientsWithoutLogSinceMock.mockResolvedValue([
      { id: "u-1", first_name: "Alex", last_name: "P.", days_since_last_log: 5 },
    ])
    const result = await buildDailyCoaching({ referenceDate })
    expect(result!.atRiskClients).toEqual([{ name: "Alex P.", daysSinceLastLog: 5 }])
  })

  it("counts low-RPE log flags from yesterday", async () => {
    const yesterday = new Date(referenceDate.getTime() - 12 * 3600 * 1000).toISOString()
    getAllProgressMock.mockResolvedValue([
      { id: "p1", completed_at: yesterday, rpe: 2, weight_kg: 60, sets: 3 },
      { id: "p2", completed_at: yesterday, rpe: 7, weight_kg: 60, sets: 3 },
      { id: "p3", completed_at: yesterday, rpe: null, weight_kg: 60, sets: 3 },
    ])
    const result = await buildDailyCoaching({ referenceDate })
    expect(result!.lowRpeLogFlags).toBe(2)
  })

  it("counts voice drift flags created since yesterday", async () => {
    listRecentVoiceDriftFlagsMock.mockResolvedValue([{ id: "v1" }, { id: "v2" }])
    const result = await buildDailyCoaching({ referenceDate })
    expect(result!.voiceDriftFlags).toBe(2)
  })
})
