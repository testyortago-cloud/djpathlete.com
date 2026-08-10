// lib/funnels/sections/apply.ts — ops -> doc, transactional.
//
// THE LOAD-BEARING GUARANTEE OF THE WHOLE FEATURE: the server holds the
// document, the model proposes ops, the server applies them. "Make the
// headline bigger" silently rewriting the testimonials is the #1 failure of
// tools in this category. This file is what makes that STRUCTURALLY
// impossible, not merely unlikely:
//
//   - Sections the model did not name are never rebuilt. They are the SAME
//     OBJECTS in the output (`===`), not clones, on every op path — update,
//     add, remove, move, set_theme. Nothing here ever does "clone every
//     section, then patch the one that changed."
//   - Every op is validated against the registry (SECTION_REGISTRY / the
//     schemas it owns) before anything is committed. If ANY op in the batch
//     is invalid — including one naming a section id that does not exist —
//     the WHOLE BATCH is rejected. A half-applied patch is impossible: this
//     function either returns the one new doc, or returns errors and the
//     caller keeps using whatever `doc` it already had.
//
// Source of truth: docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md
// §4 "Response schema" (lines 332-355, the six ops — `opSchema` here is that
// grammar, built from this repo's actual registry exports rather than
// restated) and §5 "The iteration mechanism" (lines 379-434, especially "The
// turn, step by step" step 4, "Why unrelated parts cannot drift", and "The
// diff receipt").
//
// NAMING NOTE: the plan's pseudocode calls the section-content schema used by
// `set_page`/`add_section` `sectionInputSchema`. Stage 1.1 already built and
// exported exactly that shape — the cross-kind, per-kind-validated
// discriminated union — as `sectionSchema` in registry.ts. Reused verbatim
// below, not restated under a second name.
//
// ---------------------------------------------------------------------------
// TWO DESIGN DECISIONS CARRIED FROM AN EARLIER ATTEMPT AT THIS EXACT FUNCTION
// (both cost multiple review rounds there; the ledger at
// .superpowers/sdd/2026-08-10-ai-page-builder-sections/progress.md carries
// them forward verbatim — see "CARRY FORWARD from the reverted attempt"):
// ---------------------------------------------------------------------------
//
// 1. REFERENCE IDENTITY IS A PROPERTY OF EVERY OP PATH, NOT JUST UPDATE.
//    A mutant that clones every section on every op and only happens to
//    produce the right VALUES would still be wrong — it breaks the
//    guarantee this file exists to make. So every op below is implemented as
//    copy-on-write over the working `sections` array: the array reference
//    itself, and every element in it, is reused untouched (`===` to the
//    section that was already in `doc.sections`) unless an op specifically
//    targets that id. A `set_theme`-only batch doesn't even allocate a new
//    `sections` array — `sections` stays literally `doc.sections`.
//
// 2. OPS APPLY SEQUENTIALLY, IN ARRAY ORDER, EACH BUILDING ON THE RESULT OF
//    THE PREVIOUS ONE — NOT ALL VALIDATED INDEPENDENTLY AGAINST THE ORIGINAL
//    DOC. This is the semantics for "an `add_section` whose `after` names a
//    section that a `remove_section` in the same batch deletes":
//
//      [remove_section("cta1"), add_section({ after: "cta1", ... })]
//        -> REJECTED. By the time the add_section is evaluated, "cta1" no
//           longer exists in the working state — same error as naming any
//           other nonexistent id. The whole batch fails; the doc the caller
//           already has is untouched.
//
//      [add_section({ after: "cta1", ... }), remove_section("cta1")]
//        -> SUCCEEDS. "cta1" still exists when the add runs, so the new
//           section is inserted right after it; the later remove then
//           deletes "cta1", leaving the new section sitting where "cta1"
//           used to be. Net effect reads exactly like "replace this section."
//
//    Order within the batch is therefore semantically meaningful, and that
//    is deliberate: it is the only reading that gives a well-defined answer
//    without inventing an "ops are unordered" resolution rule the plan never
//    specifies. Concretely, this is implemented as one pass over `ops` that
//    threads an evolving `sections` value through each iteration — there is
//    no separate "resolve all ids against the original doc" pre-pass, which
//    is exactly the shape of implementation that would treat the two
//    batches above identically and get the first one wrong.
//
// No model call, no DB, no network — pure function in, pure result out.
// ---------------------------------------------------------------------------

