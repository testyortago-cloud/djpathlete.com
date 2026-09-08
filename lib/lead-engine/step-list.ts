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
import { parseTagConfig, parseStageConfig } from "@/lib/lead-engine/step-config"

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
