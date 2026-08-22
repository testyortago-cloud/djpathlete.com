// app/(funnel)/preview/[slug]/[[...step]]/page.tsx — the FULL-SCREEN draft.
//
// ---------------------------------------------------------------------------
// WHY IT MIRRORS /go's PATH SHAPE
// ---------------------------------------------------------------------------
// `renderCtaTarget`'s `step` case builds `${ctx.funnelBasePath}/${stepSlug}`
// (lib/funnels/sections/render.ts:463), so a route addressed the same way as the
// live one — funnel slug, then optional step slug — walks the whole funnel in
// DRAFT for the cost of passing a different base. Address it any other way and
// every in-funnel button needs a rewrite the renderer would have to learn about,
// which is a second rendering of the same document and the failure this whole
// feature exists to avoid.
//
// ---------------------------------------------------------------------------
// WHY NOT UNDER /admin, AND WHY NOT INSTEAD OF /funnel-preview
// ---------------------------------------------------------------------------
// The (funnel) route group exists to escape the marketing chrome — navbar,
// footer, sticky CTA — and escaping it IS the whole of "full screen". (admin)
// would wrap the page in the dashboard shell instead, which is the thing the
// builder's own iframe already does.
//
// `/funnel-preview/[stepId]` is NOT replaced by this. It is keyed by step id
// because the builder knows the id and not the slug, and it carries `?edit=1`,
// which must never be reachable from a slug-addressed URL — hence `editable` is
// hard-coded false below rather than read from a query string.
//
// SELF-GATED. `middleware.ts` matches only /admin/* and /client/*, so everything
// here is public unless this file says otherwise. The gate fails CLOSED and
// answers 404 rather than redirecting, so the route does not even confirm that a
// funnel slug exists to someone who may not look at it.

import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { NodeRenderer } from "@/components/funnels/NodeRenderer"
import { PreviewPill } from "@/components/funnels/PreviewPill"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import { getFunnelBySlug, listSteps } from "@/lib/db/funnels"
import { previewBasePath } from "@/lib/funnels/preview-path"
import { renderDraftPreview } from "@/lib/funnels/preview-render"

/**
 * A draft is by definition not ready to be indexed, and this URL is reachable by
 * anyone who is handed it (the gate refuses them, but a crawler that followed a
 * link would still have recorded the URL).
 */
export const metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ slug: string; step?: string[] }>
}

/**
 * Everything that is not a page: no document yet, one this builder cannot read,
 * or one that will not compile. RENDERED rather than thrown — `notFound()` here
 * would tell the owner the page does not exist, which is a different and wrong
 * statement from "you have not written it yet".
 */
function PreviewNotice({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-heading text-2xl text-foreground">{title}</h1>
      <ul className="mt-6 space-y-2">
        {lines.map((line, index) => (
          <li key={index} className="font-body text-sm text-muted-foreground">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The page compiles, but publish will refuse it.
 *
 * It sits ABOVE the page rather than replacing it: the draft is still worth
 * looking at, it just cannot ship yet. Same wording as the builder's iframe
 * preview, because it is the same finding about the same document.
 */
function BlockedBanner({ problems }: { problems: string[] }) {
  return (
    <div className="border-b border-[var(--warning)]/40 bg-[var(--warning)]/10 px-6 py-4">
      <p className="font-heading text-sm text-foreground">This page previews, but publishing will refuse it</p>
      <ul className="mt-2 space-y-1">
        {problems.map((problem, index) => (
          <li key={index} className="font-body text-sm text-muted-foreground">
            {problem}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default async function DraftPreviewPage({ params }: PageProps) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "admin" && role !== "staff") notFound()

  const { slug, step } = await params

  // More than one path segment past the funnel slug is not a page we have —
  // the same check /go makes, for the same reason.
  if (step && step.length > 1) notFound()

  const funnel = await getFunnelBySlug(slug)
  if (!funnel) notFound()

  const steps = await listSteps(funnel.id)
  const stepSlug = step?.[0]
  const target = stepSlug ? steps.find((s) => s.slug === stepSlug) : steps.find((s) => s.is_entry)
  if (!target) notFound()

  const result = await renderDraftPreview({
    stepId: target.id,
    funnelId: funnel.id,
    // THE ONE LINE THAT MAKES THE FUNNEL WALKABLE IN DRAFT.
    funnelBasePath: previewBasePath(funnel.slug),
    // NEVER from the URL — see the header.
    editable: false,
  })

  // Rendered in every branch, including the ones that are not a page: an owner
  // looking at "nothing to preview yet" in a bare browser tab still needs to be
  // told which page they are looking at and that it is not live.
  const pill = (
    <PreviewPill
      funnelName={funnel.name}
      stepName={target.name}
      isLive={funnel.status === "published" && Boolean(target.published_version_id)}
      livePath={`/go/${funnel.slug}${target.is_entry ? "" : `/${target.slug}`}`}
    />
  )

  if (result.kind === "doc-invalid") {
    return (
      <>
        <PreviewNotice
          title="This page can't be previewed"
          lines={[
            "Its saved content is not a document the page builder can read — either it is from the old " +
              "drag-and-drop editor, or it has been corrupted.",
            "Nothing has been lost. Restore an earlier version from the chat to carry on.",
          ]}
        />
        {pill}
      </>
    )
  }

  if (result.kind === "no-draft") {
    return (
      <>
        <PreviewNotice
          title="Nothing to preview yet"
          lines={["This page has no draft. Describe what you want in the builder chat and it will appear here."]}
        />
        {pill}
      </>
    )
  }

  if (result.kind === "render-failed") {
    return (
      <>
        <PreviewNotice title="This page can't be rendered" lines={[result.message]} />
        {pill}
      </>
    )
  }

  if (result.kind === "compile-failed") {
    return (
      <>
        <PreviewNotice title="This page can't be compiled" lines={result.problems} />
        {pill}
      </>
    )
  }

  return (
    <>
      {result.problems.length > 0 ? <BlockedBanner problems={result.problems} /> : null}
      <div id={FUNNEL_ROOT_ID}>
        {/* Scoped by the compiler — every selector is prefixed with this id. */}
        {result.css ? <style dangerouslySetInnerHTML={{ __html: result.css }} /> : null}
        <NodeRenderer
          nodes={result.nodes}
          context={{
            funnelId: funnel.id,
            funnelSlug: funnel.slug,
            stepId: target.id,
            stepSlug: target.slug,
            // STILL TRUE, and still the guard that matters: the page is not
            // published, so nothing it submits may reach the real world.
            isPreview: true,
            // What makes the form usable ANYWAY — through an endpoint that
            // validates against the draft and writes nothing at all.
            testRun: true,
          }}
        />
      </div>
      {pill}
    </>
  )
}
