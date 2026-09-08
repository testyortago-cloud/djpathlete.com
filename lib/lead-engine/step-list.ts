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
