// @vitest-environment node
//
// G09. A branch predicate is declared in FOUR places, and only one of them is
// enforced by the compiler:
//
//   1. `BranchCondition` (lib/automation/sequence-tick.ts) — the union.
//   2. `BRANCH_KIND_LABEL` (StepEditor.tsx) — a Record over the union, so tsc
//      DOES catch a missing entry here.
//   3. `KNOWN_BRANCH_KINDS` (lib/lead-engine/step-list.ts) — a `Set<string>`.
//      A typo compiles.
//   4. `branchConditionSchema` (lib/validators/sequence-admin.ts) — a Zod
//      union. A missing member compiles.
//
// So a predicate can be offered in the editor, chosen by a coach, and then
// rejected at save or treated as unknown by the step list, with nothing in the
// build complaining. This file is the guard for 3 and 4.
import { describe, it, expect } from "vitest"
import { stepDraftSchema } from "@/lib/validators/sequence-admin"
import { validateStepList, type StepDraft } from "@/lib/lead-engine/step-list"
import type { BranchCondition } from "@/lib/automation/sequence-tick"

/**
 * One example of every predicate the union declares. Adding a member to
 * `BranchCondition` without adding it here is a tsc error, because the Record
 * key type is the union itself — the same trick `BRANCH_KIND_LABEL` uses.
 */
const EXAMPLES: Record<BranchCondition["kind"], BranchCondition> = {
  has_phone: { kind: "has_phone" },
  has_user: { kind: "has_user" },
  has_consent: { kind: "has_consent", channel: "email" },
  source_is: { kind: "source_is", value: "funnel_form" },
  opened_last_email: { kind: "opened_last_email" },
  clicked_last_email: { kind: "clicked_last_email" },
}

describe("every branch predicate is declared consistently in all four places", () => {
  /** A branch step as the save endpoint receives it. */
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

  it("the save schema accepts every predicate the union declares", () => {
    // Through `stepDraftSchema`, the PUBLIC shape a save actually goes through,
    // rather than the internal union. The coach's save is what would break, so
    // that is the thing to assert on.
    for (const [kind, condition] of Object.entries(EXAMPLES)) {
      const parsed = stepDraftSchema.safeParse(draft(condition))
      expect(parsed.success, `the save schema rejected ${kind}`).toBe(true)
    }
  })

  it("the step list treats every predicate as known", () => {
    // `validateStepList` reports an unknown branch condition as a problem. A
    // predicate missing from KNOWN_BRANCH_KINDS would be flagged on a sequence
    // that is in fact perfectly valid — and the coach could not save it.
    const stop = (position: number): StepDraft => ({
      id: `s-${position}`,
      kind: "stop",
      wait_minutes: null,
      subject: null,
      body: null,
      branch_condition: null,
      on_true_position: null,
      on_false_position: null,
      config: {},
    })

    for (const [kind, condition] of Object.entries(EXAMPLES)) {
      const problems = validateStepList([
        {
          id: "s-0",
          kind: "branch",
          wait_minutes: null,
          subject: null,
          body: null,
          branch_condition: condition,
          on_true_position: 1,
          on_false_position: 2,
          config: {},
        },
        stop(1),
        stop(2),
      ])
      const aboutTheCondition = problems.filter((p) => /condition|understand|unknown/i.test(p.message))
      expect(
        aboutTheCondition,
        `${kind} was not recognised: ${aboutTheCondition.map((p) => p.message).join("; ")}`,
      ).toEqual([])
    }
  })

  it("rejects a predicate that is NOT declared — the control", () => {
    // Without this, both assertions above would pass against a schema that
    // accepted anything at all.
    expect(stepDraftSchema.safeParse(draft({ kind: "phase_of_moon" })).success).toBe(false)
  })
})