import { z } from "zod"
import {
  sectionSchema,
  sectionStyleSchema,
  sectionDocThemeSchema,
  sectionDocSchema,
  SECTION_REGISTRY,
  parseSection,
  type SectionDoc,
  type Section,
  type SectionKind,
  type SectionStyleKnobs,
  type SectionDocTheme,
} from "@/lib/funnels/sections/registry"

// ---------------------------------------------------------------------------
// Op schema — the six ops from plan §4, lines 342-352, copied structurally.
// A reference id (`id`, `after`) is deliberately just `z.string().min(1)`,
// not the stricter `sectionIdSchema` new ids are constrained to: a
// malformed reference and a well-formed-but-nonexistent one fail for the
// exact same reason ("no section with that id in the working doc") and
// produce the same error, so there is nothing extra to gain by giving one of
// them a second, stricter shape check.
// ---------------------------------------------------------------------------

const sectionIdRefSchema = z.string().min(1)
const propsPatchSchema = z.record(z.string(), z.unknown())

// `after` is NULLABLE on both `add_section` and `move_section`: `null` means
// "the very top of the page" (Fix round 1, CRITICAL 1). The plan's own
// grammar only gave `after` as a required string, with no way to express
// "before everything" — so "put an announcement bar above the hero" or "lead
// with the pricing" had no op and had to fall back to `set_page`, a full
// rewrite of every section. That is exactly the drift §5 exists to make
// structurally impossible, so it's closed here rather than deferred to
// whichever stage writes the prompt around it.
const afterAnchorSchema = sectionIdRefSchema.nullable()

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_page"), sections: z.array(sectionSchema).min(1).max(24) }),
  z.object({ op: z.literal("add_section"), after: afterAnchorSchema, section: sectionSchema }),
  z.object({
    op: z.literal("update_section"),
    id: sectionIdRefSchema,
    props: propsPatchSchema.optional(),
    style: sectionStyleSchema.partial().optional(),
    variant: z.string().optional(),
  }),
  z.object({ op: z.literal("move_section"), id: sectionIdRefSchema, after: afterAnchorSchema }),
  z.object({ op: z.literal("remove_section"), id: sectionIdRefSchema }),
  z.object({ op: z.literal("set_theme"), theme: sectionDocThemeSchema.partial() }),
])

export type SectionOp = z.infer<typeof opSchema>

// ---------------------------------------------------------------------------
// The diff receipt (plan §5 "The diff receipt", lines 402-404): which
// sections changed and why, and how many were untouched. `>60%` of the
// sections this batch touched-or-left-alone flags the turn as a rewrite so
// the UI can label it, rather than presenting it as a small edit.
// ---------------------------------------------------------------------------

export const SECTION_REWRITE_THRESHOLD = 0.6

export type SectionChangeAction = "added" | "removed" | "updated" | "moved" | "replaced"

export interface SectionChangeEntry {
  id: string
  kind: SectionKind
  label: string
  action: SectionChangeAction
  /** Human-readable reasons, e.g. "headline size", "content: headline". */
  reasons: string[]
}

export interface DiffReceipt {
  /** One entry per structurally-effective op, in the order it ran. The same
   *  id can appear more than once (e.g. updated, then moved, in one batch). */
  changed: SectionChangeEntry[]
  /** Sections in the resulting doc that were never targeted by any op. */
  unchangedCount: number
  /** `sections.length` of the resulting doc. */
  totalSections: number
  themeChanged: boolean
  /** True when more than `SECTION_REWRITE_THRESHOLD` of the sections this
   *  batch could have touched-or-left-alone were actually touched. */
  isRewrite: boolean
}

export type ApplyOpsResult = { ok: true; doc: SectionDoc; receipt: DiffReceipt } | { ok: false; errors: string[] }

// Friendly labels for which style knob changed — matches the plan's own
// illustrative receipt text ("Hero (headline size)").
const STYLE_CHANGE_LABEL: Record<keyof SectionStyleKnobs, string> = {
  headline: "headline size",
  align: "alignment",
  tone: "tone",
  pad: "padding",
}

function zodIssuesToStrings(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".")
    return path ? `${path}: ${issue.message}` : issue.message
  })
}

