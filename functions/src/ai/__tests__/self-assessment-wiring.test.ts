import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The generate route puts the client's own quiz result on the request as `self_assessment`
// (lib/quizzes/client-result.ts, which functions/ cannot import). The orchestrator only places it.
describe("self-assessment wiring", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../orchestrator.ts"), "utf8")

  it("gives the section to all three agents, right after the previous program", () => {
    expect(src).toContain("${assessmentSection}${previousProgramSection}${selfAssessmentSection}`")
    expect(src).toContain("${previousProgramSection}${selfAssessmentSection}${buildPoolPatternSection(")
    expect(src).toContain("${coachInstructionsSection}${previousProgramSection}${selfAssessmentSection}`")
  })

  it("skips it when the coach chose to ignore the profile", () => {
    expect(src).toMatch(/const selfAssessmentSection =\s*request\.self_assessment && !request\.ignore_profile/)
  })

  it("keeps it out of the coach instructions, which are parsed for exercise names", () => {
    expect(src).not.toMatch(/combinedInstructions[^\n]*self_?[aA]ssessment/)
  })

  it("is declared on the request the job carries", () => {
    expect(src).toMatch(/interface AiGenerationRequest \{[\s\S]*?self_assessment\?: string[\s\S]*?\n\}/)
  })
})
