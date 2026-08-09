// lib/funnels/ai/apply.ts — the anti-drift guarantee, as a pure function.
//
// "Make the headline bigger" silently rewriting the testimonials is the number
// one complaint about prompt builders. The defence here is structural, not a
// prompt instruction: sections no op names are COPIED BY REFERENCE from the
// previous draft. They are never sent to a model, never returned by a model,
// and never reconstructed.
//
// DO NOT ADD A MODEL CALL TO THIS FILE. The generator runs outside and injects
// its output through `results`; that separation is what makes the guarantee
// testable, and __tests__/lib/funnels/ai/apply.test.ts fails loudly if a future
// change lets a section edit produce a whole page.

import type { FunnelSection, PageDraft } from "./types"
import type { ResolvedOp } from "./plan"

export interface OpResults {
  /** Keyed by the section id each op targets (or mints, for add_section). */
  sections: Map<string, FunnelSection>
  /** Only for edit_theme. */
  pageCss?: string
  /** Only for regenerate_page. */
  replacement?: PageDraft
}

/**
 * Applies validated ops to a draft and returns a NEW draft. The input is never
 * mutated.
 *
 * Throws — loudly, not silently — when `results` and `ops` disagree. A missing
 * result means the executor dropped work; an extra result means something
 * produced a section nobody asked for, which is the drift this file prevents.
 */
export function applyOps(draft: PageDraft, ops: ResolvedOp[], results: OpResults): PageDraft {
  const regenerate = ops.find((op) => op.op === "regenerate_page")

  if (results.replacement !== undefined && !regenerate) {
    throw new Error("applyOps: a replacement draft was supplied without a regenerate_page op")
  }
  if (regenerate) {
    if (ops.length > 1) {
      throw new Error("applyOps: regenerate_page cannot be combined with other ops")
    }
    if (!results.replacement) {
      throw new Error("applyOps: regenerate_page requires a replacement draft")
    }
    return results.replacement
  }

  const themeOp = ops.find((op) => op.op === "edit_theme")
  if (themeOp && results.pageCss === undefined) {
    throw new Error("applyOps: edit_theme requires a pageCss result")
  }
  if (!themeOp && results.pageCss !== undefined) {
    throw new Error("applyOps: pageCss was supplied without an edit_theme op")
  }

  // Reconcile the result set against what the ops actually asked for. Both
  // directions matter: a missing key is lost work, an extra key is drift.
  const expected = new Set<string>()
  for (const op of ops) {
    if (op.op === "edit_section") expected.add(op.sectionId)
    if (op.op === "add_section") expected.add(op.newSectionId)
  }
  for (const id of expected) {
    if (!results.sections.has(id)) {
      throw new Error(`applyOps: no generated section for "${id}"`)
    }
  }
  for (const id of results.sections.keys()) {
    if (!expected.has(id)) {
      throw new Error(`applyOps: generated section "${id}" was not the target of any op`)
    }
  }

  // Fixed phase order so the outcome never depends on the order the planner
  // happened to emit ops in: edits, then deletes, then inserts, then reorder.
  let sections = draft.sections.map((existing) => {
    const replacement = ops.some((op) => op.op === "edit_section" && op.sectionId === existing.id)
      ? results.sections.get(existing.id)
      : undefined
    // Untouched sections are the SAME OBJECT, not a copy. This is the guarantee.
    return replacement ?? existing
  })

  const removed = new Set(ops.filter((op) => op.op === "delete_section").map((op) => op.sectionId))
  if (removed.size > 0) sections = sections.filter((s) => !removed.has(s.id))

  for (const op of ops) {
    if (op.op !== "add_section") continue
    const fresh = results.sections.get(op.newSectionId)
    if (!fresh) continue
    if (op.afterSectionId === null) {
      sections = [fresh, ...sections]
      continue
    }
    const at = sections.findIndex((s) => s.id === op.afterSectionId)
    if (at === -1) sections = [...sections, fresh]
    else sections = [...sections.slice(0, at + 1), fresh, ...sections.slice(at + 1)]
  }

  const reorder = ops.find((op) => op.op === "reorder")
  if (reorder) {
    const byId = new Map(sections.map((s) => [s.id, s]))
    const ordered = reorder.order.map((id) => byId.get(id)).filter((s): s is FunnelSection => Boolean(s))
    // Anything the order list omitted is appended rather than lost. validatePlan
    // already rejects non-permutations, so this is belt and braces.
    for (const s of sections) if (!reorder.order.includes(s.id)) ordered.push(s)
    sections = ordered
  }

  return { sections, pageCss: results.pageCss ?? draft.pageCss }
}
