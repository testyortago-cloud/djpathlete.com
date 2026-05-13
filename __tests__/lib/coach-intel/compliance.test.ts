import { describe, it, expect } from "vitest"
import { compliance } from "@/lib/coach-intel/compliance"

describe("compliance", () => {
  it("returns 75% when 3 of 4 scheduled assignments have a completed session", () => {
    const scheduled = [
      { id: "a1", scheduled_date: "2026-05-04" },
      { id: "a2", scheduled_date: "2026-05-05" },
      { id: "a3", scheduled_date: "2026-05-06" },
      { id: "a4", scheduled_date: "2026-05-07" },
    ]
    const completed = [
      { program_assignment_id: "a1" },
      { program_assignment_id: "a2" },
      { program_assignment_id: "a3" },
    ]
    const r = compliance(scheduled, completed, "2026-05-04", "2026-05-07")
    expect(r.scheduledCount).toBe(4)
    expect(r.completedCount).toBe(3)
    expect(r.pct).toBe(75)
  })

  it("returns 100% pct when no sessions are scheduled (avoids div/0)", () => {
    const r = compliance([], [], "2026-05-04", "2026-05-07")
    expect(r.pct).toBe(100)
  })
})
