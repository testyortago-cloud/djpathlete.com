import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { publishStepSchema } from "@/lib/validators/funnel"
import { getStep, publishStep } from "@/lib/db/funnels"
import { getDraft } from "@/lib/db/funnel-builder"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import { loadCatalogues, publishGate, resolveDoc } from "@/lib/funnels/sections/resolve"

/**
 * Compiles the editor output and, if clean, writes an immutable version row.
 *
 * A compile failure returns 422 with the specific problems and writes nothing —
 * the live page keeps serving whatever it was already serving.
 *
 * ---------------------------------------------------------------------------
 * THIS ROUTE IS THE PUBLISH GATE. IT WAS DOCUMENTED AS ONE FOR THREE STAGES
 * BEFORE IT WAS ONE.
 * ---------------------------------------------------------------------------
 * `resolve.ts`, `lib/db/funnel-builder.ts` and the build route all told the
 * reader that an unresolved CTA cannot be published, and named this file as
 * where that happens. It did not happen here. Stage 1.9's UI blocked it in the
 * browser and its `renderDocForPublish` server action blocked it too — but both
 * are the CLIENT'S path, and a direct POST to this endpoint skipped every one
 * of them and published a page with dead buy buttons.
 *
 * The gate is `gateSectionDoc` below, and two properties of it are the point:
 *
 *   1. IT DERIVES FROM THE `SectionDoc`, NEVER FROM THE COMPILE RESULT. An
 *      unresolved CTA renders as a disabled placeholder (and for
 *      `session_pack`, as a LIVE checkout island with the bad ref dropped), and
 *      either way the compiler answers `ok: true, warnings: []` — a
 *      `<span role="button" aria-disabled>` is perfectly valid markup and
 *      `filterAttrs` drops bad attributes silently. There is no version of
 *      "check `compiled.ok` harder" that finds this. It runs BEFORE
 *      `publishStep`, which is what makes the refusal a refusal rather than a
 *      report.
 *
 *   2. IT DOES NOT TRUST THE REQUEST TO DECLARE WHAT IS BEING PUBLISHED. See
 *      `docUnderPublish` — a body that simply omits `project_data` must not be
 *      a way to opt out of the gate, which is exactly what "gate whatever doc
 *      the client sent" would have been.
 *
 * WHAT IT STILL DOES NOT BIND, STATED SO NOBODY OVER-TRUSTS IT: `html`/`css`
 * arrive from the client and are not re-derived from the gated document, so a
 * hand-built request can pair a clean `project_data` with unrelated markup. The
 * compiler is the only thing that inspects that markup, and it sanitises rather
 * than resolves. Closing that means rendering server-side from the document and
 * ignoring the body's html — a bigger change than this defect, and one that
 * would freeze out the legacy GrapesJS steps this endpoint still serves.
 */

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

type GateVerdict = { ok: true } | { ok: false; problems: string[] }

/**
 * The `SectionDoc` this request is publishing, or `null` when there is not one.
 *
 * TWO SOURCES, IN THIS ORDER, AND THE ORDER IS THE SECURITY PROPERTY:
 *
 *   1. `body.project_data`, when it parses. This is the document the request
 *      actually publishes — `publishStep` writes it verbatim onto the version
 *      row — so it is the one whose CTAs must be checked. `FunnelBuilder` sends
 *      the owner's live document here.
 *   2. Otherwise the STORED DRAFT (`getDraft`). This is not a nicety, it is the
 *      hole a body-only gate leaves open: omit `project_data` and a gate that
 *      reads only the body sees nothing to check and waves the request through.
 *      The stored draft cannot be forged by the request, so a POST that
 *      declines to say what it is publishing gets checked against what the step
 *      actually holds.
 *
 * `null` means NO SECTION DOCUMENT IS INVOLVED — a step still holding legacy
 * GrapesJS editor state (`getDraft` reports that as `docInvalid`), or one that
 * has never been built. Those pages carry raw hrefs, not `CtaTarget` refs;
 * there is nothing for the resolver to resolve and refusing them would break
 * publishing for every page predating 00203. Returning `null` here is
 * deliberately NOT the same as "resolution failed" — that case is a refusal,
 * see `gateSectionDoc`.
 *
 * The raw value is returned rather than the Zod-parsed clone so the document
 * that is GATED is object-for-object the document that is STORED.
 */
