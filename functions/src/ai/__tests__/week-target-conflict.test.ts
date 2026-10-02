import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { targetConflict } from "../week-orchestrator.js"

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 2026-10-02: the owner ran "Fill Week 8" a second time while the first was
 * still going. "Week 8 must be empty" was checked only when a run STARTED, and
 * a run now takes 7+ minutes (instruction check + rebuild), so both runs passed
 * the check and both would save into Week 8 — a doubled week.
 */
describe("targetConflict", () => {
  const rows = [
    { week_number: 7, day_of_week: 1 },
    { week_number: 8, day_of_week: 2 },
    { week_number: 8, day_of_week: 2 },
  ]

  it("refuses a week that already has exercises, and says how many", () => {
    const msg = targetConflict(rows, 8, null)
    expect(msg).toContain("Week 8 already has 2 exercises")
  })

  it("refuses a day that already has exercises", () => {
    expect(targetConflict(rows, 8, 2)).toContain("Tuesday in Week 8 already has 2 exercises")
  })

  it("allows an empty week and an empty day (presence control)", () => {
    expect(targetConflict(rows, 9, null)).toBeNull()
    expect(targetConflict(rows, 8, 3)).toBeNull()
  })

  it("at save time, says another generation got there first and nothing was saved", () => {
    const msg = targetConflict(rows, 8, null, { atSave: true })
    expect(msg).toContain("while this generation was running")
    expect(msg).toContain("Nothing was saved")
  })
})

describe("the save re-checks the target before writing", () => {
  const src = readFileSync(join(HERE, "..", "week-orchestrator.ts"), "utf8")

  it("reads the program's rows again and checks them before bulkAddExercisesToProgram", () => {
    const save = src.slice(src.indexOf("const save = async"))
    const recheck = save.indexOf("targetConflict(")
    const write = save.indexOf("await bulkAddExercisesToProgram(")
    expect(recheck).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(-1)
    expect(recheck).toBeLessThan(write)
    expect(save.slice(0, write)).toContain("await getProgramExercises(request.program_id)")
  })
})
