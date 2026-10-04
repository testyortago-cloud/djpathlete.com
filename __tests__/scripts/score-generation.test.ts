import { describe, it, expect } from "vitest"
import { scoreRows } from "../../scripts/lib/score-generation"

describe("scoreRows", () => {
  it("counts notes naming a sport the athlete does not play", () => {
    const s = scoreRows(
      [{ notes: "Land soft like a tennis player." }, { notes: "Brace before each rep." }, { notes: null }],
      "pickleball",
    )
    expect(s.notes_foreign_sport).toBe(1)
    expect(s.rows).toBe(3)
  })
  it("does not count the athlete's own sport, or a tennis ball", () => {
    const s = scoreRows([{ notes: "Think of your tennis serve." }, { notes: "Squeeze a tennis ball." }], "tennis")
    expect(s.notes_foreign_sport).toBe(0)
    expect(scoreRows([{ notes: "Squeeze a tennis ball." }], null).notes_foreign_sport).toBe(0)
  })
  it("counts notes that state sets, reps, rest, RPE, % or per-side counts", () => {
    const s = scoreRows(
      [
        { notes: "2 sets of 4; rest 90 seconds." },
        { notes: "6 each side." },
        { notes: "Work at 80%." },
        { notes: "Stay at RPE 7." },
        { notes: "Lower over 3 seconds." },
      ],
      null,
    )
    expect(s.notes_prescription).toBe(4)
  })
})
