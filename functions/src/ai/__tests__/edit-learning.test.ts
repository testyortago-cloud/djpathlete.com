import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const filters: Array<[string, string, unknown]> = []
let rows: unknown[] = []

vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => {
    const builder = {
      from: () => builder,
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push(["eq", col, val])
        return builder
      },
      gte: (col: string, val: unknown) => {
        filters.push(["gte", col, val])
        return builder
      },
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    }
    return builder
  },
}))

const { editScoresFrom, getCoachEditScoresFromFn } = await import("../edit-learning.js")

const removed = (id: string, ai_pick = true) => ({ exercise_id: id, action: "removed" as const, ai_pick })
const added = (id: string) => ({ exercise_id: id, action: "added" as const, ai_pick: false })

describe("editScoresFrom", () => {
  it("lowers an AI pick by 15 each time it is taken out, at most 45", () => {
    expect(editScoresFrom([removed("squat"), removed("squat")]).get("squat")).toBe(-30)
    expect(editScoresFrom([1, 2, 3, 4, 5].map(() => removed("squat"))).get("squat")).toBe(-45)
  })

  it("raises an exercise by 10 each time it is put in, at most 30", () => {
    expect(editScoresFrom([added("goblet")]).get("goblet")).toBe(10)
    expect(editScoresFrom([1, 2, 3, 4].map(() => added("goblet"))).get("goblet")).toBe(30)
  })

  it("ignores taking out an exercise the coach had added themselves", () => {
    expect(editScoresFrom([removed("goblet", false)]).has("goblet")).toBe(false)
  })

  it("nets the two when the coach both adds and removes one", () => {
    expect(editScoresFrom([added("lunge"), added("lunge"), removed("lunge")]).get("lunge")).toBe(5)
    expect(
      editScoresFrom([added("row"), removed("row"), removed("row"), added("row"), removed("row")]).get("row"),
    ).toBe(-25)
  })
})

describe("getCoachEditScoresFromFn", () => {
  it("reads only this coach's changes from the last 180 days", async () => {
    rows = [removed("squat")]
    const scores = await getCoachEditScoresFromFn("coach-1", new Date("2026-10-31T00:00:00Z"))
    expect(scores.get("squat")).toBe(-15)
    expect(filters).toEqual([
      ["eq", "coach_id", "coach-1"],
      ["gte", "created_at", "2026-05-04T00:00:00.000Z"],
    ])
  })
})

describe("generator wiring", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  it.each(["../orchestrator.ts", "../week-orchestrator.ts"])(
    "%s reads the lessons behind the switch and passes them to the filter",
    (file) => {
      const src = readFileSync(path.join(dir, file), "utf8")
      expect(src).toContain('getSetting<boolean>("ai_learn_from_edits_enabled", true)')
      expect(src).toMatch(/learnFromEdits\s*\?\s*getCoachEditScoresFromFn\(requestedBy\)/)
      expect(src).toMatch(/favoriteIds,\s*editScores,/)
    },
  )
})
