import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../orchestrator.ts"), "utf8")

describe("full-program orchestrator strict wiring (2026-10-04)", () => {
  it("uses the shared profile, athlete and difficulty builders", () => {
    expect(src).toMatch(/buildProfileContext\(profile\)/)
    expect(src).toMatch(/athlete: buildAthleteContext\(profile\)/)
    expect(src).toMatch(/resolveClientDifficulty\(profile, request\.ignore_profile\)/)
  })
  it("repairs techniques after the architect instead of retrying the selector", () => {
    expect(src).toMatch(/repairSkeletonTechniques\(skeleton, analysis\.technique_plan\)/)
  })
  it("normalises slots and saves rows with library names and the sport", () => {
    expect(src).toMatch(/normalizeSkeletonInPlace\(skeleton\.weeks, muscleVocabulary\(allExercises\)\)/)
    expect(src).toMatch(/athleteSport: normalizeSport\(profile\?\.sport\)/)
  })
})
