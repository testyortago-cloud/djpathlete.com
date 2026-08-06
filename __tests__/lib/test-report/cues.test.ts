import { describe, it, expect } from "vitest"
import { CUES, selectCue } from "@/lib/test-report/cues"
import { CATEGORY_ORDER, type Band, type CategoryScore } from "@/lib/test-report/scoring"

const BANDS: Band[] = ["strength", "developing", "priority"]

describe("CUES", () => {
  it("covers every category and band with non-empty coaching copy", () => {
    for (const category of CATEGORY_ORDER) {
      for (const band of BANDS) {
        const cue = CUES[category]?.[band]
        expect(cue, `${category}/${band}`).toBeTruthy()
        expect(cue.length, `${category}/${band}`).toBeGreaterThan(20)
      }
    }
  })
})

describe("selectCue", () => {
  it("returns the cue for the focus category and band", () => {
    const focus: CategoryScore = { category: "Speed", score: 32, band: "priority", testLabels: ["10m Sprint"] }
    expect(selectCue(focus)).toBe(CUES.Speed.priority)
  })

  it("returns null when there is no scorable category", () => {
    expect(selectCue(null)).toBeNull()
  })
})
