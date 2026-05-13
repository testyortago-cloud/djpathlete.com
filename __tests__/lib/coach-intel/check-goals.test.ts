import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/athlete-goals", () => ({
  getActive: vi.fn(),
  markAchieved: vi.fn(),
}))

import * as agDal from "@/lib/db/athlete-goals"
import { checkGoals } from "@/lib/coach-intel/check-goals"

beforeEach(() => vi.clearAllMocks())

describe("checkGoals", () => {
  it("marks a test goal achieved when value meets target (higher direction)", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g1",
        metric_kind: "test",
        test_type: "drop_jump",
        target_value: 40,
        direction: "higher",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "g1",
      status: "achieved",
    })
    const r = await checkGoals(
      "u1",
      { testType: "drop_jump", testValue: 42 },
      "2026-05-14",
    )
    expect(r).toHaveLength(1)
    expect(agDal.markAchieved).toHaveBeenCalledWith("g1", "2026-05-14")
  })

  it("does NOT mark when value falls short (higher direction)", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g1",
        metric_kind: "test",
        test_type: "drop_jump",
        target_value: 40,
        direction: "higher",
      },
    ])
    const r = await checkGoals("u1", { testType: "drop_jump", testValue: 38 })
    expect(r).toEqual([])
    expect(agDal.markAchieved).not.toHaveBeenCalled()
  })

  it("respects lower direction for sprint goals", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g1",
        metric_kind: "test",
        test_type: "sprint_10m",
        target_value: 2.0,
        direction: "lower",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g1" })
    const r = await checkGoals("u1", { testType: "sprint_10m", testValue: 1.95 })
    expect(r).toHaveLength(1)
  })

  it("readiness goal achieved when readiness_score meets target", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g2",
        metric_kind: "readiness",
        test_type: null,
        target_value: 80,
        direction: "higher",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g2" })
    const r = await checkGoals("u1", { readinessScore: 85 })
    expect(r).toHaveLength(1)
  })

  it("weekly_load goal achieved when weeklyLoad meets target", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g3",
        metric_kind: "weekly_load",
        test_type: null,
        target_value: 2500,
        direction: "higher",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g3" })
    const r = await checkGoals("u1", { weeklyLoad: 2600 })
    expect(r).toHaveLength(1)
  })
})
