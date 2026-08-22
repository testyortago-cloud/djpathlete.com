// lib/funnels/preview-render.ts
//
// The draft render, shared by the builder's iframe preview
// (/funnel-preview/[stepId]) and the full-screen one (/preview/<slug>).
//
// ---------------------------------------------------------------------------
// WHY IT IS ONE MODULE AND NOT TWO ROUTES DOING THE SAME THING
// ---------------------------------------------------------------------------
// `loadCatalogues -> resolveDoc -> publishGate -> reassemble -> compileFunnelStep`
// is exactly the sequence the publish path runs, which is the only reason a
// preview is worth looking at: it shows what publish will actually ship rather
// than a second, drifting rendering of the same document. A hand-rolled copy of
// that sequence in a second route is how preview and publish start disagreeing
// — a silent, perfectly plausible wrong answer, and the worst failure mode this
// feature has.
//
// THE RESOLVE STEP IS NOT OPTIONAL, and its absence was once exactly the
// failure the preview exists to prevent. The build route stores the RESOLVED
// doc, but a turn whose resolution degraded (catalogue unreadable) stores
// name-refs instead — and reassembling the STORED draft then previewed a
// `{kind:"program", ref:"Comeback Code"}` as a disabled button while publish
// shipped it as a live checkout island.
//
// THE GATE RUNS HERE for the second half of the same problem: `reassemble`'s
// `problems` are only the SIZE CAPS, so a page full of dead buy buttons — the
// commonest refusal by far — would otherwise carry no warning at all, on the
// one screen the owner uses to decide a page is done.
//
// IT FAILS SOFT, and that is the one place it differs from publish. A catalogue
// read that throws must not turn "look at my draft" into an error page: the
// draft still renders, from the unresolved document, with a problem saying
// publishing will refuse it until the links can be checked — which is true,
// because both publish gates fail CLOSED on the same throw.

import { compileFunnelStep } from "@/lib/funnels/compile"
import { getDraft } from "@/lib/db/funnel-builder"
import { listSteps } from "@/lib/db/funnels"
import { reassemble } from "@/lib/funnels/sections/doc"
import { loadCatalogues, publishGate, resolveDoc } from "@/lib/funnels/sections/resolve"
import type { FunnelNode } from "@/lib/funnels/compile/types"

/**
 * Everything that is not a page gets its own variant rather than a null.
 *
 * `no-draft` and `doc-invalid` MUST stay distinct: "you have not written this
 * yet" and "this holds a page I cannot read" want different words on screen,
 * and collapsing them is how a caller offers to start a fresh document over
 * someone's existing legacy page.
 */
export type DraftPreviewResult =
  | { kind: "no-draft" }
  | { kind: "doc-invalid" }
  | { kind: "render-failed"; message: string }
  | { kind: "compile-failed"; problems: string[] }
  | { kind: "ok"; nodes: FunnelNode[]; css: string; problems: string[] }

export interface DraftPreviewInput {
  stepId: string
  funnelId: string
  /** `/go/<slug>` for the builder iframe, `/preview/<slug>` full screen. */
  funnelBasePath: string
  /**
   * Stamp canvas editing anchors. Set ONLY by the builder's iframe — a
   * slug-addressed URL must never reach edit mode.
   */
  editable?: boolean
}

export async function renderDraftPreview({
  stepId,
  funnelId,
  funnelBasePath,
  editable = false,
}: DraftPreviewInput): Promise<DraftPreviewResult> {
  const draft = await getDraft(stepId)
  if (!draft) return { kind: "no-draft" }
  if (draft.docInvalid) return { kind: "doc-invalid" }
  if (!draft.doc) return { kind: "no-draft" }

  // THE SAME RESOLUTION PUBLISH RUNS, so the preview cannot disagree with it
  // about the same document. Both reads are inside the same try, so either
  // failing lands in the catch — which already tells the owner publishing will
  // refuse the page until its links can be checked. That is the honest answer;
  // an empty blocker list would quietly claim the step links were fine.
  let docToRender = draft.doc
  let gateBlockers: string[] = []
  try {
    const [catalogues, pages] = await Promise.all([
      loadCatalogues(),
      listSteps(funnelId).then((rows) => rows.map((row) => ({ slug: row.slug, name: row.name }))),
    ])
    const resolution = resolveDoc(draft.doc, catalogues, pages)
    docToRender = resolution.doc
    gateBlockers = publishGate(resolution).blockers
  } catch (error) {
    gateBlockers = [
      "This page's links could not be checked, so publishing will refuse it until they can be: " +
        (error as Error).message,
    ]
  }

  // `reassemble` re-parses the document and throws on a bad one. `getDraft` has
  // already parsed it with the same schema, so this cannot legitimately fire —
  // but an uncaught throw is a 500 for an owner who only wanted to look at their
  // draft, and "here is what is wrong with it" is strictly more useful.
  let rendered
  try {
    rendered = reassemble(docToRender, { funnelBasePath, editable })
  } catch (error) {
    return { kind: "render-failed", message: (error as Error).message }
  }

  const compiled = compileFunnelStep({ html: rendered.html, css: rendered.css })
  if (!compiled.ok) {
    return {
      kind: "compile-failed",
      problems: [...rendered.problems.map((p) => p.message), ...compiled.errors.map((e) => e.message)],
    }
  }

  return {
    kind: "ok",
    nodes: compiled.nodes,
    css: compiled.css,
    problems: [...rendered.problems.map((p) => p.message), ...gateBlockers],
  }
}
