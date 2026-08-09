// lib/funnels/ai/plan.ts — what a chat turn is allowed to do to a page.
//
// The planner is a model, so it will name sections that do not exist, emit
// reorders that are not permutations, and occasionally read "make the headline
// bigger" as "rewrite the page". validatePlan catches all of that
// deterministically BEFORE any expensive Sonnet call runs, and is pure so the
// rules can be tested without a network.

import { z } from "zod"
import { MAX_SECTIONS } from "./types"

export const editOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("edit_section"),
    sectionId: z.string().max(40),
    instruction: z.string().max(600),
  }),
  z.object({
    op: z.literal("add_section"),
    /** null = insert as the FIRST section. Otherwise insert immediately after. */
    afterSectionId: z.string().max(40).nullable(),
    kind: z.string().max(40),
    brief: z.string().max(600),
  }),
  z.object({ op: z.literal("delete_section"), sectionId: z.string().max(40) }),
  z.object({ op: z.literal("reorder"), order: z.array(z.string().max(40)).max(MAX_SECTIONS) }),
  z.object({ op: z.literal("edit_theme"), instruction: z.string().max(600) }),
  z.object({ op: z.literal("regenerate_page"), brief: z.string().max(1200) }),
])

export type EditOp = z.infer<typeof editOpSchema>

export const planSchema = z.object({
  /** What the assistant says in the chat. Never contains HTML. */
  reply: z.string().max(400),
  ops: z.array(editOpSchema).max(6),
  /** Set when the request is too ambiguous to act on. Mutually exclusive with ops. */
  clarification: z.string().max(300).nullable(),
})

export type PlanOutput = z.infer<typeof planSchema>

/** An op ready for applyOps. add_section carries the id the executor minted. */
export type ResolvedOp =
  | Extract<EditOp, { op: "edit_section" }>
  | (Extract<EditOp, { op: "add_section" }> & { newSectionId: string })
  | Extract<EditOp, { op: "delete_section" }>
  | Extract<EditOp, { op: "reorder" }>
  | Extract<EditOp, { op: "edit_theme" }>
  | Extract<EditOp, { op: "regenerate_page" }>

export interface ValidatedPlan {
  reply: string
  ops: EditOp[]
  clarification: string | null
  /** Human-readable reasons ops were dropped. Shown in the chat, not hidden. */
  notes: string[]
}

/**
 * Filters a raw plan down to ops that can actually be executed against the
 * current page.
 *
 * Dropping rather than erroring is deliberate: a plan with one bad op and two
 * good ones should still do the two good things and say so.
 */
export function validatePlan(plan: PlanOutput, sectionIds: string[]): ValidatedPlan {
  const notes: string[] = []
  const known = new Set(sectionIds)

  // A clarification means the planner is asking, not acting. Anything it also
  // emitted is discarded so the page cannot change behind a question.
  if (plan.clarification && plan.clarification.trim().length > 0) {
    if (plan.ops.length > 0) notes.push("Ignored proposed changes because a question was asked first.")
    return { reply: plan.reply, ops: [], clarification: plan.clarification, notes }
  }

  // regenerate_page rewrites everything, so it can never be mixed with
  // targeted ops — the targeted ops would be applied to a page that no longer
  // has those sections.
  const regenerate = plan.ops.find((op) => op.op === "regenerate_page")
  if (regenerate) {
    if (plan.ops.length > 1) notes.push("Kept only the full-page regenerate; other changes were dropped.")
    return { reply: plan.reply, ops: [regenerate], clarification: null, notes }
  }

  const deleted = new Set(
    plan.ops
      .filter((op) => op.op === "delete_section" && known.has(op.sectionId))
      .map((op) => (op as Extract<EditOp, { op: "delete_section" }>).sectionId),
  )
  const hasStructural = plan.ops.some((op) => op.op === "add_section" || op.op === "delete_section")

  let budget = MAX_SECTIONS - sectionIds.length + deleted.size
  const kept: EditOp[] = []

  for (const op of plan.ops) {
    switch (op.op) {
      case "edit_section": {
        if (!known.has(op.sectionId)) {
          notes.push(`Could not find a section called ${op.sectionId}.`)
          continue
        }
        // Editing something the same turn deletes is wasted work and an
        // expensive model call for output nobody will ever see.
        if (deleted.has(op.sectionId)) {
          notes.push(`Skipped editing ${op.sectionId} because the same turn deletes it.`)
          continue
        }
        kept.push(op)
        continue
      }
      case "delete_section": {
        if (!known.has(op.sectionId)) {
          notes.push(`Could not find a section called ${op.sectionId}.`)
          continue
        }
        kept.push(op)
        continue
      }
      case "add_section": {
        if (op.afterSectionId !== null && !known.has(op.afterSectionId)) {
          notes.push(`Could not find a section called ${op.afterSectionId}.`)
          continue
        }
        if (budget <= 0) {
          notes.push(`A page can hold at most ${MAX_SECTIONS} sections.`)
          continue
        }
        budget -= 1
        kept.push(op)
        continue
      }
      case "reorder": {
        // The planner cannot know the ids of sections this same turn creates,
        // so a reorder alongside add/delete would be computed against a stale
        // list. Reordering is cheap to redo, so it is the one that gives way.
        if (hasStructural) {
          notes.push("Skipped the reorder because sections were added or removed in the same step.")
          continue
        }
        if (!isPermutation(op.order, sectionIds)) {
          notes.push("Skipped the reorder because it did not list every section exactly once.")
          continue
        }
        kept.push(op)
        continue
      }
      case "edit_theme": {
        kept.push(op)
        continue
      }
    }
  }

  if (kept.length === 0 && plan.ops.length > 0) {
    return {
      reply: plan.reply,
      ops: [],
      clarification:
        "I could not match that to anything on the page. Which section did you mean?",
      notes,
    }
  }

  return { reply: plan.reply, ops: kept, clarification: null, notes }
}

function isPermutation(candidate: string[], target: string[]): boolean {
  if (candidate.length !== target.length) return false
  const remaining = new Set(target)
  for (const id of candidate) {
    if (!remaining.delete(id)) return false
  }
  return remaining.size === 0
}
