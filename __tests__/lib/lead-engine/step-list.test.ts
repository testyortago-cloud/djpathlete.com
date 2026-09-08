import { describe, it, expect } from "vitest"
import { stepGraphEdges, hasCycle, reachableFrom, validateStepList, type StepDraft } from "@/lib/lead-engine/step-list"

/** The messages only, for terser assertions. */
const messages = (steps: StepDraft[]) => validateStepList(steps).map((p) => p.message)

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

describe("validateStepList — the shapes the database would reject anyway", () => {
  it("accepts a plain email, wait, stop list", () => {
    expect(validateStepList([step("email"), step("wait"), step("stop")])).toEqual([])
  })

  it("rejects an email with no subject", () => {
    const problems = validateStepList([step("email", { subject: null })])
    expect(problems).toHaveLength(1)
    expect(problems[0].index).toBe(0)
    expect(problems[0].message).toMatch(/subject/i)
  })

  it("rejects an email with no body", () => {
    expect(messages([step("email", { body: null })])).toEqual([expect.stringMatching(/written|body|say/i)])
  })

  it("rejects a text with no body", () => {
    expect(messages([step("sms", { body: null })])).toEqual([expect.stringMatching(/written|body|say/i)])
  })

  it("rejects a wait with no length", () => {
    expect(messages([step("wait", { wait_minutes: null })])).toEqual([expect.stringMatching(/how long/i)])
  })

  it("rejects a wait of zero, which the database would accept", () => {
    // sequence_steps_wait_needs_minutes only checks NOT NULL. A zero wait is
    // storable and pointless, so this half of the rule is ours.
    expect(messages([step("wait", { wait_minutes: 0 })])).toHaveLength(1)
  })

  it("rejects a split with no question attached", () => {
    expect(messages([step("branch", { branch_condition: null })])).toEqual([expect.stringMatching(/which people|question/i)])
  })

  it("rejects a question the engine does not know", () => {
    // evaluateBranch FAILS the run on an unknown predicate rather than guessing
    // an arm, so the editor must not be able to save one.
    const bogus = { kind: "has_dog" } as unknown as StepDraft["branch_condition"]
    expect(messages([step("branch", { branch_condition: bogus })])).toHaveLength(1)
  })

  it("rejects a consent check for a channel the engine cannot send on", () => {
    // has_consent is a known KIND, but its own `channel` field is still
    // narrower than "any string" -- evaluateBranch only knows "email" and
    // "sms". A step that names some other channel must fail the same way an
    // unknown kind does, not be waved through because the kind matched.
    const bogus = { kind: "has_consent", channel: "fax" } as unknown as StepDraft["branch_condition"]
    expect(messages([step("branch", { branch_condition: bogus })])).toHaveLength(1)
  })

  it("rejects a label step with no label, using step-config's own wording", () => {
    const problems = validateStepList([step("tag", { config: {} })])
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toBe("This sequence's tag step does not say which tag to add.")
  })

  it("accepts a label step whose label parses", () => {
    expect(validateStepList([step("tag", { config: { tag: "warm-lead" } })])).toEqual([])
  })

  it("rejects a card-move step with no stage, using step-config's own wording", () => {
    const problems = validateStepList([step("stage", { config: {} })])
    expect(problems[0].message).toBe("This sequence's stage step does not say which stage to move the person to.")
  })

  it("rejects an empty list", () => {
    expect(messages([])).toHaveLength(1)
  })
})

describe("validateStepList — the rules the database cannot express", () => {
  // 0 branch -> true:1, false:3
  // 1 email  \ first side
  // 2 stop   /
  // 3 email  \ second side
  // 4 stop   /
  const soundBranch = (): StepDraft[] => [
    step("branch", { on_true_position: 1, on_false_position: 3 }),
    step("email"),
    step("stop"),
    step("email"),
    step("stop"),
  ]

  it("accepts a split where each side ends on its own", () => {
    expect(validateStepList(soundBranch())).toEqual([])
  })

  it("rejects a split whose first side runs on into the second", () => {
    // Delete the first side's ending. Position 1 now advances to 2, 2 to 3 --
    // and 3 is the second side's opening email. The person gets both endings.
    const steps = soundBranch()
    steps[2] = step("email")
    const problems = validateStepList(steps)
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/runs on into|both/i)
  })

  it("rejects a split whose SECOND side runs on into the first", () => {
    // Mirrors the test above with the arms swapped: the "false" side sits at
    // the lower positions this time, and — missing its own ending — falls
    // through into the "true" side higher up. `yes` here is 3, `no` is 1, so
    // this scenario is only caught by `reachableFrom(edges, no).has(yes)`;
    // the other half of that check never sees it.
    const steps: StepDraft[] = [
      step("branch", { on_true_position: 3, on_false_position: 1 }),
      step("email"),
      step("wait"),
      step("email"),
      step("stop"),
    ]
    const problems = validateStepList(steps)
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/runs on into|both/i)
  })

  it("accepts a side that ends by running off the end of the list", () => {
    // Not the house style, but decideStep completes the run when no step
    // matches, so it is a real ending. Rejecting it would be a false alarm.
    const steps: StepDraft[] = [
      step("branch", { on_true_position: 1, on_false_position: 2 }),
      step("stop"),
      step("email"),
    ]
    expect(validateStepList(steps)).toEqual([])
  })

  it("accepts both sides pointing at the same ending", () => {
    // A pointless split, but harmless: there is no other arm to fall into.
    const steps: StepDraft[] = [
      step("branch", { on_true_position: 1, on_false_position: 1 }),
      step("stop"),
    ]
    expect(validateStepList(steps)).toEqual([])
  })

  it("rejects a list that loops forever", () => {
    const steps: StepDraft[] = [step("email"), step("branch", { on_true_position: 0, on_false_position: 2 }), step("stop")]
    expect(messages(steps)).toEqual([expect.stringMatching(/round in circles|loop/i)])
  })
})
