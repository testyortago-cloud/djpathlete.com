# Sequence Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/admin/sequences` an on/off switch that genuinely stops a sequence, and a step editor that can create every step kind — including `tag` and `stage`, which nothing in the product can create today.

**Architecture:** Pure decision functions in `lib/lead-engine/step-list.ts` (validation, branch-arm walking, and the in-flight re-point plan), written pure so `sequence-tick.ts` can keep importing zero IO and so they can be tested with no mocks. One plpgsql function performs the save atomically; TypeScript decides, SQL writes. Two thin admin-only API routes. React UI on the existing reporting screen.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgREST + plpgsql), Zod, vitest, Tailwind v4, shadcn/ui, `components/ui/data-table.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-08-sequence-management-design.md` — read it. It records two production measurements that this plan assumes and that are not obvious from the code.

## Global Constraints

- **Node 24.** `source ~/.nvm/nvm.sh && nvm use` before any vitest or tsc. Route suites need `--environment node` pinned or they report "no tests" — a known trap, not a missing file.
- **`tsc --noEmit` baseline is exactly 238 errors across 54 files** at branch point `ce6f2aba`. The per-file baseline is saved at `.claude/baselines/tsc-ce6f2aba-perfile.txt`. Diff the per-file **set**, never the count — a falling count still hides new errors.
- **Targeted tests only.** Never run the full suite at a checkpoint.
- **Pre-existing red, not yours:** `__tests__/migrations/00062.test.ts` fails 3/6 and `__tests__/api/spine/purchase-spine.test.ts` fails 1/11. Both are live-DB tests that fail identically on a clean checkout.
- **Prettier is unclean on ~78 pre-existing files repo-wide.** Do NOT run `prettier --write` on a file you did not create. Format only your own new files.
- **Never add a `SINGLETON_BUSINESS_ID` reference** in `lib/`, `app/` or `scripts/`. Every new read and write carries a tenant predicate.
- **No brand names anywhere under `lib/lead-engine/`, comments included.** A test sweeps for them.
- **Every list uses `components/ui/data-table.tsx`.** Never hand-roll a `<table>`. `DataTableEmpty` renders its own `<tr>`; `DataTable` emits no `<tbody>`.
- **Admin UI is light-only.** Do not add `dark:` variants.
- **Copy is for a non-programmer.** No "opportunity", "pipeline stage", "config", "position", "branch", "status", "boolean", no backticks. These strings reach a coach raw via `run.last_error` on `components/admin/contacts/ContactDetail.tsx`.
- **Code must tolerate the old schema for one deploy.** Migrations apply on push to `main` via a path-filtered Action that races the Vercel build; nothing sequences the two.
- **No Claude or AI attribution in commit messages.** Check after every task: `git log ce6f2aba..HEAD --format=%B | grep -ci "co-authored-by\|claude\|generated with"` must print `0`.
- **Plan-authored code is a sketch.** It has not been through the compiler. Where a snippet below disagrees with the real types, the real types win — say so in your report rather than casting the error away.

---
## File Structure

| File | Responsibility |
|---|---|
| `lib/lead-engine/step-list.ts` **(new)** | Pure. The step graph, branch-arm reachability, list validation, and the in-flight re-point plan. Imports `parseTagConfig`/`parseStageConfig` and nothing with IO. |
| `supabase/migrations/00256_sequence_management.sql` **(new)** | Replaces `claim_sequence_runs` with a version gated on the sequence being on; adds `save_sequence_steps`. |
| `lib/db/sequence-admin.ts` **(new)** | The only DAL for these writes: read a sequence for editing, set its status, call the save function. |
| `lib/validators/sequence-admin.ts` **(new)** | Zod schemas for the two route bodies. |
| `app/api/admin/sequences/[key]/status/route.ts` **(new)** | `PATCH` — turn a sequence on or off. Admin-only. |
| `app/api/admin/sequences/[key]/steps/route.ts` **(new)** | `PUT` — save the whole step list. Admin-only. |
| `components/admin/sequences/SequenceSwitch.tsx` **(new)** | The on/off control plus its confirmation dialog. Used by both screens. |
| `components/admin/sequences/StepEditor.tsx` **(new)** | The step list editor. |
| `lib/db/sequence-reporting.ts` (modify) | `bucketForRun` learns `sequence_edited`. |
| `components/admin/sequences/SequenceReportTable.tsx` (modify) | Adds the switch column; corrects the pause wording. |
| `app/(admin)/admin/sequences/[key]/page.tsx` (modify) | Renders the switch and the editor. |
| `lib/audit/actions.ts` (modify) | Two new slugs. |

---

### Task 1: The step graph and branch-arm reachability

The single most important assertion in this feature. A branch target is the engine's **only** jump — every other step advances by `position + 1` — so an arm that runs off its own end falls into the *other* arm and the person receives both endings. That error was already made once on the `00255` spec and was caught by hand, not by a test.

**Files:**
- Create: `lib/lead-engine/step-list.ts`
- Test: `__tests__/lib/lead-engine/step-list.test.ts`

**Interfaces:**
- Consumes: `StepKind`, `BranchCondition` (type-only) from `@/lib/automation/sequence-tick`.
- Produces:
  - `type StepDraft` — one step being edited. **`id: string | null`**; `null` means a step that does not exist in the database yet. There is no `position` field: **the array index IS the position**, which is what makes renumbering impossible to get wrong.
  - `stepGraphEdges(steps: StepDraft[]): number[][]`
  - `hasCycle(edges: number[][]): boolean`
  - `reachableFrom(edges: number[][], start: number): Set<number>`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/lead-engine/step-list.test.ts`. No mocks — this module is pure.

```ts
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
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use
npx vitest run __tests__/lib/lead-engine/step-list.test.ts
```

Expected: fails to resolve `@/lib/lead-engine/step-list`.

- [ ] **Step 3: Write the implementation**

Create `lib/lead-engine/step-list.ts`. Copy this header — it is the reason the module exists:

```ts
// lib/lead-engine/step-list.ts — what a whole list of sequence steps is
// allowed to look like, as pure functions.
//
// PURE, for the reason lib/lead-engine/step-config.ts gives for its own
// purity: lib/automation/sequence-tick.ts may import no IO, and the editor has
// to reject EXACTLY what the tick rejects. Two validators drift, and the
// operator finds out when a saved step fails silently at 3am.
//
// THE POINT OF THIS FILE is the branch-arm walk. A branch target is the only
// jump this engine has -- every other step advances to position + 1 -- so an
// arm that runs off its own end falls straight into the OTHER arm's steps and
// the person receives both endings. That design error has already been made
// once here, on the spec for migration 00255, and was caught by a human
// reading a table rather than by anything automatic. This file is the
// automatic thing.
//
// THE ARRAY INDEX IS THE POSITION. There is deliberately no `position` field
// on StepDraft: the editor owns numbering, the operator never types a number,
// and a list that cannot express a duplicate or a gap cannot violate
// sequence_steps_position_uniq.