/**
 * Shallow-merges a props patch over the current props, treating an explicit
 * `null` in the patch as "delete this key" rather than "set it to null" —
 * the only way to express removing an optional field over a wire format
 * (JSON) with no `undefined`. See the CRITICAL 2 comment at the call site.
 */
function applyPropsPatch(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  return next
}

function findDuplicateSectionId(sections: Section[]): string | null {
  const seen = new Set<string>()
  for (const s of sections) {
    if (seen.has(s.id)) return s.id
    seen.add(s.id)
  }
  return null
}

// ---------------------------------------------------------------------------
// applyOps
// ---------------------------------------------------------------------------

/**
 * Applies a batch of ops to `doc` and returns exactly one new `SectionDoc`,
 * or a list of errors. Never mutates `doc` — on failure the caller's
 * existing doc is still the correct, complete state; on success the
 * returned `doc` is a NEW object, but every section the batch didn't touch
 * is the SAME object (`===`) that was in `doc.sections`.
 *
 * `doc` is expected to already be a valid `SectionDoc` (the draft loaded
 * from `funnel_steps.project_data`), but is re-checked against
 * `sectionDocSchema` up front anyway — cheap, and turns a corrupted stored
 * document into a clear failure instead of a confusing crash three ops in.
 *
 * `rawOps` is deliberately `unknown` rather than `SectionOp[]`: this
 * function is the one place ops get validated, so it must be safe to call
 * with whatever a model (or, on the inspector path, a hand-built request
 * body with no AI involved at all) actually sent.
 */