async function docUnderPublish(stepId: string, projectData: unknown): Promise<SectionDoc | null> {
  if (sectionDocSchema.safeParse(projectData).success) return projectData as SectionDoc
  const draft = await getDraft(stepId)
  return draft?.doc ?? null
}

/**
 * Can this page be published?
 *
 * ---------------------------------------------------------------------------
 * IT FAILS CLOSED, DELIBERATELY. A CATALOGUE FAILURE REFUSES THE PUBLISH.
 * ---------------------------------------------------------------------------
 * `loadCatalogues` throws when a recognition read comes back at PostgREST's
 * 1000-row cap, and `resolveDoc` throws on a document that no longer satisfies
 * `sectionDocSchema`. Both are wrapped here, and both produce a 422 carrying
 * the reason rather than either a 500 or a publish.
 *
 * The alternative — treat "could not check" as "nothing to report" and publish
 * — is not a softer version of this gate, it is the absence of one, and it
 * fails in the direction that reaches customers. Three things decide it:
 *
 *   - THE TRIGGER IS PERSISTENT, NOT TRANSIENT. `assertNotTruncated` throws on
 *     EVERY call once a table crosses 1000 rows. Fail-open would not mean "one
 *     publish slipped through during an outage"; it would mean the gate
 *     switches itself off permanently, on the day a table grows, with nothing
 *     anywhere saying so. That is the exact failure this whole subsystem exists
 *     to prevent, re-created in the one place meant to stop it.
 *   - THE COST OF FAILING CLOSED IS BOUNDED AND VISIBLE. Publishing is a
 *     deliberate click, not a hot path. The live page keeps serving what it was
 *     already serving, the message names the table and the fix, and retrying is
 *     free. Nobody has to guess what happened.
 *   - THE BLAST RADIUS IS NOT THE BUILD ROUTE'S. That route degrades instead
 *     (`loadCataloguesSafely`) because `loadCatalogues` runs on EVERY builder
 *     turn there — throwing would take down all editing on every page. Publish
 *     runs it once, for one page, on request. Same throw, different exposure,
 *     so deliberately the opposite decision. Do not "make them consistent".
 *
 * Reported through the existing 422 `problems` contract so the message lands in
 * the UI the owner is already looking at, rather than as an unexplained 500.
 */
async function gateSectionDoc(stepId: string, projectData: unknown): Promise<GateVerdict> {
  try {
    const doc = await docUnderPublish(stepId, projectData)
    if (!doc) return { ok: true }

    const gate = publishGate(resolveDoc(doc, await loadCatalogues()))
    if (!gate.ok) return { ok: false, problems: gate.blockers }
    // `gate.warnings` (dangling in-page anchors) are deliberately not blockers
    // and are deliberately not smuggled into the 200 response's `warnings`
    // either: that field is the COMPILER's warnings, and mixing two sources
    // into one list is how a caller loses the ability to tell them apart. The
    // builder UI already surfaces dangling anchors from the turn receipt.
    return { ok: true }
  } catch (error) {
    console.error("[funnels/publish] could not check this page's links:", error)
    return {
      ok: false,
      problems: [
        `This page's links could not be checked, so it was not published: ${(error as Error).message}`,
      ],
    }
  }
}

export const POST = withAudit(
  { action: "funnel.published", category: "admin_write" },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { stepId } = await ctx.params

    const body = await request.json().catch(() => null)
    const parsed = publishStepSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    try {
      const step = await getStep(stepId)
      if (!step) return NextResponse.json({ error: "Not found" }, { status: 404 })

      // BEFORE `publishStep`, which both compiles and writes. A gate that ran
      // after it would be a report on a page that is already live.
      const gate = await gateSectionDoc(stepId, parsed.data.project_data)
      if (!gate.ok) {
        return NextResponse.json(
          { error: "This page could not be published.", problems: gate.problems },
          { status: 422 },
        )
      }

      const result = await publishStep({
        stepId,
        html: parsed.data.html,
        css: parsed.data.css,
        projectData: parsed.data.project_data,
        publishedBy: session.user.id,
      })

      if (!result.ok) {
        return NextResponse.json(
          {
            error: "This page could not be published.",
            problems: result.errors.map((e) => e.message),
          },
          { status: 422 },
        )
      }

      return NextResponse.json({
        version: result.version.version,
        warnings: result.warnings.map((w) => w.message),
      })
    } catch (error) {
      console.error("[POST /api/admin/funnels/steps/:stepId/publish]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
