"use server"

// components/admin/funnels/builder/publish-actions.ts — doc -> {html, css}.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A `reassemble()` CALL IN THE UI
// ---------------------------------------------------------------------------
// The publish route is FROZEN for this stage and takes `{html, css,
// project_data}`, so somebody has to turn the owner's `SectionDoc` into that
// pair. The obvious answer — import `reassemble` into the client component —
// is not available:
//
//     lib/funnels/sections/doc.ts
//       -> lib/validators/funnel.ts        (the size caps)
//         -> lib/funnels/sections/builder-config.ts
//           -> lib/ai/anthropic.ts         (@anthropic-ai/sdk, @ai-sdk/anthropic,
//                                           and a module-scope createAnthropic())
//
// so a client-side `reassemble` ships the Anthropic SDK to the browser and
// evaluates a provider constructor there. `doc.ts` also reaches `parse5` and
// `postcss` through `lib/funnels/compile`. None of that belongs in an admin
// page bundle. Rendering therefore stays on the server, and this is the
// smallest possible server surface that keeps the publish route untouched.
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
// A refusal here is not a substitute for a server-side gate ON the publish
// route — a request that skips this action still reaches that route ungated.
// That is recorded as a finding for the stage that may edit `app/api/`.

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
