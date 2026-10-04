import { describe, it, expect } from "vitest"
import * as prompts from "../prompts.js"
import { buildCoachInstructionsSection } from "../shared-helpers.js"

const { PRIORITY_LADDER, PROFILE_ANALYZER_PROMPT, PROGRAM_ARCHITECT_PROMPT, EXERCISE_SELECTOR_PROMPT } = prompts

describe("strict prompts (2026-10-04)", () => {
  it("every planning agent carries the same priority ladder", () => {
    for (const p of [PROFILE_ANALYZER_PROMPT, PROGRAM_ARCHITECT_PROMPT, EXERCISE_SELECTOR_PROMPT]) {
      expect(p).toContain(PRIORITY_LADDER)
    }
  })
  it("the removed phrases are gone", () => {
    const all = [PROFILE_ANALYZER_PROMPT, PROGRAM_ARCHITECT_PROMPT, EXERCISE_SELECTOR_PROMPT].join("\n")
    for (const phrase of [/3% repetition/i, /dumbbell throws/i, /split step/i, /\d+@\d+%/, /@ ~\d+%/, /anti-rotation\]/, /cardiovascular"\]/, /HIGHEST PRIORITY/]) {
      expect(all).not.toMatch(phrase)
    }
  })
  it("the dead prompts are deleted", () => {
    expect("VALIDATION_AGENT_PROMPT" in prompts).toBe(false)
    expect("WEEK_PROFILE_ANALYZER_PROMPT" in prompts).toBe(false)
  })
  it("the selector knows its athlete block, fit and per_side", () => {
    for (const s of ["Constraints.athlete", '"fit"', '"fit_reason"', '"per_side"', "sport is null"]) {
      expect(EXERCISE_SELECTOR_PROMPT).toContain(s)
    }
  })
  it("notes are cues only", () => {
    expect(EXERCISE_SELECTOR_PROMPT).toMatch(/never state sets, reps, rest, RPE, percentages or loads/i)
  })
  it("the architect reads the muscle list and has one week-1 effort", () => {
    expect(PROGRAM_ARCHITECT_PROMPT).toContain("Muscle names")
    expect(PROGRAM_ARCHITECT_PROMPT).toContain("RPE 6-7 in week 1, 7-8 in week 2, 8-9 from week 3")
    expect(PROGRAM_ARCHITECT_PROMPT).not.toMatch(/RPE 7-8 in weeks 1-2/)
  })
  it("the time cap yields to a coach-stated count", () => {
    expect(PROGRAM_ARCHITECT_PROMPT).toMatch(/NEVER exceed these caps unless the coach stated an exercise count/)
  })
  it("coach instructions sit below safety", () => {
    const s = buildCoachInstructionsSection("4 power exercises")
    expect(s).toContain("ladder rank 3")
    expect(s).toMatch(/Never overridden by these/)
  })
})