import type { StepKind, BranchCondition } from "@/lib/automation/sequence-tick"

export type StepDraft = {
  /** `null` for a step that does not exist in the database yet. */
  id: string | null
  kind: StepKind
  wait_minutes: number | null
  subject: string | null
  body: string | null
  branch_condition: BranchCondition | null
  on_true_position: number | null
  on_false_position: number | null
  config: Record<string, unknown>
}

/**
 * Successor positions for every step, mirroring `decideStep` exactly.
 *
 * An edge that lands outside the list is DROPPED rather than recorded: when no
 * step matches a position, `decideStep` returns `{ kind: "complete" }`, so
 * running off the end is a real ending and not a dangling pointer. A branch
 * target left unset falls back to `position + 1`, which is the same
 * `target ?? step.position + 1` the engine uses.
 */
export function stepGraphEdges(steps: StepDraft[]): number[][] {
  const inRange = (p: number) => p >= 0 && p < steps.length
  return steps.map((step, at) => {
    if (step.kind === "stop") return []
    if (step.kind === "branch") {
      const targets = [step.on_true_position ?? at + 1, step.on_false_position ?? at + 1]
      return [...new Set(targets)].filter(inRange)
    }
    return [at + 1].filter(inRange)
  })
}

/**
 * Depth-first with a recursion stack. A diamond -- two arms rejoining at a
 * shared ending -- is NOT a cycle and must stay legal; only an edge back onto
 * the current path is.
 */
export function hasCycle(edges: number[][]): boolean {
  const UNVISITED = 0
  const ON_PATH = 1
  const DONE = 2
  const mark = new Array<number>(edges.length).fill(UNVISITED)

  const visit = (at: number): boolean => {
    if (mark[at] === ON_PATH) return true
    if (mark[at] === DONE) return false
    mark[at] = ON_PATH
    for (const next of edges[at]) {
      if (visit(next)) return true
    }
    mark[at] = DONE
    return false
  }

  for (let at = 0; at < edges.length; at += 1) {
    if (mark[at] === UNVISITED && visit(at)) return true
  }
  return false
}

