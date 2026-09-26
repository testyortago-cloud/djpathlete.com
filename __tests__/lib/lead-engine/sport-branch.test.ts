// @vitest-environment node
//
// G16 {{sport}}: adding `sport` to ENROLMENT_METADATA_KEYS does three things
// at once, and this file pins the two that live server-side (the editor's
// dropdown is pinned in StepEditor.test.tsx, the merge field in
// merge-fields.test.ts):
//   - the save schema now accepts a branch on `sport` (and still refuses a key
//     nothing writes, such as `goals`);
//   - the tick's `enrolled_metadata_is` answers it the way a coach expects,
//     ignoring case and surrounding spaces, because the stored side is what a
//     stranger typed ("Soccer") and the compared side is what a coach typed.

import { describe, it, expect } from "vitest"
import { stepDraftSchema } from "@/lib/validators/sequence-admin"
import { evaluateBranch, type BranchCondition, type DecisionContext } from "@/lib/automation/sequence-tick"

function draft(condition: unknown) {
  return {
    id: "s-0",
    kind: "branch",
    wait_minutes: null,
    subject: null,
    body: null,
    branch_condition: condition,
    on_true_position: 1,
    on_false_position: 2,
    config: {},
  }
}

function ctx(enrolmentMetadata: DecisionContext["enrolmentMetadata"]): DecisionContext {
  return { enrolmentMetadata } as DecisionContext
}

const onSoccer: BranchCondition = { kind: "enrolled_metadata_is", key: "sport", value: " soccer " }

describe("a branch on the applicant's sport", () => {
  it("is accepted by the save schema", () => {
    expect(stepDraftSchema.safeParse(draft(onSoccer)).success).toBe(true)
  })

  it("is refused for a key nothing writes (control: the schema is not accepting any key)", () => {
    const onGoals = { kind: "enrolled_metadata_is", key: "goals", value: "speed" }
    expect(stepDraftSchema.safeParse(draft(onGoals)).success).toBe(false)
  })

  it("matches what the applicant typed, ignoring case and spaces", () => {
    expect(evaluateBranch(onSoccer, ctx({ sport: "Soccer" }))).toEqual({ ok: true, value: true })
  })

  it("is false for another sport, and for an applicant who left the box empty", () => {
    expect(evaluateBranch(onSoccer, ctx({ sport: "Tennis" }))).toEqual({ ok: true, value: false })
    expect(evaluateBranch(onSoccer, ctx({ service: "online" }))).toEqual({ ok: true, value: false })
  })
})
