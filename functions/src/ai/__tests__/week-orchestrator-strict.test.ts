import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildWeekFocusSummary } from "../week-orchestrator.js"

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../week-orchestrator.ts"), "utf8")

describe("week/day orchestrator strict wiring (2026-10-04)", () => {
  it("no longer calls a week-scoped analyzer", () => {
    expect(src).not.toMatch(/WEEK_PROFILE_ANALYZER_PROMPT/)
  })
  it("gives the architect the full profile, the log quality and the muscle list", () => {
    expect(src).toMatch(/buildProfileContext\(profile\)/)
    expect(src).toMatch(/## Log Quality/)
    expect(src).toMatch(/## Muscle names/)
  })
  it("gives the selector the athlete block and one difficulty default", () => {
    expect(src).toMatch(/athlete: buildAthleteContext\(profile\)/)
    expect(src).toMatch(/resolveClientDifficulty\(profile, request\.ignore_profile\)/)
    expect(src).not.toMatch(/experience_level \?\? \(request\.ignore_profile/)
  })
  it("normalises the skeleton, grades fit after dedup, and saves with library names and the sport", () => {
    expect(src).toMatch(/normalizeSkeletonInPlace\(skeleton\.weeks, muscleVocabulary\(fullLibrary\)\)/)
    const dedupAt = src.indexOf("dedupAssignmentsInPlace(assignment.assignments")
    const fitAt = src.indexOf("gradeFits(skeleton.weeks, assignment.assignments")
    expect(fitAt).toBeGreaterThan(dedupAt)
    expect(src).toMatch(/athleteSport: athlete\.sport/)
    expect(src).toMatch(/nameById: new Map\(allExercises\.map/)
    expect(src).toMatch(/slot_fit: slotFit/)
  })
})

describe("buildWeekFocusSummary carries load", () => {
  it("adds total sets and average RPE per week so a deload is visible", () => {
    const rows = [
      { week_number: 1, day_of_week: 1, sets: 4, rpe_target: 8, exercises: { name: "A" } },
      { week_number: 1, day_of_week: 1, sets: 3, rpe_target: 7, exercises: { name: "B" } },
      { week_number: 2, day_of_week: 1, sets: 2, rpe_target: null, exercises: { name: "C" } },
    ]
    const s = buildWeekFocusSummary(rows)
    expect(s[0]).toMatchObject({ week: 1, total_sets: 7, avg_rpe: 7.5 })
    expect(s[1]).toMatchObject({ week: 2, total_sets: 2, avg_rpe: null })
  })
})
