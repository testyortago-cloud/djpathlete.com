// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

let program: Record<string, unknown> | null = null
let count = 1
const inserts: unknown[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: program, error: null }),
        insert: async (row: unknown) => {
          inserts.push({ table, row })
          return { error: null }
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ count, error: null }),
      }
      return builder
    },
  }),
}))

import { logExerciseEdit, summarizeEdits } from "@/lib/db/program-exercise-edits"

const input = {
  businessId: "biz-1",
  coachId: "coach-1",
  programId: "prog-1",
  exerciseId: "ex-1",
  action: "added" as const,
  aiPick: false,
  weekNumber: 2,
  dayOfWeek: 3,
}

beforeEach(() => {
  program = { is_ai_generated: true, ai_generation_params: { request: { client_id: "client-1" } } }
  count = 1
  inserts.length = 0
})

describe("logExerciseEdit", () => {
  it("writes a row for an AI program, with the client it was made for", async () => {
    expect(await logExerciseEdit(input)).toBe(true)
    expect(inserts).toEqual([
      {
        table: "program_exercise_edits",
        row: {
          business_id: "biz-1",
          coach_id: "coach-1",
          program_id: "prog-1",
          client_id: "client-1",
          exercise_id: "ex-1",
          action: "added",
          ai_pick: false,
          week_number: 2,
          day_of_week: 3,
        },
      },
    ])
  })

  it("skips a hand-built program", async () => {
    program = { is_ai_generated: false, ai_generation_params: null }
    expect(await logExerciseEdit(input)).toBe(false)
    expect(inserts).toEqual([])
  })

  it("skips an added exercise that is already elsewhere in the program (a duplicate or copy)", async () => {
    count = 2
    expect(await logExerciseEdit(input)).toBe(false)
    expect(inserts).toEqual([])
  })

  it("still logs a removal of an exercise that appears elsewhere in the program", async () => {
    count = 3
    expect(await logExerciseEdit({ ...input, action: "removed", aiPick: true })).toBe(true)
    expect(inserts).toHaveLength(1)
  })
})

describe("summarizeEdits", () => {
  const row = (exercise_id: string, action: "removed" | "added", ai_pick: boolean, created_at: string) => ({
    exercise_id,
    action,
    ai_pick,
    created_at,
    week_number: 1,
    day_of_week: 1,
    exercises: { name: exercise_id.toUpperCase() },
    programs: { name: "Block A" },
  })

  it("counts only AI picks as taken out, and ranks the most frequent first", () => {
    const s = summarizeEdits([
      row("squat", "removed", true, "2026-10-03"),
      row("squat", "removed", true, "2026-10-02"),
      row("lunge", "removed", true, "2026-10-01"),
      row("goblet", "removed", false, "2026-10-04"),
      row("goblet", "added", false, "2026-10-05"),
    ])
    expect(s.removed).toBe(3)
    expect(s.added).toBe(1)
    expect(s.topRemoved.map((c) => [c.name, c.count])).toEqual([
      ["SQUAT", 2],
      ["LUNGE", 1],
    ])
    expect(s.topAdded.map((c) => c.name)).toEqual(["GOBLET"])
    expect(s.recent.map((r) => `${r.action} ${r.exercise}`)).toEqual([
      "added GOBLET",
      "removed SQUAT",
      "removed SQUAT",
      "removed LUNGE",
    ])
  })
})