/** Every position reachable from `start`, including `start`. Cycle-safe. */
export function reachableFrom(edges: number[][], start: number): Set<number> {
  const seen = new Set<number>()
  const stack = [start]
  while (stack.length > 0) {
    const at = stack.pop() as number
    if (at < 0 || at >= edges.length || seen.has(at)) continue
    seen.add(at)
    for (const next of edges[at]) stack.push(next)
  }
  return seen
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run __tests__/lib/lead-engine/step-list.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Mutate every test that passed first time**

Each mutation below goes in, the suite runs, the **actual per-test vitest output** is recorded, and the mutation is reverted. Do not infer which tests "should" break — read the output. Commit BEFORE mutating; a git-based mutation harness is only safe on a clean tree. Strip ANSI before grepping: `| sed 's/\x1b\[[0-9;]*m//g'`.

| # | Mutation | In |
|---|---|---|
| M1 | delete the `if (step.kind === "stop") return []` line | `stepGraphEdges` |
| M2 | change `step.on_true_position ?? at + 1` to `step.on_true_position ?? -1` | `stepGraphEdges` |
| M3 | drop the `.filter(inRange)` on the branch arm | `stepGraphEdges` |
| M4 | in `hasCycle`, treat `ON_PATH` as `DONE` (return `false` instead of `true`) | `hasCycle` |
| M5 | in `hasCycle`, return `true` for `DONE` as well — this is the diamond mutant and MUST be killed by the rejoin test | `hasCycle` |
| M6 | in `reachableFrom`, remove `seen.has(at)` from the skip condition | `reachableFrom` — expect a hang or a timeout; that IS the finding |

If any mutation survives, that is a finding to report, not something to paper over. It usually means two checks are masking each other.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/step-list.ts __tests__/lib/lead-engine/step-list.test.ts
git commit -m "feat(sequences): pure step graph with branch-arm reachability"
git log ce6f2aba..HEAD --format=%B | grep -ci "co-authored-by\|claude\|generated with"
```

The grep must print `0`.

---
### Task 2: Validating a whole step list

Mirrors every database CHECK so the operator gets a sentence instead of a `23514`, and adds the two rules the database cannot express: a branch arm must not run on into the other arm, and the list must not loop.

**Files:**
- Modify: `lib/lead-engine/step-list.ts`
- Modify: `__tests__/lib/lead-engine/step-list.test.ts`

**Interfaces:**
- Consumes: `stepGraphEdges`, `hasCycle`, `reachableFrom` from Task 1; `parseTagConfig`, `parseStageConfig` from `@/lib/lead-engine/step-config`.
- Produces:
  - `type StepProblem = { index: number | null; message: string }`
  - `validateStepList(steps: StepDraft[]): StepProblem[]` — empty array means valid. `index` is the step the problem belongs to, or `null` for a whole-list problem.

**Do NOT write a second copy of the tag/stage rules.** `lib/lead-engine/step-config.ts` says in its own header that the editor must reject exactly what the tick rejects, and that one implementation is the only way that stays true. Call `parseTagConfig` and `parseStageConfig` and surface their `error` strings, which are already written for a non-programmer.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/lead-engine/step-list.test.ts` (the `step()` helper from Task 1 is already in the file):

```ts
import { validateStepList } from "@/lib/lead-engine/step-list"

/** The messages only, for terser assertions. */
const messages = (steps: StepDraft[]) => validateStepList(steps).map((p) => p.message)

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
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run __tests__/lib/lead-engine/step-list.test.ts
```

Expected: `validateStepList is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/lead-engine/step-list.ts`:

```ts
import { parseTagConfig, parseStageConfig } from "@/lib/lead-engine/step-config"

export type StepProblem = { index: number | null; message: string }

/** Exactly the four predicates `evaluateBranch` implements. Anything else fails a run. */
const KNOWN_BRANCH_KINDS = new Set(["has_phone", "has_user", "has_consent", "source_is"])

function branchConditionIsKnown(condition: BranchCondition | null): boolean {
  if (condition === null) return false
  if (!KNOWN_BRANCH_KINDS.has(condition.kind)) return false
  if (condition.kind === "has_consent") return condition.channel === "email" || condition.channel === "sms"
  if (condition.kind === "source_is") return typeof condition.value === "string" && condition.value.trim().length > 0
  return true
}

/**
 * Every problem with a step list, in the order a person would read them.
 *
 * Returns [] for a valid list. The first block mirrors the CHECK constraints on
 * `sequence_steps` -- not redundantly: the constraint stays and is the last
 * line, and this exists so the failure arrives as English before the write.
 * The second block is the two rules SQL cannot state.
 */
export function validateStepList(steps: StepDraft[]): StepProblem[] {
  const problems: StepProblem[] = []

  if (steps.length === 0) {
    return [{ index: null, message: "A sequence needs at least one step." }]
  }

  steps.forEach((step, index) => {
    switch (step.kind) {
      case "email":
        if (!step.subject || step.subject.trim().length === 0) {
          problems.push({ index, message: "This email has no subject line." })
        }
        if (!step.body || step.body.trim().length === 0) {
          problems.push({ index, message: "This email has nothing written in it." })
        }
        break
      case "sms":
        if (!step.body || step.body.trim().length === 0) {
          problems.push({ index, message: "This text has nothing written in it." })
        }
        break
      case "wait":
        if (step.wait_minutes === null || step.wait_minutes <= 0) {
          problems.push({ index, message: "This wait does not say how long to wait for." })
        }
        break
      case "branch":
        if (!branchConditionIsKnown(step.branch_condition)) {
          problems.push({ index, message: "This split does not say which people go down each side." })
        }
        break
      case "tag": {
        const parsed = parseTagConfig(step.config)
        if (!parsed.ok) problems.push({ index, message: parsed.error })
        break
      }
      case "stage": {
        const parsed = parseStageConfig(step.config)
        if (!parsed.ok) problems.push({ index, message: parsed.error })
        break
      }
      case "alert":
      case "stop":
        break
    }
  })

  const edges = stepGraphEdges(steps)

  if (hasCycle(edges)) {
    problems.push({ index: null, message: "These steps go round in circles, so somebody could never reach the end." })
  } else {
    // Only meaningful on an acyclic list; on a cyclic one every arm reaches
    // everything and this would produce a second, confusing complaint about
    // the same defect.
    steps.forEach((step, at) => {
      if (step.kind !== "branch") return
      const yes = step.on_true_position ?? at + 1
      const no = step.on_false_position ?? at + 1
      if (yes === no) return // one shared ending: there is no other side to fall into
      if (reachableFrom(edges, yes).has(no) || reachableFrom(edges, no).has(yes)) {
        problems.push({
          index: at,
          message: "One side of this split runs on into the other, so the same person would get both endings.",
        })
      }
    })
  }

  return problems
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
npx vitest run __tests__/lib/lead-engine/step-list.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Mutate — including EACH CONJUNCT separately**

A `&&` or `||` whose other half is already pinned survives a whole green suite. Mutate each half on its own.

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | `step.wait_minutes <= 0` → `< 0` | the zero-wait test |
| M2 | drop the `step.wait_minutes === null` half only | the no-length test |
| M3 | `if (yes === no) return` → `return` unconditionally (skip the fall-through check entirely) | the runs-on test |
| M4 | delete `if (yes === no) return` | the shared-ending test |
| M5 | `reachableFrom(edges, yes).has(no) \|\| reachableFrom(edges, no).has(yes)` → drop the second half | write a list where only the SECOND side runs on into the first, or report that no existing test covers it and add one |
| M6 | make `branchConditionIsKnown` return `true` for any non-null condition | the unknown-question test |
| M7 | drop the `has_consent` channel check only | needs its own test — add one if M7 survives |
| M8 | replace the `parseTagConfig` call with an inline `!!step.config.tag` check | should still pass; that is the point — report it, then confirm a whitespace-only tag (`{ tag: "   " }`) kills it, proving the shared parser is load-bearing |
| M9 | move the fall-through check outside the `else`, so it runs on cyclic lists too | the loop test now reports two problems |

M5 and M7 are expected to expose missing coverage rather than a broken implementation. Add the tests they demand; a survivor is a finding.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/step-list.ts __tests__/lib/lead-engine/step-list.test.ts
git commit -m "feat(sequences): validate a step list, including branch-arm fall-through"
git log ce6f2aba..HEAD --format=%B | grep -ci "co-authored-by\|claude\|generated with"
```

---
### Task 3: The plan for people who are partway through

`decideStep` resolves a run with `steps.find(s => s.position === run.current_position)` and, on no match, returns `{ kind: "complete" }`. So today an edit that renumbers steps can leave a live run pointing at nothing — and that run is recorded as **"Reached the end"**, which the reporting screen cannot tell apart from genuinely finishing. This function is what stops that.

**Files:**
- Modify: `lib/lead-engine/step-list.ts`
- Modify: `__tests__/lib/lead-engine/step-list.test.ts`

**Interfaces:**
- Produces:
  - `type RunPointer = { id: string; current_position: number }`
  - `type SavedStep = { id: string; position: number }` — a step as it exists NOW, before the edit.
  - `type StepSavePlan = { repoint: Array<{ runId: string; from: number; to: number }>; exit: Array<{ runId: string; from: number }>; unchanged: string[] }`
  - `planStepSave(oldSteps: SavedStep[], newSteps: StepDraft[], runs: RunPointer[]): StepSavePlan`

Identity is by **step id**, not position — ids survive a renumber and positions do not. That is the whole trick.

- [ ] **Step 1: Write the failing tests**

```ts
import { planStepSave, type SavedStep, type RunPointer } from "@/lib/lead-engine/step-list"

describe("planStepSave", () => {
  const old3: SavedStep[] = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ]
  const withId = (id: string | null) => step("email", { id })

  it("leaves everyone alone when nothing moved", () => {
    const plan = planStepSave(old3, [withId("a"), withId("b"), withId("c")], [{ id: "r1", current_position: 1 }])
    expect(plan.repoint).toEqual([])
    expect(plan.exit).toEqual([])
    expect(plan.unchanged).toEqual(["r1"])
  })

  it("carries a person across when their step moved", () => {
    // A new step is inserted at the top, so "b" slides from 1 to 2.
    const plan = planStepSave(old3, [withId(null), withId("a"), withId("b"), withId("c")], [{ id: "r1", current_position: 1 }])
    expect(plan.repoint).toEqual([{ runId: "r1", from: 1, to: 2 }])
    expect(plan.exit).toEqual([])
  })

  it("stops a person whose step was removed", () => {
    const plan = planStepSave(old3, [withId("a"), withId("c")], [{ id: "r1", current_position: 1 }])
    expect(plan.exit).toEqual([{ runId: "r1", from: 1 }])
    expect(plan.repoint).toEqual([])
  })

  it("leaves a person already past the end alone", () => {
    // No old step at position 9, so there is nothing to re-point them to and
    // nothing was taken away. They complete exactly as they would have.
    const plan = planStepSave(old3, [withId("a")], [{ id: "r1", current_position: 9 }])
    expect(plan.exit).toEqual([])
    expect(plan.repoint).toEqual([])
    expect(plan.unchanged).toEqual(["r1"])
  })

  it("re-points a person whose step moved EARLIER, not just later", () => {
    const plan = planStepSave(old3, [withId("c"), withId("a"), withId("b")], [{ id: "r1", current_position: 2 }])
    expect(plan.repoint).toEqual([{ runId: "r1", from: 2, to: 0 }])
  })

  it("handles several people at once, each on their own footing", () => {
    const plan = planStepSave(old3, [withId("a"), withId("c")], [
      { id: "r1", current_position: 0 },
      { id: "r2", current_position: 1 },
      { id: "r3", current_position: 2 },
    ])
    expect(plan.unchanged).toEqual(["r1"])
    expect(plan.exit).toEqual([{ runId: "r2", from: 1 }])
    expect(plan.repoint).toEqual([{ runId: "r3", from: 2, to: 1 }])
  })

  it("ignores a brand-new step's null id when matching", () => {
    // Two new steps both carry id null. Keying on it would collide and could
    // re-point somebody onto an unrelated step.
    const plan = planStepSave(old3, [withId(null), withId(null), withId("b")], [{ id: "r1", current_position: 1 }])
    expect(plan.repoint).toEqual([{ runId: "r1", from: 1, to: 2 }])
  })
})
```

- [ ] **Step 2: Run and watch it fail.** `npx vitest run __tests__/lib/lead-engine/step-list.test.ts`

- [ ] **Step 3: Implement**

```ts
export type RunPointer = { id: string; current_position: number }
export type SavedStep = { id: string; position: number }
export type StepSavePlan = {
  repoint: Array<{ runId: string; from: number; to: number }>
  exit: Array<{ runId: string; from: number }>
  unchanged: string[]
}

/**
 * What an edit does to the people who are partway through.
 *
 * Matched on STEP ID, never position -- ids survive a renumber and positions
 * are exactly what a renumber changes. A run whose step still exists is
 * carried to wherever that step now sits; a run whose step has been taken away
 * is EXITED, so it is never recorded as having reached the end.
 *
 * A run pointing past the end of the OLD list is left alone: nothing was taken
 * from it, and `decideStep` already completes it.
 */
export function planStepSave(oldSteps: SavedStep[], newSteps: StepDraft[], runs: RunPointer[]): StepSavePlan {
  const idAtOldPosition = new Map<number, string>()
  for (const step of oldSteps) idAtOldPosition.set(step.position, step.id)

  const newPositionOfId = new Map<string, number>()
  newSteps.forEach((step, index) => {
    // A new step has no id yet; two of them would collide on `null`.
    if (step.id !== null) newPositionOfId.set(step.id, index)
  })

  const plan: StepSavePlan = { repoint: [], exit: [], unchanged: [] }

  for (const run of runs) {
    const oldId = idAtOldPosition.get(run.current_position)
    if (oldId === undefined) {
      plan.unchanged.push(run.id)
      continue
    }
    const newPosition = newPositionOfId.get(oldId)
    if (newPosition === undefined) {
      plan.exit.push({ runId: run.id, from: run.current_position })
    } else if (newPosition === run.current_position) {
      plan.unchanged.push(run.id)
    } else {
      plan.repoint.push({ runId: run.id, from: run.current_position, to: newPosition })
    }
  }

  return plan
}
```

- [ ] **Step 4: Run and watch it pass.**

- [ ] **Step 5: Mutate**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | key `newPositionOfId` on position instead of id | the moved-step test |
| M2 | drop the `step.id !== null` guard | the null-id test |
| M3 | `newPosition === undefined` → `newPosition === null` | the removed-step test |
| M4 | put an `oldId === undefined` run into `exit` instead of `unchanged` | the past-the-end test |
| M5 | drop the `newPosition === run.current_position` short-circuit | the nothing-moved test (a no-op re-point would be written) |

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/step-list.ts __tests__/lib/lead-engine/step-list.test.ts
git commit -m "feat(sequences): plan what an edit does to people partway through"
```

---

### Task 4: Migration 00256 — the off switch that stops the tick, and an atomic save

**Files:**
- Create: `supabase/migrations/00256_sequence_management.sql`
- Create: `__tests__/migrations/00256_sequence_management.test.ts`

**Re-check the number before you start.** `00255` is the newest applied to production. If `00256` already exists on disk, stop and report — numbers collide silently and git merges the collision clean.

**`__tests__/lib/lead-engine/seed-sequences.test.ts` reads `00218` via a HARDCODED path and will NOT cover this file.** Write the equivalent, modelled on `__tests__/migrations/00255_sequence_content_and_branching.test.ts`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00256_sequence_management.sql
-- Gap #11 of docs/full-engine-scope-vs-built.md.
-- Design: docs/superpowers/specs/2026-09-08-sequence-management-design.md
--
-- TWO CHANGES, both to functions. No column is added and no signature changes,
-- so this is safe in either deploy order against the Vercel build it races.
--
-- 1. claim_sequence_runs stops claiming runs whose sequence is switched off.
--
--    Until now, turning a sequence off stopped NEW people entering it and did
--    nothing whatsoever to the people already inside -- claim_sequence_runs
--    filtered on sequence_runs.status (the RUN's status) and never joined
--    sequences at all, and loadRunContext reads that row but selects only
--    trigger_source. So "paused" meant "paused for new arrivals". With a
--    switch about to appear in front of a coach, that is a switch that lies.
--
--    THE GATE MUST BE BEFORE THE CLAIM, NOT AFTER IT. The UPDATE below does
--    attempts = attempts + 1, and the runner destroys a run at MAX_ATTEMPTS.
--    Filtering after the claim would tick every held run's attempts up on every
--    pass and destroy all of them within minutes -- the 73-run incident again,
--    caused by the safety feature. Do not "simplify" this into the runner.
--
--    Resume needs no new state: a held run is simply not selected, next_run_at
--    stays where it was, and switching the sequence back on makes it claimable
--    on the very next tick at its existing current_position.
--
-- 2. save_sequence_steps replaces a sequence's whole step list atomically.
--
--    TypeScript decides, this writes. Validation and the re-point plan are
--    computed by lib/lead-engine/step-list.ts and passed in; the business rules
--    do not get a second home here where they can drift from the tick's copy.

CREATE OR REPLACE FUNCTION public.claim_sequence_runs(p_business_id uuid, p_limit integer, p_claim_token text)
 RETURNS SETOF public.sequence_runs
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.sequence_runs r
     SET claimed_at = now(),
         claimed_by = p_claim_token,
         attempts   = r.attempts + 1,
         updated_at = now()
   WHERE r.id IN (
     SELECT s.id
       FROM public.sequence_runs s
       JOIN public.sequences q
         ON q.id = s.sequence_id
        AND q.business_id = s.business_id
      WHERE s.business_id = p_business_id
        AND s.status      = 'active'
        AND q.status      = 'active'
        AND s.next_run_at <= now()
        AND (s.claimed_at IS NULL OR s.claimed_at < now() - interval '10 minutes')
      ORDER BY s.next_run_at
        -- OF s, not a bare FOR UPDATE. Once `sequences` is in the FROM, a bare
        -- FOR UPDATE locks a row in BOTH tables, so every tick would take a row
        -- lock on the sequence itself and the on/off switch would block behind
        -- the tick (and vice versa) for no reason. Only the run is being
        -- claimed, so only the run is locked. Do not shorten this.
        FOR UPDATE OF s SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING r.*;
END;
$function$;

-- p_steps: ordered JSON array; the ARRAY INDEX IS THE POSITION. Each element:
--   { id, kind, wait_minutes, subject, body, branch_condition,
--     on_true_position, on_false_position, config }
--   `id` null means a step that does not exist yet.
-- p_repoint: [{ "run_id": uuid, "to_position": int }]
-- p_exit_run_ids: runs whose step was removed.
CREATE OR REPLACE FUNCTION public.save_sequence_steps(
  p_business_id   uuid,
  p_sequence_id   uuid,
  p_steps         jsonb,
  p_repoint       jsonb,
  p_exit_run_ids  uuid[]
) RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_keep_ids  uuid[];
  v_sent      integer;
  v_owned     boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.sequences
     WHERE id = p_sequence_id AND business_id = p_business_id
  ) INTO v_owned;
  IF NOT v_owned THEN
    RAISE EXCEPTION 'sequence % does not belong to business %', p_sequence_id, p_business_id;
  END IF;

  SELECT coalesce(array_agg((e->>'id')::uuid), ARRAY[]::uuid[])
    INTO v_keep_ids
    FROM jsonb_array_elements(p_steps) AS e
   WHERE e->>'id' IS NOT NULL;

  -- Removing a step CASCADES sequence_messages away with it
  -- (sequence_messages_step_id_fkey), destroying the record of real messages
  -- sent to real people. Refuse. The route checks this too so the operator
  -- gets a sentence; this is the line that cannot be bypassed.
  SELECT count(*) INTO v_sent
    FROM public.sequence_messages m
    JOIN public.sequence_steps s ON s.id = m.step_id
   WHERE s.sequence_id = p_sequence_id
     AND NOT (s.id = ANY (v_keep_ids));
  IF v_sent > 0 THEN
    RAISE EXCEPTION 'refusing to remove a step that has already sent % message(s)', v_sent;
  END IF;

  DELETE FROM public.sequence_steps
   WHERE sequence_id = p_sequence_id
     AND business_id = p_business_id
     AND NOT (id = ANY (v_keep_ids));

  -- sequence_steps_position_uniq is a bare UNIQUE INDEX on
  -- (sequence_id, position) and is NOT deferrable, so renumbering in place
  -- collides mid-statement. Park every survivor on a negative position first;
  -- there is no position >= 0 CHECK, so this is legal, and nothing else can
  -- ever hold a negative.
  UPDATE public.sequence_steps
     SET position = -1 - position
   WHERE sequence_id = p_sequence_id
     AND business_id = p_business_id;

  -- New steps go straight to their final positions. Survivors are all negative
  -- at this moment, so nothing can collide.
  INSERT INTO public.sequence_steps
    (business_id, sequence_id, position, kind, wait_minutes, subject, body,
     branch_condition, on_true_position, on_false_position, config)
  SELECT p_business_id,
         p_sequence_id,
         (e.ord - 1)::int,
         e.value->>'kind',
         nullif(e.value->>'wait_minutes','')::int,
         e.value->>'subject',
         e.value->>'body',
         CASE WHEN e.value->'branch_condition' = 'null'::jsonb THEN NULL ELSE e.value->'branch_condition' END,
         nullif(e.value->>'on_true_position','')::int,
         nullif(e.value->>'on_false_position','')::int,
         coalesce(e.value->'config', '{}'::jsonb)
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS e(value, ord)
   WHERE e.value->>'id' IS NULL;

  -- Survivors move from their negative parking spot to the final position, and
  -- pick up every edited field on the way.
  UPDATE public.sequence_steps s
     SET position          = (e.ord - 1)::int,
         kind              = e.value->>'kind',
         wait_minutes      = nullif(e.value->>'wait_minutes','')::int,
         subject           = e.value->>'subject',
         body              = e.value->>'body',
         branch_condition  = CASE WHEN e.value->'branch_condition' = 'null'::jsonb THEN NULL ELSE e.value->'branch_condition' END,
         on_true_position  = nullif(e.value->>'on_true_position','')::int,
         on_false_position = nullif(e.value->>'on_false_position','')::int,
         config            = coalesce(e.value->'config', '{}'::jsonb),
         updated_at        = now()
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS e(value, ord)
   WHERE s.sequence_id = p_sequence_id
     AND s.business_id = p_business_id
     AND e.value->>'id' IS NOT NULL
     AND s.id = (e.value->>'id')::uuid;

  UPDATE public.sequence_runs r
     SET current_position = (e.value->>'to_position')::int,
         updated_at       = now()
    FROM jsonb_array_elements(p_repoint) AS e(value)
   WHERE r.id = (e.value->>'run_id')::uuid
     AND r.business_id = p_business_id
     AND r.sequence_id = p_sequence_id
     AND r.status = 'active';

  -- Exited, never completed. Reporting a stopped follow-up as one that reached
  -- the end is the exact lie this whole feature exists to prevent.
  UPDATE public.sequence_runs
     SET status = 'exited',
         exit_reason = 'sequence_edited',
         completed_at = now(),
         updated_at = now()
   WHERE id = ANY (p_exit_run_ids)
     AND business_id = p_business_id
     AND sequence_id = p_sequence_id
     AND status = 'active';
END;
$function$;
```

- [ ] **Step 2: Write the migration test**

`__tests__/migrations/00256_sequence_management.test.ts`, reading the file off disk. Scope every text assertion to the SQL, not to the header prose — the header discusses the very things it warns about, so a whole-file `includes()` matches the comment and passes for the wrong reason.

Assert at minimum:
- the file contains `JOIN public.sequences` and `q.status      = 'active'` inside `claim_sequence_runs`;
- `attempts   = r.attempts + 1` still appears (the gate must not have been implemented by removing the claim);
- `FOR UPDATE OF s SKIP LOCKED` is present;
- `save_sequence_steps` refuses a cross-tenant sequence (`RAISE EXCEPTION` with `business`);
- the `sequence_messages` guard exists and runs BEFORE the `DELETE` (compare `indexOf`);
- the negative parking `UPDATE` appears before both the `INSERT` and the survivor `UPDATE` (compare `indexOf`);
- `exit_reason = 'sequence_edited'` is written with `status = 'exited'`, and the file never sets `status = 'completed'`.

- [ ] **Step 3: Apply to DEV only and read it back**

Apply through the Supabase MCP against the **dev** project. Do NOT touch production. `scripts/migrations/apply.mjs` refuses on dev because `public.repo_migrations` does not exist there; that is correct and is not to be "fixed" by running `baseline.sql`.

Then prove it against dev, reading back from the database rather than trusting a green tick:
1. `pg_get_functiondef` both functions and confirm the new bodies are live.
2. Insert a throwaway sequence with three steps and an active run; call `save_sequence_steps` to reorder; read back positions and the run's `current_position`.
3. Repeat with a step removed and confirm the run is `exited` with `sequence_edited`.
4. Insert a `sequence_messages` row against a step, try to remove that step, confirm the `RAISE`.
5. Run the whole thing twice to prove idempotence.
6. **Delete every probe row and COUNT to confirm it is gone.** An empty MCP response is not proof of a delete — a chained-CTE cleanup has already returned `[]` while leaving three rows behind.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00256_sequence_management.sql __tests__/migrations/00256_sequence_management.test.ts
git commit -m "feat(sequences): 00256 gates the tick on the sequence being on, adds an atomic step save"
```

---
### Task 5: The data access layer

**Files:**
- Create: `lib/db/sequence-admin.ts`
- Test: `__tests__/lib/db/sequence-admin.test.ts`

**Interfaces produced:**
- `loadSequenceForEdit(businessId: string, key: string): Promise<SequenceForEdit | null>` where `SequenceForEdit = { id: string; key: string; name: string; status: string; steps: SavedStep[]; drafts: StepDraft[]; sentCountByStepId: Record<string, number>; activeRuns: RunPointer[] }`
- `setSequenceStatus(businessId: string, key: string, status: "active" | "paused"): Promise<{ id: string; from: string } | null>` — `null` when the key is not this tenant's.
- `saveSequenceSteps(businessId: string, sequenceId: string, steps: StepDraft[], plan: StepSavePlan): Promise<void>` — one `rpc("save_sequence_steps", …)` call.

**Every read and every write carries `.eq("business_id", businessId)`.** A reader with no tenant predicate is a leak with a fuse in it.

**Mocked DAL tests cannot verify a column name.** Every DAL test in this repo mocks `@/lib/supabase`, so fixtures and code can be wrong in the same direction, and the house-convention `as unknown as T[]` cast silences tsc. A previous task in this subsystem shipped `contacts(full_name, email)` against a table whose column is `name`; every page would have 500'd. So:

- The column names are in the spec's §9 appendix, read from production. Use those.
- **Assert the literal select STRING**, e.g. `expect(from().select).toHaveBeenCalledWith("id, position")`, so a mocked suite can still catch a renamed column.

- [ ] **Step 1:** Write failing tests covering: the tenant predicate is passed on every call; the literal select strings; `setSequenceStatus` returns `null` for another tenant's key; `saveSequenceSteps` passes the plan through to the RPC unchanged.
- [ ] **Step 2:** Run, watch fail.
- [ ] **Step 3:** Implement. Read active runs with `.eq("status", "active")`. Get per-step sent counts from `sequence_messages` grouped by `step_id`; use `fetchAllRows` from `lib/db/paginate.ts` for anything that could exceed ~1000 rows — PostgREST silently truncates there, and the failure is wrong numbers rather than an error.
- [ ] **Step 4:** Run, watch pass.
- [ ] **Step 5:** Mutate. At minimum: point a `.eq("business_id", …)` at a wrong value (an argument-blind mock tolerates a wrong VALUE — mutate the value, not the arity); drop `.eq("status","active")` from the runs read; change one select string.
- [ ] **Step 6:** Commit as `feat(sequences): data access for editing and switching a sequence`.

---

### Task 6: The two routes, their schemas, and their audit slugs

**Files:**
- Create: `lib/validators/sequence-admin.ts`, `app/api/admin/sequences/[key]/status/route.ts`, `app/api/admin/sequences/[key]/steps/route.ts`
- Modify: `lib/audit/actions.ts`
- Test: `__tests__/api/admin/sequences/status-route.test.ts`, `__tests__/api/admin/sequences/steps-route.test.ts`

Route suites need `--environment node` pinned or they report "no tests".

**Admin-only, not permission-tiered.** `app/api/admin/sequences/enrol/route.ts` states the precedent in its own header: enrolling somebody causes email to be sent to a real member of the public in the business's name, which is not a "leads"-shaped permission. Switching a sequence on is the same act for everybody who enters from now on. Copy that route's auth shape; do not invent a new one.

**Both routes wrap in `withAudit`.** Add to `lib/audit/actions.ts`:

| Slug | Category | Description |
|---|---|---|
| `sequence.status_changed` | `admin_write` | Admin switched a sequence on or off |
| `sequence.steps_edited` | `admin_write` | Admin changed a sequence's steps |

Metadata carries the sequence key and **counts only** — how many steps, how many people re-pointed, how many stopped. No contact ids, no email addresses, no phone numbers, matching the rule the enrol route states for its own row. A registered slug with no writer is the labelling gap `CLAUDE.md` forbids, so both are written in this task.

**`PATCH …/status`** body `{ on: boolean }` → writes `active` or `paused`. Never writes `draft` or `archived`.

**`PUT …/steps`** body `{ steps: StepDraft[] }`:
1. Load the sequence for this tenant; 404 if not found.
2. `validateStepList(steps)` — 400 with the problems if non-empty. **The route validates; it does not trust the browser.**
3. `planStepSave(old, new, activeRuns)`.
4. Refuse (409) if any step being removed has `sentCountByStepId[id] > 0`, with a sentence naming the count.
5. `saveSequenceSteps(...)`.
6. Respond with the plan so the screen can say what happened.

**Two guards can mask each other.** The step-removal refusal exists here AND in the plpgsql. Pin each with its own test that neutralises the other — a mutation that survives is a finding, not something to hide.

- [ ] **Step 1:** Failing tests: 401 for no session; 403 for a non-admin with `contacts`; 404 for another tenant's key; 400 listing validation problems; 409 naming the sent count; 200 writing the audit row with counts and no personal data; the `on: false` path writing `paused` and never `draft`.
- [ ] **Step 2:** Run with `--environment node`, watch fail.
- [ ] **Step 3:** Implement both routes and the Zod schemas.
- [ ] **Step 4:** Run, watch pass.
- [ ] **Step 5:** Mutate: remove the admin check; remove the tenant predicate; make `validateStepList`'s result ignored; loosen `> 0` to `> 1` on the sent-count guard; make the audit metadata include a contact id (must fail a test asserting it does not).
- [ ] **Step 6:** Commit as `feat(sequences): admin routes to switch a sequence and save its steps`.

---

### Task 7: The reporting screen learns the new ending, and its pause wording stops being wrong

**Files:**
- Modify: `lib/db/sequence-reporting.ts`, `components/admin/sequences/SequenceReportTable.tsx`, `app/(admin)/admin/sequences/[key]/page.tsx`
- Test: `__tests__/lib/db/sequence-reporting.test.ts` (existing)

Two things:

1. **`bucketForRun` learns `sequence_edited`** and buckets it as **`other`** — deliberately not `finished`. Reporting an edited-away follow-up as one that reached the end is the exact lie this feature exists to prevent. The detail page names it per person: **"Stopped because the sequence was edited"**.

2. **`whyEmpty` currently says "Paused, so nobody new is being added."** After `00256` that is wrong — off now stops everybody, not just new arrivals. Change it to **"Switched off, so nobody is being added and nobody is moving through it."** Grep for the CONCEPT, not this phrasing: a previous correction in this subsystem missed a second copy because the grep searched `"sequences screen"` and the survivor said `"sequence screen"`.

- [ ] **Step 1:** Failing tests: `bucketForRun("exited", "sequence_edited") === "other"`; a test asserting it is NOT `"finished"`; the label renders.
- [ ] **Step 2–4:** Run fail → implement → run pass.
- [ ] **Step 5:** Mutate: make `sequence_edited` bucket as `finished` (must fail); revert the copy change (must fail a test asserting the new wording).
- [ ] **Step 6:** Commit as `feat(sequences): report an edited-away run honestly, and fix the pause wording`.

---

### Task 8: The on/off switch

**Files:**
- Create: `components/admin/sequences/SequenceSwitch.tsx`
- Modify: `components/admin/sequences/SequenceReportTable.tsx`, `app/(admin)/admin/sequences/[key]/page.tsx`
- Test: `__tests__/components/admin/sequences/SequenceSwitch.test.tsx`

The switch appears on both the list and the detail screen. Turning one **on** confirms first, because it starts sending to real people. The dialog says, in plain words:

> **Switch on "New lead nurture"?**
> People who fill in a form will start getting these emails and texts straight away.
> Anyone who was partway through when you switched it off will pick up where they left off — which may mean a message goes out within a few minutes.
> Quiet hours and your one-message-a-day limit still apply.

Turning one **off** needs no confirmation — stopping is the safe direction.

The list column uses `components/ui/data-table.tsx`. `DataTableEmpty` renders its own `<tr>`; do not wrap it in `DataTableRow`. Admin UI is light-only — no `dark:` variants.

Keep the existing `STATUS_LABEL` values (`On` / `Paused` / `Not started`) rather than churning shipped copy, but make the switch's own state derive from `status === "active"`, so `draft` and `paused` both read as off.

- [ ] **Step 1:** Failing tests: renders on for `active` and off for `paused` and for `draft`; turning on opens the dialog and does not call the route until confirmed; turning off calls the route directly; a failed call surfaces a message and leaves the switch where it was.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5:** Mutate: make the switch call the route before confirmation (must fail); derive its state from `status !== "draft"` instead of `=== "active"` (must fail the paused test).
- [ ] **Step 6:** Commit as `feat(sequences): an on/off switch on the sequences screens`.

---

### Task 9: The step editor

**Files:**
- Create: `components/admin/sequences/StepEditor.tsx`
- Modify: `app/(admin)/admin/sequences/[key]/page.tsx`
- Test: `__tests__/components/admin/sequences/StepEditor.test.tsx`

Renders the list of steps, allows add / edit / reorder / remove, and calls `PUT …/steps`. **`validateStepList` runs in the browser too**, so problems appear as you type — but the route re-validates, because the browser is not trusted.

Step kinds are named for what they do, never for the stored value:

| Stored | On screen |
|---|---|
| `email` | Send an email |
| `sms` | Send a text |
| `wait` | Wait |
| `branch` | Split the path |
| `tag` | Add a label |
| `stage` | Move their card |
| `alert` | Tell the coach |
| `stop` | End here |

"Split the path" carries a sentence under it: **"Each side needs its own ending, or the same person gets both."** That is the one rule a coach can break without seeing it.

Only the four predicates `evaluateBranch` implements may be offered: has a phone number, has an account, has agreed to be contacted (email or text), came from a particular place. An unknown predicate fails a run rather than guessing an arm.

Before saving, if anybody is partway through, show what will happen to them: *"4 people are partway through. 3 will carry on where they are. 1 will be stopped, because the step they were on has been removed."* Derive it from `planStepSave` — do not recompute it in the component with a second copy of the rule.

A step that has already been sent cannot be removed; the remove control is disabled and says why: *"This step has already been sent to 12 people, so it cannot be removed. You can change what it says, or switch the whole sequence off."*

- [ ] **Step 1:** Failing tests: every kind renders its plain-language name; adding a `tag` step and saving sends `config: { tag: … }`; a validation problem blocks save and names the step; the disabled remove control shows the sent count; the partway-through summary matches `planStepSave`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5:** Mutate: let save proceed with a non-empty problem list; enable remove for a sent step; drop the tag config from the save body.
- [ ] **Step 6:** Commit as `feat(sequences): a step editor that can create every kind of step`.

---

### Task 10: Drive it in the real app, then close the ledger row

**Files:**
- Create: `scripts/capture-sequence-management-screenshots.mjs`, `screenshots/sequence-management/*`
- Modify: `docs/full-engine-scope-vs-built.md`, `CLAUDE.md`

`scripts/capture-sequence-content-screenshots.mjs` is a working reference that already solves auth, the tenant cookie and text-extent marker placement. Start from it.

- **The dev tenant default is NOT "Primary".** With no `djp_business` cookie, `resolveAdminTenant()` returns a seeded business holding no sequences, and an empty screen reads exactly like a broken tenant predicate. **Set the cookie first.**
- Drive the **real routes** at `localhost:3050` with a **real session** and **real data**. Never a harness, never a preview page.
- **Park the pointer** with `page.mouse.move(4, 4)` before every shot. Playwright's virtual mouse stays where it last clicked, and a hovered control photographs as a styling bug that is not there.
- Markers must measure the **text extent** (a DOM Range), not the element box — `getByText()` matches the `<td>` including its padding, which has already put a marker 22px into the sidebar twice.
- Annotations burned **into** the PNG. Do not wrap a clean screenshot in an HTML page that draws callouts around it.
- Do not pipe the dev server to `head` — it wedges and every route times out after appearing to work. Redirect to a log file.
- **Open the PNGs and look at them.** A clean helper run is not a correct result; that is how two code defects reached a shipped screenshot in this subsystem.

Shots: the list with the switch; the confirmation dialog; the editor with a `tag` step being added; a validation problem shown; the partway-through summary.

Then:
- [ ] Mark gap #11 **BUILT** in `docs/full-engine-scope-vs-built.md` §4, in the struck-through style rows #4, #5, #6, #7 and #12 already use.
- [ ] Add a short **Sequence management** section to `CLAUDE.md` recording the two facts a future reader will otherwise re-derive: the tick is gated on the sequence being on (and why the gate is inside the RPC), and removing a step cascades `sequence_messages` away.
- [ ] Commit as `docs(sequences): close gap #11 in the scope ledger`.

---

## Verification before the branch is called done

1. `npx vitest run __tests__/lib/lead-engine/ __tests__/lib/db/ __tests__/api/admin/sequences/ __tests__/migrations/00256_sequence_management.test.ts __tests__/components/admin/sequences/` — targeted only.
2. `npx tsc --noEmit` — diff the per-file error SET against `.claude/baselines/tsc-ce6f2aba-perfile.txt`. Not the count.
3. `npm run build` — exit 0, with both new routes in the manifest. This is the gate a new App Router route exists to trip.
4. `git log ce6f2aba..HEAD --format=%B | grep -ci "co-authored-by\|claude\|generated with"` prints `0`.
5. `git diff --stat` shows no deletions in files you did not create — a deletion in a pre-existing file is the tell that `prettier --write` reflowed somebody else's code.