export function applyOps(doc: SectionDoc, rawOps: unknown): ApplyOpsResult {
  const docCheck = sectionDocSchema.safeParse(doc)
  if (!docCheck.success) {
    // Each issue is folded INTO its own string (not a bare label as a
    // separate array element) — the label-as-its-own-element form left a
    // trailing space and rendered as an empty first bullet wherever
    // `errors` is displayed one-per-line (Fix round 1, minor).
    return { ok: false, errors: zodIssuesToStrings(docCheck.error).map((issue) => `Invalid input document: ${issue}`) }
  }
  if (!Array.isArray(rawOps)) {
    return { ok: false, errors: ["ops must be an array."] }
  }
  if (rawOps.length === 0) {
    // A no-op batch is not an error — e.g. a purely conversational reply
    // with nothing to change. `doc` is returned BY REFERENCE, unmodified:
    // the strongest possible form of "sections it didn't name are never
    // rebuilt" is not rebuilding anything at all.
    return {
      ok: true,
      doc,
      receipt: {
        changed: [],
        unchangedCount: doc.sections.length,
        totalSections: doc.sections.length,
        themeChanged: false,
        isRewrite: false,
      },
    }
  }

  // ---------------------------------------------------------------------
  // Phase 1 — structural validation against the registry-derived op schema.
  // Every op is checked before anything is applied; all issues are
  // collected (not just the first) so a rejected batch tells the caller
  // everything wrong with it in one round trip.
  // ---------------------------------------------------------------------
  const ops: SectionOp[] = []
  const structuralErrors: string[] = []
  rawOps.forEach((raw, index) => {
    const parsed = opSchema.safeParse(raw)
    if (parsed.success) {
      ops.push(parsed.data)
    } else {
      for (const issue of zodIssuesToStrings(parsed.error)) {
        structuralErrors.push(`ops[${index}].${issue}`)
      }
    }
  })
  if (structuralErrors.length > 0) {
    return { ok: false, errors: structuralErrors }
  }

  // `sectionDocSchema` validates each section independently, so it can't
  // notice two of them sharing an id. Checked here, on the INPUT doc —
  // but ONLY when the batch actually contains an ID-ADDRESSED op
  // (update_section / move_section / remove_section) — Fix round 2. Those
  // three are the ones that resolve a bare `id` against `doc.sections` and
  // would silently misbehave (which of the two matching sections did the
  // caller mean?) against an ambiguous document. `set_page` and `set_theme`
  // address no ids at all, so the ambiguity never reaches them — and
  // `set_page` in particular is the ONLY way to REPAIR a document that
  // somehow already has duplicate ids (it wholesale-replaces `sections`).
  // Blocking it here as fix round 1 did closed that repair path entirely:
  // a corrupted doc could never be fixed by any chat instruction again. The
  // OUTPUT duplicate check further down is unconditional and still catches
  // anything a `set_page` (or any other op) actually produces.
  const hasIdAddressedOp = ops.some(
    (op) => op.op === "update_section" || op.op === "move_section" || op.op === "remove_section",
  )
  if (hasIdAddressedOp) {
    const inputDuplicateId = findDuplicateSectionId(doc.sections)
    if (inputDuplicateId) {
      return { ok: false, errors: [`Invalid input document: duplicate section id "${inputDuplicateId}".`] }
    }
  }

  // ---------------------------------------------------------------------
  // Phase 2 — sequential application over local scratch state. `sections`
  // starts as the SAME array reference as `doc.sections` (copy-on-write:
  // only replaced the first time an op actually touches a section), so a
  // batch that never mutates sections (e.g. `set_theme` alone) leaves
  // `sections === doc.sections` all the way through.
  // ---------------------------------------------------------------------
  let sections: Section[] = doc.sections
  let theme: SectionDocTheme = doc.theme
  let themeChanged = false
  let changed: SectionChangeEntry[] = []
  let touchedIds = new Set<string>()
  const errors: string[] = []

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]

    if (op.op === "set_page") {
      // Full-page replace. Whatever was tracked as "touched"/"changed" so
      // far in this batch no longer describes the current page, so it's
      // reset rather than appended to — every resulting section is
      // reported as "replaced", which is what actually happened to it.
      const newSections = op.sections as unknown as Section[]
      sections = newSections
      touchedIds = new Set(newSections.map((s) => s.id))
      changed = newSections.map((s) => ({
        id: s.id,
        kind: s.kind,
        label: SECTION_REGISTRY[s.kind].label,
        action: "replaced" as const,
        reasons: ["page replaced"],
      }))
      continue
    }

    if (op.op === "add_section") {
      // `after: null` means "insert at the very top" — no anchor to look
      // up. Otherwise the anchor must exist in the CURRENT working state
      // (see the module header: ops apply sequentially, so an anchor
      // removed earlier in this same batch is indistinguishable from one
      // that never existed).
      let insertAt: number
      if (op.after === null) {
        insertAt = 0
      } else {
        const anchorIdx = sections.findIndex((s) => s.id === op.after)
        if (anchorIdx === -1) {
          errors.push(
            `ops[${i}] add_section: no section with id "${op.after}" (it may never have existed, or may have ` +
              `been removed earlier in this same batch — ops apply in order).`,
          )
          break
        }
        insertAt = anchorIdx + 1
      }
      const newSection = op.section as unknown as Section
      if (sections.some((s) => s.id === newSection.id)) {
        errors.push(`ops[${i}] add_section: a section with id "${newSection.id}" already exists.`)
        break
      }
      const next = sections.slice()
      next.splice(insertAt, 0, newSection)
      sections = next
      touchedIds.add(newSection.id)
      changed.push({
        id: newSection.id,
        kind: newSection.kind,
        label: SECTION_REGISTRY[newSection.kind].label,
        action: "added",
        reasons: [op.after === null ? "added at the top" : `added after "${op.after}"`],
      })
      continue
    }

    if (op.op === "update_section") {
      // A patch with none of props/style/variant set is meaningless, but
      // was previously VALID: it re-ran the section through Zod for
      // nothing, produced a needlessly-cloned object, marked the section
      // "touched", and emitted a receipt entry with no reasons — rendering
      // in chat as "Hero ()". Rejected outright instead (Fix round 1,
      // IMPORTANT 5): a model that emits this has a real bug worth
      // surfacing, not something to paper over as a silent no-op.
      if (op.props === undefined && op.style === undefined && op.variant === undefined) {
        errors.push(`ops[${i}] update_section "${op.id}": at least one of props, style, or variant must be provided.`)
        break
      }
      const idx = sections.findIndex((s) => s.id === op.id)
      if (idx === -1) {
        errors.push(`ops[${i}] update_section: no section with id "${op.id}".`)
        break
      }
      const current = sections[idx]
      // The only subtlety (plan §4, line 355): a SHALLOW merge per
      // top-level key. `{...current.props, ...op.props}` replaces
      // `items`/`plans`/`features` WHOLESALE because they are each a
      // single top-level key's value, never descended into — a deep merge
      // would instead splice the incoming array element-by-element over
      // the old one, producing a Frankenstein array. No special-casing for
      // array-valued keys is needed; a plain shallow spread already has
      // exactly this behavior for every key, array-valued or not.
      //
      // A shallow spread can ADD and REPLACE a key, but never REMOVE one —
      // and `undefined` isn't expressible over JSON, so a model that wants
      // to drop an optional field (e.g. "remove the second button") has no
      // way to say so without this: `null` is an explicit delete sentinel,
      // stripped out before merging (Fix round 1, CRITICAL 2). Nulling a
      // REQUIRED field still fails below, at the post-merge `parseSection`
      // check — deleting `hero.headline` produces a candidate missing a
      // required key, which is exactly what that check exists to catch.
      const mergedProps = op.props ? applyPropsPatch(current.props, op.props) : current.props
      const mergedStyle = op.style ? { ...current.style, ...op.style } : current.style
      const mergedVariant = op.variant ?? current.variant
      const candidate = {
        id: current.id,
        kind: current.kind,
        variant: mergedVariant,
        style: mergedStyle,
        props: mergedProps,
      }

      // Validate the POST-MERGE section against its kind's schema — not
      // just the incoming patch — via the registry's own parse helper. A
      // partial props update can produce an invalid whole (e.g. patching a
      // pricing plan's `features` to `[]` violates that field's own
      // `min(1)`, even though the patch object itself has no bound to
      // violate).
      const parsed = parseSection(current.kind, candidate)
      if (!parsed.ok) {
        for (const issue of parsed.errors) errors.push(`ops[${i}] update_section "${op.id}": ${issue}`)
        break
      }

      const next = sections.slice()
      next[idx] = parsed.section
      sections = next
      touchedIds.add(op.id)

      const reasons: string[] = []
      if (op.variant !== undefined) reasons.push("variant")
      if (op.style) {
        for (const key of Object.keys(op.style) as (keyof SectionStyleKnobs)[]) {
          reasons.push(STYLE_CHANGE_LABEL[key])
        }
      }
      if (op.props) {
        for (const [key, value] of Object.entries(op.props)) {
          reasons.push(value === null ? `content: ${key} removed` : `content: ${key}`)
        }
      }
      changed.push({
        id: op.id,
        kind: current.kind,
        label: SECTION_REGISTRY[current.kind].label,
        action: "updated",
        reasons,
      })
      continue
    }

    if (op.op === "move_section") {
      // `op.id === op.after` is always false when `op.after` is `null`
      // (a string is never `===` null), so this guard still holds as-is.
      if (op.id === op.after) {
        errors.push(`ops[${i}] move_section: cannot move "${op.id}" after itself.`)
        break
      }
      const fromIdx = sections.findIndex((s) => s.id === op.id)
      if (fromIdx === -1) {
        errors.push(`ops[${i}] move_section: no section with id "${op.id}".`)
        break
      }
      // `after: null` means "move to the very top" — no anchor to resolve.
      if (op.after !== null && !sections.some((s) => s.id === op.after)) {
        errors.push(`ops[${i}] move_section: no section with id "${op.after}" to move after.`)
        break
      }
      const next = sections.slice()
      const [moved] = next.splice(fromIdx, 1)
      // Re-find the anchor's index AFTER removing `moved` (its index may
      // have shifted by one) rather than doing index arithmetic — simpler
      // to get right, and `moved` itself is never cloned, only relocated:
      // it is the exact same object throughout.
      const insertAt = op.after === null ? 0 : next.findIndex((s) => s.id === op.after) + 1
      next.splice(insertAt, 0, moved)
      sections = next
      touchedIds.add(op.id)
      changed.push({
        id: op.id,
        kind: moved.kind,
        label: SECTION_REGISTRY[moved.kind].label,
        action: "moved",
        reasons: [op.after === null ? "moved to the top" : `moved after "${op.after}"`],
      })
      continue
    }

    if (op.op === "remove_section") {
      const idx = sections.findIndex((s) => s.id === op.id)
      if (idx === -1) {
        errors.push(`ops[${i}] remove_section: no section with id "${op.id}".`)
        break
      }
      const removed = sections[idx]
      // `.filter` (not splice-on-a-copy) — reads the same either way, but
      // makes it visually obvious every surviving element is untouched.
      sections = sections.filter((s) => s.id !== op.id)
      touchedIds.add(op.id)
      changed.push({
        id: op.id,
        kind: removed.kind,
        label: SECTION_REGISTRY[removed.kind].label,
        action: "removed",
        reasons: [],
      })
      continue
    }

    if (op.op === "set_theme") {
      // Partial merge over the existing theme (plan §4, line 351/355):
      // `{...theme, ...op.theme}`. `sections` is left as whatever it
      // already was — untouched by this op, so if nothing else in the
      // batch touched it, it is still the literal `doc.sections` array.
      //
      // An EMPTY theme patch (`{op:"set_theme", theme:{}}`) is a valid op
      // shape but genuinely changes nothing, so `themeChanged` is only set
      // when the patch actually names at least one key — otherwise the
      // receipt would claim a theme change that didn't happen (Fix round 1,
      // minor).
      if (Object.keys(op.theme).length > 0) {
        theme = { ...theme, ...op.theme }
        themeChanged = true
      }
      continue
    }

    // Exhaustiveness check: if a 7th op literal is ever added to opSchema
    // without a branch above, this is a compile error, not a silent no-op.
    const _exhaustive: never = op
    errors.push(`ops[${i}]: unknown op ${JSON.stringify(_exhaustive)}`)
  }

  if (errors.length > 0) {
    // Transactional: the whole batch is rejected. `doc` was never mutated
    // (every step above built new local values), so the caller's existing
    // document is still exactly what it was before this call.
    return { ok: false, errors }
  }

  const candidateDoc: SectionDoc = { v: doc.v, engine: doc.engine, theme, sections }

  // Final whole-doc check — ask the validator, don't restate the 1..24
  // bound. No single op above checks the array's overall length (an
  // add_section that pushes past 24, or a remove_section that drops to 0,
  // both look fine in isolation), so this is the one place that catches it.
  // Every individual section already passed its own kind's schema via
  // parseSection/sectionSchema above, so the only thing this check can
  // still newly reject is the section COUNT.
  //
  // *** `finalCheck.data` IS DELIBERATELY DISCARDED. THIS IS THE SINGLE ***
  // *** MOST DANGEROUS LINE IN THIS FILE TO "CLEAN UP".                 ***
  // `candidateDoc` — built above from the local `sections`/`theme` this
  // function assembled via copy-on-write — is what gets returned, NOT
  // `finalCheck.data`. Zod's `safeParse` reconstructs its ENTIRE output
  // tree on every call, including every section this batch never touched.
  // Returning `finalCheck.data` instead would silently swap every untouched
  // section for a structurally-equal-but-different object, destroying the
  // one guarantee this whole file exists to make — and every test would
  // still pass except the `toBe` reference-identity assertions, so a
  // reviewer skimming for behavior change would see nothing. This check
  // exists ONLY to ask "is this doc shape valid" — its parsed value must
  // never be used for anything else.
  const finalCheck = sectionDocSchema.safeParse(candidateDoc)
  if (!finalCheck.success) {
    return { ok: false, errors: zodIssuesToStrings(finalCheck.error) }
  }

  // Duplicate-id guard on the OUTPUT — unconditional, unlike the input-side
  // check above. When the batch had an id-addressed op, the input doc was
  // already proven duplicate-free, so any duplicate found now was
  // introduced BY this batch (e.g. `add_section` colliding with a
  // survivor). When it didn't (a `set_page`-only or `set_theme`-only
  // batch), this is the ONLY duplicate check that ran at all — and that's
  // by design: it's what lets `set_page` supply a fresh, unique-id
  // `sections` array and REPAIR a doc that came in already duplicated,
  // while a `set_theme`-only batch (which never touches `sections`) still
  // surfaces a pre-existing duplicate here rather than silently returning
  // `ok: true` over a document nothing has actually fixed.
  const outputDuplicateId = findDuplicateSectionId(sections)
  if (outputDuplicateId) {
    return { ok: false, errors: [`Duplicate section id "${outputDuplicateId}" after applying ops.`] }
  }

  const unchangedCount = sections.filter((s) => !touchedIds.has(s.id)).length
  const totalConsidered = touchedIds.size + unchangedCount
  const isRewrite = totalConsidered > 0 && touchedIds.size / totalConsidered > SECTION_REWRITE_THRESHOLD

  return {
    ok: true,
    doc: candidateDoc,
    receipt: {
      changed,
      unchangedCount,
      totalSections: sections.length,
      themeChanged,
      isRewrite,
    },
  }
}
