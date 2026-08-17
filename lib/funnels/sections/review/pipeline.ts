// lib/funnels/sections/review/pipeline.ts — audit, critique, revise, gate.
//
// ---------------------------------------------------------------------------
// THE WHOLE FILE IS BUILT AROUND ONE PROMISE: THIS CANNOT COST THE OWNER THEIR
// PAGE.
// ---------------------------------------------------------------------------
// The review runs AFTER the build turn has committed — the document is saved,
// the revision has advanced, and the owner already has something to look at.
// So every failure in here has exactly one correct behaviour: give the page
// back unchanged and say why.
//
// `reviewDoc` therefore has NO THROWING PATH. It reports trouble in `error`,
// and its caller in the route treats a non-null `error` as "no review turn",
// never as a failed request. A `throw` escaping this module would surface to
// the owner as a broken build of a page that in fact built fine.

import { applyOps, type DiffReceipt, type SectionOp } from "@/lib/funnels/sections/apply"
import {
  SECTION_REVIEW_MAX_FINDINGS,
  SECTION_REVIEW_MAX_ROUNDS,
  SECTION_REVIEW_TIMEOUT_MS,
} from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { auditDoc } from "@/lib/funnels/sections/review/audit"
import { runCritics } from "@/lib/funnels/sections/review/critics"
import { mergeFindings, type Finding } from "@/lib/funnels/sections/review/findings"
import { runReviser } from "@/lib/funnels/sections/review/reviser"

export interface ReviewInput {
  doc: SectionDoc
  /** Called as each finding lands, so the route can stream it to the owner. */
  onFinding?: (finding: Finding) => void
}

export interface ReviewOutcome {
  changed: boolean
  /**
   * The revised document — or REFERENCE-IDENTICAL to the input when nothing
   * changed. The caller may compare by identity to decide whether to write.
   */
  doc: SectionDoc
  ops: SectionOp[]
  /** Prose for the owner's transcript. Empty when nothing changed. */
  summary: string
  /** Everything found, before revision. */
  findings: Finding[]
  /**
   * What the gate still sees afterwards.
   *
   * REPORTED, NOT HIDDEN. A gate that quietly drops what it could not fix
   * reads as a gate that found nothing, and this field is also the evidence
   * for whether `SECTION_REVIEW_MAX_ROUNDS` should ever go to 2.
   */
  surviving: Finding[]
  receipt: DiffReceipt | null
  /**
   * Tokens this stage spent, across every critic and every reviser round.
   *
   * Carried out so the turn that stores the result can record it. The stage
   * roughly triples the AI spend of a first draft, and every other model call
   * on the build route is already accounted for — a cost that appears only on
   * the invoice is a cost nobody can attribute to a feature.
   */
  tokensUsed: number
  /** Set when the stage gave up. NEVER thrown. */
  error: string | null
}

/**
 * Whether a turn earns a review.
 *
 * A `set_page` is reviewed automatically. That op means a first draft or an
 * explicit start-over — the model's own gloss for it in the builder prompt —
 * so every word on the resulting page is the model's and there is nothing of
 * the owner's to second-guess. An ordinary edit turn is not reviewed: the
 * owner has just said exactly what they wanted, and a reviewer that argues
 * with that on every turn is one they will switch off.
 *
 * ---------------------------------------------------------------------------
 * THE SIGNAL IS THE OP, NOT `DiffReceipt.isRewrite`.
 * ---------------------------------------------------------------------------
 * `isRewrite` looks like the right field and is not. It is a VOLUME heuristic
 * — `SECTION_REWRITE_THRESHOLD` in apply.ts, 60% of sections changed — so on a
 * small page it is true for edits that are nothing of the kind: a one-section
 * draft where the owner retitles the hero scores 1/1 and reads as a full
 * rewrite. Keying the review off it would run four model calls every time
 * somebody fixed a typo on a short page, which is the exact behaviour the
 * "first drafts only" decision exists to avoid.
 *
 * `requested` is the Polish button — an explicit ask, which outranks all of
 * the above.
 */
export function shouldReview(input: { rewrotePage: boolean; requested: boolean }): boolean {
  if (SECTION_REVIEW_MAX_ROUNDS < 1) return false
  return input.requested || input.rewrotePage
}

/**
 * Whether a batch of ops replaced the whole page. See `shouldReview`.
 *
 * Takes `unknown` because the call site holds the model's parsed response,
 * whose `ops` is typed loosely at that point in the route. Narrowing here
 * rather than casting at the call site keeps the "is this a rewrite" rule in
 * one place — a cast would move the decision to the caller and let a second
 * caller narrow it differently.
 */
export function opsRewrotePage(ops: unknown): boolean {
  if (!Array.isArray(ops)) return false
  return ops.some((op) => typeof op === "object" && op !== null && (op as { op?: unknown }).op === "set_page")
}

