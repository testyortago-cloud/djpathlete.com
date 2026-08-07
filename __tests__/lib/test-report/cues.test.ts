import { describe, it, expect } from "vitest"
import { CUES, cueFor } from "@/lib/test-report/cues"
import { CATEGORY_ORDER, type Band, type FocalPoint } from "@/lib/test-report/scoring"

const BANDS: Band[] = ["strength", "developing", "priority"]

function fp(over: Partial<FocalPoint> = {}): FocalPoint {
  return {
    category: "Speed",
    score: 30,
    band: "priority",
    culprit: {
      key: "sprint_10m",
      testType: "sprint_10m",
      label: "10m Sprint",
      latest: 2.1,
      unit: "s",
      latestDate: "2026-06-01",
      isPr: false,
      score: 30,
      deltaPct: null,
      previous: null,
      targets: null,
      points: [2.1],
    },
    ...over,
  }
}

describe("CUES", () => {
  it("covers every category and band", () => {
    for (const c of CATEGORY_ORDER) {
      for (const b of BANDS) {
        expect(CUES[c][b], `${c}/${b}`).toBeTruthy()
      }
    }
  })

  it("is one sentence per cue — the report has two focal points and no room for paragraphs", () => {
    for (const c of CATEGORY_ORDER) {
      for (const b of BANDS) {
        const cue = CUES[c][b]
        // Count sentence-ending punctuation followed by a space and a capital.
        const breaks = cue.match(/[.!?]\s+[A-Z]/g) ?? []
        expect(breaks.length, `${c}/${b} runs to ${breaks.length + 1} sentences: ${cue}`).toBe(0)
        expect(cue.length, `${c}/${b} is ${cue.length} chars`).toBeLessThanOrEqual(150)
      }
    }
  })

  it("never uses percentile language", () => {
    for (const c of CATEGORY_ORDER) {
      for (const b of BANDS) {
        expect(CUES[c][b].toLowerCase()).not.toContain("percentile")
      }
    }
  })
})

describe("cueFor", () => {
  it("selects on the focal point's category and band", () => {
    expect(cueFor(fp({ category: "Mobility", band: "priority" }))).toBe(CUES.Mobility.priority)
    expect(cueFor(fp({ category: "Strength", band: "developing" }))).toBe(CUES.Strength.developing)
  })
})
