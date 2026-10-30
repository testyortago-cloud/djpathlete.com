import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Both generators run hundreds of lines around a model call, so their staple handling is pinned
// by its wiring here (as orchestrator-strict.test.ts does); the behaviour is in staples.test.ts.
const read = (f: string) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), f), "utf8")
const full = read("../orchestrator.ts")
const week = read("../week-orchestrator.ts")
const count = (src: string, s: string) => src.split(s).length - 1

describe("full-program generator: staples (2026-10-30)", () => {
  it("compares every week against prior weeks WITHOUT their staples", () => {
    expect(full).toContain("const priorWeeksForVariety = withoutStaples(completedWeeksSync, staples)")
    expect(full).toContain("buildPriorWeekContext(priorWeeksForVariety, skeleton.weeks)")
    // Both verifyWeekDiversity calls (the retry feedback and the check), and the end-of-run report.
    expect(count(full, "priorWeeksForVariety,\n            skeleton.weeks,")).toBe(2)
    expect(full).not.toMatch(/verifyWeekDiversity\([\s\S]{0,120}?completedWeeksSync,/)
    expect(full).toMatch(/analyzeFullProgramRepetition\(\s*withoutStaples\(completedWeeksSync, staples\)/)
  })
  it("names the week's due staples to the selector and places any it left out, before validation", () => {
    expect(full).toContain("${poolNote}${dueStapleNote}")
    const placeAt = full.indexOf("placeStaples(")
    expect(placeAt).toBeGreaterThan(full.indexOf("hallucinated exercise IDs"))
    expect(placeAt).toBeLessThan(full.indexOf("weekValidation = validateProgram("))
  })
  it("tells the coach about a staple it could not place", () => {
    expect(full).toContain('category: "staple_not_placed"')
  })
})

describe("week generator: staples come from the program's saved request (continuations, Generate week)", () => {
  it("reads them from ai_generation_params and keeps them off the AVOID list", () => {
    expect(week).toContain("staplesFromParams(program.ai_generation_params)")
    expect(week).toMatch(/historyExemptIds = \[[\s\S]{0,200}?staples\.map\(\(s\) => s\.exercise_id\)/)
  })
  it("never places them on a single-day generation", () => {
    expect(week).toContain("const dueStaples = isSingleDay ? [] : staplesDueInWeek(staples, newWeekNumber)")
  })
  it("names them to the selector and places them before the within-week dedup", () => {
    expect(week).toContain("${namedNote}${stapleNote(dueStaples, candidatesAfterExclusions)}")
    const placeAt = week.indexOf("placeStaples(")
    expect(placeAt).toBeGreaterThan(week.indexOf('throw new Error("Failed to generate exercise assignments")'))
    expect(placeAt).toBeLessThan(week.indexOf("Step 3.5: Last-resort within-week deduplication"))
  })
})