function unchanged(doc: SectionDoc, findings: Finding[], error: string | null, tokensUsed = 0): ReviewOutcome {
  return {
    changed: false,
    doc,
    ops: [],
    summary: "",
    findings,
    surviving: findings,
    receipt: null,
    tokensUsed,
    error,
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Rejects after `ms`.
 *
 * The route holds an SSE stream open across this, and a provider that hangs
 * would hold it open until a proxy dropped it — which the owner sees as a page
 * that never finished, on a turn that actually succeeded.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function reviewDoc(input: ReviewInput): Promise<ReviewOutcome> {
  const { doc, onFinding } = input

  // The kill switch. `0` means the stage is off, and off must cost nothing —
  // not even the deterministic pass.
  if (SECTION_REVIEW_MAX_ROUNDS < 1) return unchanged(doc, [], null)

  try {
    return await withTimeout(runReview(doc, onFinding), SECTION_REVIEW_TIMEOUT_MS, "review")
  } catch (error) {
    // Includes the timeout, and anything `runReview` failed to contain. The
    // page the builder made stands.
    console.error("[funnels/review] stage abandoned:", error)
    return unchanged(doc, [], message(error))
  }
}

async function runReview(doc: SectionDoc, onFinding?: (finding: Finding) => void): Promise<ReviewOutcome> {
  // --- 1. The deterministic pass. Free, pure, and it cannot fail. ---------
  const auditFindings = auditDoc(doc)
  for (const finding of auditFindings) onFinding?.(finding)

  // --- 2. The panel. -----------------------------------------------------
  // `runCritics` already contains individual critic failures; this catch is
  // for a throw from the fan-out itself. Either way the deterministic
  // findings alone are still a review worth doing — which is the reason the
  // auditor exists rather than making the critics do all of it.
  let criticFindings: Finding[] = []
  let tokensUsed = 0
  try {
    const returned = await runCritics(doc, auditFindings)
    // Defended rather than trusted. A schema change or a partially-applied
    // refactor that made this return the wrong shape would otherwise take the
    // WHOLE review down at the merge — losing the deterministic findings,
    // which had already succeeded and cost nothing. The panel degrading to
    // zero findings is the correct floor here, not an abandoned stage.
    criticFindings = Array.isArray(returned?.findings) ? returned.findings : []
    tokensUsed += returned?.tokensUsed ?? 0
    for (const finding of criticFindings) onFinding?.(finding)
  } catch (error) {
    console.error("[funnels/review] critic panel failed wholesale:", error)
    criticFindings = []
  }

  const findings = mergeFindings([auditFindings, criticFindings], SECTION_REVIEW_MAX_FINDINGS)

  if (findings.length === 0) {
    // Nothing to fix. No reviser call — but the critics were still paid for.
    return {
      changed: false,
      doc,
      ops: [],
      summary: "",
      findings,
      surviving: [],
      receipt: null,
      tokensUsed,
      error: null,
    }
  }

  // --- 3-5. Revise, apply, gate — up to SECTION_REVIEW_MAX_ROUNDS times. --
  //
  // The loop is REAL rather than a constant nobody reads. Shipping
  // `SECTION_REVIEW_MAX_ROUNDS = 1` with no loop behind it would make the
  // number a lie: raising it to 2 would change nothing, silently, and the next
  // person to try it would conclude a second round does not help when in fact
  // it never ran. A tunable that does not tune is worse than no tunable.
  //
  // Each round revises against WHAT THE GATE STILL SEES, not against the
  // original list — a second pass handed the findings the first pass already
  // fixed would undo its own work.
  let workingDoc = doc
  let outstanding = findings
  const allOps: SectionOp[] = []
  const summaries: string[] = []
  let receipt: DiffReceipt | null = null

  for (let round = 0; round < SECTION_REVIEW_MAX_ROUNDS; round += 1) {
    let revision: { summary: string; ops: SectionOp[]; tokensUsed: number }
    try {
      revision = await runReviser(workingDoc, outstanding)
      tokensUsed += revision.tokensUsed
    } catch (error) {
      console.error("[funnels/review] reviser failed:", error)
      // A LATER round failing keeps what earlier rounds achieved. Only a
      // first-round failure means nothing was gained.
      if (allOps.length === 0) return unchanged(doc, findings, message(error), tokensUsed)
      break
    }

    if (revision.ops.length === 0) {
      // A reviser that read the findings and judged the page fine is a GOOD
      // outcome, not a failure. Its words are still worth keeping.
      if (summaries.length === 0) summaries.push(revision.summary)
      break
    }

    // Not a schema check: `opSchema` accepts an `update_section` carrying
    // nothing, and `applyOps` is what rejects it — taking the whole batch with
    // it, because the batch is transactional. A parse success upstream
    // guarantees nothing here.
    const applied = applyOps(workingDoc, revision.ops)
    if (!applied.ok) {
      console.error("[funnels/review] ops rejected:", applied.errors)
      // The errors are INTERPOLATED. This read `\`ops rejected: \`` — a template
      // literal with nothing in it — so the one field that says why the stage
      // gave up said nothing, and diagnosing a rejection meant having the
      // server log for the same request.
      if (allOps.length === 0) {
        return unchanged(doc, findings, `ops rejected: ${applied.errors.join("; ")}`, tokensUsed)
      }
      break
    }

    workingDoc = applied.doc
    receipt = applied.receipt
    allOps.push(...revision.ops)
    summaries.push(revision.summary)

    // THE GATE. A reviser that fixed one tone seam by creating another is
    // caught here, for free, because the auditor is pure and both readings are
    // comparable. What survives becomes the next round's brief.
    outstanding = auditDoc(workingDoc)
    if (outstanding.every((finding) => finding.severity !== "high")) break
  }

  if (allOps.length === 0) {
    return {
      changed: false,
      doc,
      ops: [],
      summary: summaries.join(" ").trim(),
      findings,
      surviving: findings,
      receipt: null,
      tokensUsed,
      error: null,
    }
  }

  return {
    changed: true,
    doc: workingDoc,
    ops: allOps,
    summary: summaries.join(" ").trim(),
    findings,
    surviving: auditDoc(workingDoc),
    receipt,
    tokensUsed,
    error: null,
  }
}
