import { describe, it, expect } from "vitest"
import { evaluateRules } from "@/lib/coach-intel/evaluate-rules"

const asOf = "2026-05-13"

function dlSession(date: string, rpe: number, durationMin = 60) {
  return { date, rpe, duration_min: durationMin, session_load: rpe * durationMin }
}

describe("evaluateRules", () => {
  it("fires load_spike when ACWR > 1.5", () => {
    const sessions = [
      ...Array.from({ length: 21 }, (_, i) =>
        dlSession(`2026-04-${String(15 + i).padStart(2, "0")}`, 4),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        dlSession(`2026-05-${String(7 + i).padStart(2, "0")}`, 9),
      ),
    ]
    const flags = evaluateRules({ sessions, readiness: [], asOf })
    expect(flags.find((f) => f.flag_type === "load_spike")).toBeDefined()
  })

  it("does NOT fire load_spike when ACWR within sweet spot", () => {
    const sessions = Array.from({ length: 28 }, (_, i) =>
      dlSession(`2026-04-${String(15 + i).padStart(2, "0")}`, 5),
    )
    const flags = evaluateRules({ sessions, readiness: [], asOf })
    expect(flags.find((f) => f.flag_type === "load_spike")).toBeUndefined()
  })

  it("fires fatigue when readiness < 40 for 3 consecutive days", () => {
    const readiness = [
      { date: "2026-05-11", readiness_score: 30 },
      { date: "2026-05-12", readiness_score: 35 },
      { date: "2026-05-13", readiness_score: 38 },
    ]
    const flags = evaluateRules({ sessions: [], readiness, asOf })
    expect(flags.find((f) => f.flag_type === "fatigue")).toBeDefined()
  })

  it("does NOT fire fatigue when only 2 consecutive low days", () => {
    const readiness = [
      { date: "2026-05-12", readiness_score: 30 },
      { date: "2026-05-13", readiness_score: 35 },
    ]
    const flags = evaluateRules({ sessions: [], readiness, asOf })
    expect(flags.find((f) => f.flag_type === "fatigue")).toBeUndefined()
  })

  it("fires overtraining when weekly load Δ > 30%", () => {
    const sessions = [
      ...Array.from({ length: 7 }, (_, i) =>
        dlSession(`2026-04-${String(27 + i).padStart(2, "0")}`, 5, 40),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        dlSession(`2026-05-${String(4 + i).padStart(2, "0")}`, 7, 50),
      ),
    ]
    const flags = evaluateRules({ sessions, readiness: [], asOf: "2026-05-10" })
    expect(flags.find((f) => f.flag_type === "overtraining")).toBeDefined()
  })

  it("fires rpe_creep when last 3 sessions all have RPE > 8", () => {
    const sessions = [
      dlSession("2026-05-11", 9),
      dlSession("2026-05-12", 9),
      dlSession("2026-05-13", 10),
    ]
    const flags = evaluateRules({ sessions, readiness: [], asOf })
    expect(flags.find((f) => f.flag_type === "rpe_creep")).toBeDefined()
  })

  it("returns no flags for empty inputs (cold start)", () => {
    const flags = evaluateRules({ sessions: [], readiness: [], asOf })
    expect(flags).toEqual([])
  })
})
