import { describe, it, expect } from "vitest"
import { stepGraphEdges, hasCycle, reachableFrom, type StepDraft } from "@/lib/lead-engine/step-list"

/** A step with everything nulled out except what the test cares about. */
function step(kind: StepDraft["kind"], over: Partial<StepDraft> = {}): StepDraft {
  return {
    id: null,
    kind,
    wait_minutes: kind === "wait" ? 60 : null,
    subject: kind === "email" ? "S" : null,
    body: kind === "email" || kind === "sms" ? "B" : null,
    branch_condition: kind === "branch" ? { kind: "has_phone" } : null,
    on_true_position: null,
    on_false_position: null,
    config: {},
    ...over,
  }
}

describe("stepGraphEdges", () => {
  it("advances every ordinary step to the next position", () => {
    const steps = [step("email"), step("wait"), step("stop")]
    expect(stepGraphEdges(steps)).toEqual([[1], [2], []])
  })

  it("gives a stop step no successors at all", () => {
    expect(stepGraphEdges([step("stop")])).toEqual([[]])
  })

  it("gives a branch both of its targets", () => {
    const steps = [
      step("branch", { on_true_position: 1, on_false_position: 3 }),
      step("email"),
      step("stop"),
      step("email"),
      step("stop"),
    ]
    expect(stepGraphEdges(steps)[0].slice().sort()).toEqual([1, 3])
  })

  it("falls back to the next position for a branch target left unset", () => {
    // decideStep does `target ?? step.position + 1`. The graph must agree,
    // or the walk validates a shape the engine will not actually follow.
    const steps = [step("branch", { on_true_position: null, on_false_position: 2 }), step("email"), step("stop")]
    expect(stepGraphEdges(steps)[0].slice().sort()).toEqual([1, 2])
  })

  it("drops an edge that runs off the end", () => {
    // decideStep returns { kind: "complete" } when no step matches, so this is
    // a real ending, not a dangling pointer.
    expect(stepGraphEdges([step("email")])).toEqual([[]])
  })
})

describe("hasCycle", () => {
  it("is false for a straight line", () => {
    expect(hasCycle([[1], [2], []])).toBe(false)
  })

  it("is true when a branch points backwards into its own past", () => {
    expect(hasCycle([[1], [0]])).toBe(true)
  })

  it("is true for a step that points at itself", () => {
    expect(hasCycle([[0]])).toBe(true)
  })

  it("is false when two paths rejoin without looping", () => {
    // A diamond is not a cycle. A validator that rejects this would forbid a
    // perfectly legal sequence where both sides end at the same goodbye.
    expect(hasCycle([[1, 2], [3], [3], []])).toBe(false)
  })
})

describe("reachableFrom", () => {
  it("includes the start and everything downstream", () => {
    expect([...reachableFrom([[1], [2], []], 0)].sort()).toEqual([0, 1, 2])
  })

  it("stops at a stop step", () => {
    expect([...reachableFrom([[1], [], [3], []], 0)].sort()).toEqual([0, 1])
  })

  it("terminates on a cycle instead of hanging", () => {
    expect([...reachableFrom([[1], [0]], 0)].sort()).toEqual([0, 1])
  })
})
