// lib/funnels/publish-plan.ts — what a funnel-wide publish would write, and
// why it would refuse.
//
// ---------------------------------------------------------------------------
// A LEAF, ON PURPOSE. It imports one TYPE and nothing else.
// ---------------------------------------------------------------------------
// The gate arrives as a parameter rather than being imported, because the real
// one (`publishGate(resolveDoc(doc, await loadCatalogues(), pages))`) needs
// three database reads. Injecting it keeps every decision below testable with
// no mocks at all, and keeps this module out of any bundle that would drag the
// DAL along behind it.
//
// ---------------------------------------------------------------------------
// ALL OR NOTHING, AND THAT IS THE OWNER'S DECISION RATHER THAN A DEFAULT.
// ---------------------------------------------------------------------------
// Asked what should happen when one page of a funnel is not ready, he chose:
// refuse the whole publish and name the pages. The alternative — publish the
// good pages and skip the rest — puts a funnel live with a 404 in the middle
// of it, which is the failure this whole feature exists to stop. So `publish`
// is EMPTY whenever `ok` is false: a caller cannot half-honour the plan even
// by ignoring the flag.

import type { SectionDoc } from "@/lib/funnels/sections/registry"

/** One step, as the planner needs it. */
export interface StepToPublish {
  id: string
  name: string
  position: number
  /** The stored draft, already parsed. `null` = not a section document. */
  doc: SectionDoc | null
  /** Already serving a compiled version row. */
  hasPublishedVersion: boolean
}

export interface PagePublishProblem {
  stepId: string
  stepName: string
  problems: string[]
  /**
   * The page was never built — as opposed to built and blocked.
   *
   * The UI branches on this to offer "Generate it now", which is a real fix
   * for a blank page and nonsense for a dead CTA. Derived here rather than by
   * the UI matching on the message text, because a message the UI parses is a
   * message nobody can reword.
   */
  blank: boolean
}

export interface FunnelPublishPlan {
  /** True iff every page can be published. */
  ok: boolean
  /** Steps to write a version row for, in position order. EMPTY unless `ok`. */
  publish: { stepId: string; stepName: string; doc: SectionDoc }[]
  /** Why the funnel cannot be published. Empty exactly when `ok`. */
  problems: PagePublishProblem[]
}

/**
 * Plans a funnel-wide publish.
 *
 * `gate` is allowed to THROW and is deliberately not caught. `resolveDoc`
 * throws on a document that no longer satisfies `sectionDocSchema`, and it
 * throws so that a caller cannot accidentally unblock publishing by swallowing
 * the failure into an empty `unresolved` list. Catching it per step and
 * reporting "no blockers" would be exactly that fail-open. The route's own
 * try/catch turns it into a 422 that names the reason.
 */
export function funnelPublishPlan(
  steps: StepToPublish[],
  gate: (doc: SectionDoc) => { ok: boolean; blockers: string[] },
): FunnelPublishPlan {
  // POSITION ORDER, not input order. The entry page is written first, so a
  // write that dies half way leaves the funnel more coherent rather than less.
  const ordered = [...steps].sort((a, b) => a.position - b.position)

  const publish: FunnelPublishPlan["publish"] = []
  const problems: PagePublishProblem[] = []

  for (const step of ordered) {
    if (!step.doc) {
      // A legacy GrapesJS step: no `SectionDoc`, but a real compiled version
      // already live. There is nothing to render it from and nothing wrong
      // with it. Left alone — neither published nor a problem.
      if (step.hasPublishedVersion) continue
      problems.push({
        stepId: step.id,
        stepName: step.name,
        problems: [`${step.name} has no content yet.`],
        blank: true,
      })
      continue
    }

    const verdict = gate(step.doc)
    if (!verdict.ok) {
      problems.push({ stepId: step.id, stepName: step.name, problems: verdict.blockers, blank: false })
      continue
    }
    publish.push({ stepId: step.id, stepName: step.name, doc: step.doc })
  }

  // EVERY page is inspected before this line — the loop above never returns
  // early. Being sent back to fix one page, then told about the next, is the
  // friction this feature exists to remove.
  const ok = problems.length === 0
  // `publish` is emptied rather than returned alongside the problems, so a
  // caller that forgets to check `ok` writes nothing instead of writing half a
  // funnel. The flag and the payload cannot disagree.
  return { ok, publish: ok ? publish : [], problems }
}
