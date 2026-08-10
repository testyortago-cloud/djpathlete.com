"use server"

// components/admin/funnels/builder/publish-actions.ts — doc -> {html, css}.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A `reassemble()` CALL IN THE UI
// ---------------------------------------------------------------------------
// The publish route takes `{html, css, project_data}`, so somebody has to turn
// the owner's `SectionDoc` into that pair. The obvious answer — import
// `reassemble` into the client component — is not available, and the reason
// that is still true is `parse5` and `postcss`:
//
//     lib/funnels/sections/doc.ts
//       -> lib/funnels/compile.ts          (parse5 + postcss: the sanitiser)
//
// A client-side `reassemble` puts an HTML parser and a CSS parser in an admin
// page bundle. Rendering therefore stays on the server, and this is the
// smallest server surface that does it.
//
// A SECOND REASON USED TO APPLY AND NO LONGER DOES, recorded because the chain
// still looks alarming: `doc.ts -> lib/validators/funnel.ts ->
// lib/funnels/sections/builder-config.ts` used to end at `lib/ai/anthropic.ts`
// and its module-scope `createAnthropic()`, so the same import also shipped the
// Anthropic SDK. As of `9d17612e` the model ids live in `lib/ai/models.ts` (a
// leaf with zero imports) and `__tests__/lib/funnels/sections/builder-config.test.ts`
// walks the real graph to keep it that way. The parse5/postcss reason is the
// load-bearing one now, and it is enough on its own.
//
// ---------------------------------------------------------------------------
// IT IS ALSO THE PUBLISH GATE, RUN AGAINST A LIVE CATALOGUE.
// ---------------------------------------------------------------------------
// `lib/db/funnel-builder.ts:444-456` says in as many words that the
// `unresolved` a turn stores is "A STALE DISPLAY CACHE, NOT A VERDICT", and
// resolve.ts's header says the only answer to "can this be published?" is
// `ResolveResult.unresolved`. The client holds whatever the last turn told it,
// which may be minutes or a browser tab's lifetime old — a program deleted in
// between would leave a dead buy button on a page the UI cheerfully says is
// publishable. So the moment before the write, this re-resolves against a
// freshly loaded catalogue and calls the real `publishGate`. The UI's own
// gate (derived from `unresolved`, never from `compile.ok`) is the fast,
// explanatory one; this is the one that is actually true.
//
// THE PUBLISH ROUTE HAS ITS OWN GATE, AND THAT ONE IS THE ENFORCEMENT. This
// action is a server action, so a request that skips it — a hand-built POST, a
// legacy client, a future caller — still reaches
// `app/api/admin/funnels/steps/[stepId]/publish/route.ts` directly. That route
// gates itself as of `9d17612e`: `gateSectionDoc` runs
// `publishGate(resolveDoc(doc, await loadCatalogues()))` before `publishStep`,
// derives the verdict from the `SectionDoc` (never from the compile result,
// which cannot see an unresolved CTA at all), takes the document from the
// stored draft when the body omits `project_data` so omission is not an opt-out,
// and FAILS CLOSED — a catalogue, resolver or draft-read throw is a 422 naming
// the reason, never a publish and never a 500.
//
// So this is the FAST, EXPLANATORY copy of that check, not the only one: it
// keeps the refusal inside the review the owner is already looking at, with the
// candidate picker next to it, instead of making them click Publish to find
// out. If the two ever disagree, the route is right — it is the one holding the
// write.

import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { reassemble } from "@/lib/funnels/sections/doc"
import { sectionDocSchema } from "@/lib/funnels/sections/registry"
import { loadCatalogues, publishGate, resolveDoc } from "@/lib/funnels/sections/resolve"
import type { RenderForPublishResult, SectionDoc } from "./types"

/**
 * Renders a document for the publish route, refusing when the live publish
 * gate says no.
 *
 * `stepId` is bound on the server (`renderDocForPublish.bind(null, stepId)`),
 * so a caller cannot point it at somebody else's step — but the admin check
 * below is still made, because a server action is a public POST endpoint and
 * a bound argument is not an authorisation.
 */
export async function renderDocForPublish(
  stepId: string,
  doc: SectionDoc,
): Promise<RenderForPublishResult> {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return { ok: false, blockers: ["You do not have permission to publish this page."], warnings: [] }
  }

  // Parsed, not cast. The document arrives over the wire from a client that
  // has been mutating it turn by turn; `resolveDoc` and `reassemble` both
  // throw on a bad one, and a thrown server action is an unexplained failure
  // in the owner's face.
  const parsed = sectionDocSchema.safeParse(doc)
  if (!parsed.success) {
    return {
      ok: false,
      blockers: ["This page's content is not a document the builder can read. Reload and try again."],
      warnings: [],
    }
  }

  const step = await getStep(stepId)
  if (!step) return { ok: false, blockers: ["This page no longer exists."], warnings: [] }
  const funnel = await getFunnelById(step.funnel_id)
  // `funnelBasePath` is derived here, never accepted from the client: it is
  // what `render.ts` builds every `{kind:"step"}` CTA's href from, so a
  // client-supplied value would be an open redirect factory on a live page.
  const funnelBasePath = funnel ? `/go/${funnel.slug}` : undefined

  // resolveDoc THROWS rather than reporting a clean empty list over a corrupt
  // document (resolve.ts:834-843), precisely so a caller cannot accidentally
  // unblock publish. Honour that: a throw is a refusal, never an empty list.
  let resolvedDoc = doc
  let gateWarnings: string[] = []
  try {
    const catalogues = await loadCatalogues()
    const resolution = resolveDoc(doc, catalogues)
    const gate = publishGate(resolution)
    if (!gate.ok) return { ok: false, blockers: gate.blockers, warnings: gate.warnings }
    resolvedDoc = resolution.doc
    gateWarnings = gate.warnings
  } catch (error) {
    console.error("[funnels/publish-actions] could not check this page's links:", error)
    return {
      ok: false,
      blockers: [
        `This page's links could not be checked, so it was not published: ${(error as Error).message}`,
      ],
      warnings: [],
    }
  }

  try {
    const { html, css, problems } = reassemble(
      resolvedDoc,
      funnelBasePath ? { funnelBasePath } : {},
    )
    return { ok: true, html, css, problems: problems.map((p) => p.message), warnings: gateWarnings }
  } catch (error) {
    return {
      ok: false,
      blockers: [`This page could not be rendered: ${(error as Error).message}`],
      warnings: gateWarnings,
    }
  }
}
