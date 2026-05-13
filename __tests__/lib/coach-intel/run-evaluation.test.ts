import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/training-sessions", () => ({
  listByUser: vi.fn(),
}))
vi.mock("@/lib/db/daily-readiness", () => ({
  listByUser: vi.fn(),
}))
vi.mock("@/lib/db/risk-flags", () => ({
  createIfNew: vi.fn(),
  closeStaleByType: vi.fn(),
}))

import * as tsDal from "@/lib/db/training-sessions"
import * as drDal from "@/lib/db/daily-readiness"
import * as rfDal from "@/lib/db/risk-flags"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

beforeEach(() => vi.clearAllMocks())

describe("runEvaluation", () => {
  it("calls createIfNew for each proposed flag returned by the evaluator", async () => {
    ;(tsDal.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      { date: "2026-05-11", rpe: 9, duration_min: 60, session_load: 540 },
      { date: "2026-05-12", rpe: 9, duration_min: 60, session_load: 540 },
      { date: "2026-05-13", rpe: 9, duration_min: 60, session_load: 540 },
    ])
    ;(drDal.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(rfDal.createIfNew as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "f1" })

    const result = await runEvaluation("u1", "2026-05-13")

    expect(rfDal.createIfNew).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ flag_type: "rpe_creep" }),
    )
    expect(result.created.length).toBeGreaterThan(0)
  })

  it("calls closeStaleByType for rules that did not fire", async () => {
    ;(tsDal.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(drDal.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await runEvaluation("u1", "2026-05-13")

    expect(rfDal.closeStaleByType).toHaveBeenCalledWith("u1", "load_spike")
    expect(rfDal.closeStaleByType).toHaveBeenCalledWith("u1", "rpe_creep")
  })
})
