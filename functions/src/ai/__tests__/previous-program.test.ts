import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = []
let assignment: Record<string, unknown> | null = null
let rows: unknown[] = []

vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]> }
      calls.push(call)
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          call.filters.push([col, val])
          return builder
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: assignment, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      }
      return builder
    },
  }),
}))

const { getPreviousProgramFromFn, formatPreviousProgram } = await import("../previous-program.js")

const row = (name: string, week: number, sets: number, reps: string, pattern = "push") => ({
  week_number: week,
  sets,
  reps,
  exercises: { name, movement_pattern: pattern },
})

beforeEach(() => {
  calls.length = 0
  assignment = null
  rows = []
})

describe("getPreviousProgramFromFn", () => {
  it("reads the client's latest assignment and that program's exercises", async () => {
    assignment = {
      program_id: "prog-1",
      start_date: "2026-08-01",
      status: "completed",
      programs: {
        name: "Shoulder Rebuild",
        description: null,
        duration_weeks: 8,
        ai_generation_params: {
          request: { goals: ["injury_prevention"], additional_instructions: "Big shoulder rehab focus" },
        },
      },
    }
    rows = [row("Face Pull", 1, 3, "15")]
    const p = await getPreviousProgramFromFn("client-1")
    expect(calls[0]).toEqual({ table: "program_assignments", filters: [["user_id", "client-1"]] })
    expect(calls[1]).toEqual({ table: "program_exercises", filters: [["program_id", "prog-1"]] })
    expect(p).toMatchObject({
      name: "Shoulder Rebuild",
      goals: ["injury_prevention"],
      instructions: "Big shoulder rehab focus",
      exercises: rows,
    })
  })

  it("is null when the client has no program", async () => {
    expect(await getPreviousProgramFromFn("client-1")).toBeNull()
    expect(calls).toHaveLength(1)
  })
})

describe("formatPreviousProgram", () => {
  const base = {
    name: "Shoulder Rebuild",
    description: null,
    duration_weeks: 8,
    start_date: "2026-08-01",
    status: "completed",
    goals: ["injury_prevention"],
    instructions: "Big shoulder rehab focus",
    exercises: [
      row("Face Pull", 1, 3, "15", "pull"),
      row("Face Pull", 1, 3, "15", "pull"),
      row("Face Pull", 8, 4, "12", "pull"),
      row("Landmine Press", 5, 3, "8"),
      row("Band External Rotation", 2, 2, "20", "rotation"),
    ],
  }

  it("lists each exercise once, most-used first, with its weeks and last prescription", () => {
    const text = formatPreviousProgram(base)
    expect(text).toContain('"Shoulder Rebuild", started 2026-08-01, 8 weeks, status: completed.')
    expect(text).toContain('Coach\'s instructions for it: "Big shoulder rehab focus"')
    const lines = text.split("\n").filter((l) => l.startsWith("- "))
    expect(lines).toEqual([
      "- Face Pull (pull): weeks 1–8, 4×12",
      "- Band External Rotation (rotation): week 2, 2×20",
      "- Landmine Press (push): week 5, 3×8",
    ])
  })

  it("tells the agents to carry the focus forward and not copy the list", () => {
    const text = formatPreviousProgram(base)
    expect(text).toContain("FOLLOWS ON from this block")
    expect(text).toContain("Do NOT copy its exercise list")
  })
})

describe("orchestrator wiring", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../orchestrator.ts"), "utf8")

  it("gives the section to all three agents", () => {
    // The client's self-assessment follows it in each (self-assessment-wiring.test.ts).
    expect(src).toContain("${coachInstructionsSection}${assessmentSection}${previousProgramSection}${selfAssessmentSection}`")
    expect(src).toContain("${coachInstructionsSection}${previousProgramSection}${selfAssessmentSection}${buildPoolPatternSection(")
    expect(src).toContain("${priorContext.prompt_text}${coachInstructionsSection}${previousProgramSection}${selfAssessmentSection}`")
  })

  it("keeps it out of the coach instructions, which are parsed for exercise names", () => {
    expect(src).toMatch(/const combinedInstructions = \[request\.additional_instructions, policyInstructions\]/)
    expect(src).not.toMatch(/combinedInstructions[^\n]*previousProgram/)
  })

  it("skips it when the coach chose to ignore the profile", () => {
    expect(src).toMatch(/request\.client_id && !request\.ignore_profile\s*\?\s*await getPreviousProgramFromFn/)
  })
})
