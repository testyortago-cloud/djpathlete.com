import { describe, it, expect, vi, beforeEach } from "vitest"

const countSessionsInRangeMock = vi.fn()
const countActiveClientsInRangeMock = vi.fn()
const getDeliveredFormReviewStatsMock = vi.fn()
const listClientsWithoutLogSinceMock = vi.fn()
const getProgramCompletionRateMock = vi.fn()

vi.mock("@/lib/db/progress", () => ({
  countSessionsInRange: (...a: unknown[]) => countSessionsInRangeMock(...a),
  countActiveClientsInRange: (...a: unknown[]) => countActiveClientsInRangeMock(...a),
  listClientsWithoutLogSince: (...a: unknown[]) => listClientsWithoutLogSinceMock(...a),
}))
vi.mock("@/lib/db/form-reviews", () => ({
  getDeliveredFormReviewStats: (...a: unknown[]) => getDeliveredFormReviewStatsMock(...a),
}))
vi.mock("@/lib/db/programs", () => ({
  getProgramCompletionRate: (...a: unknown[]) => getProgramCompletionRateMock(...a),
}))

import { buildWeeklyCoaching } from "@/lib/analytics/sections/coaching-weekly"

const range = { from: new Date("2026-04-30T00:00:00Z"), to: new Date("2026-05-07T00:00:00Z") }
const previousRange = { from: new Date("2026-04-23T00:00:00Z"), to: new Date("2026-04-30T00:00:00Z") }

describe("buildWeeklyCoaching", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countSessionsInRangeMock.mockResolvedValue(0)
    countActiveClientsInRangeMock.mockResolvedValue(0)
    getDeliveredFormReviewStatsMock.mockResolvedValue({ count: 0, avgResponseHours: 0 })
    listClientsWithoutLogSinceMock.mockResolvedValue([])
    getProgramCompletionRateMock.mockResolvedValue(0)
  })

  it("returns null when no clients active in either week", async () => {
    expect(await buildWeeklyCoaching({ range, previousRange })).toBeNull()
  })

  it("compares current vs previous week", async () => {
    countActiveClientsInRangeMock
      .mockResolvedValueOnce(12).mockResolvedValueOnce(9)
    countSessionsInRangeMock
      .mockResolvedValueOnce(48).mockResolvedValueOnce(40)
    getProgramCompletionRateMock
      .mockResolvedValueOnce(78).mockResolvedValueOnce(72)
    getDeliveredFormReviewStatsMock
      .mockResolvedValueOnce({ count: 6, avgResponseHours: 18 })
      .mockResolvedValueOnce({ count: 4, avgResponseHours: 24 })
    listClientsWithoutLogSinceMock.mockResolvedValue([{ id: "u1" }, { id: "u2" }])

    const result = await buildWeeklyCoaching({ range, previousRange })
    expect(result).toEqual({
      activeClients: { current: 12, previous: 9 },
      sessionsCompleted: { current: 48, previous: 40 },
      programCompletionRatePct: { current: 78, previous: 72 },
      formReviewsDelivered: { current: 6, previous: 4 },
      avgFormReviewResponseHours: { current: 18, previous: 24 },
      silentClients: 2,
    })
  })
})
