// Public funnel pages: /go/<funnel>[/<step>].
//
// The /go prefix keeps builder pages from colliding with the ~40 hand-coded
// marketing routes. This route reads ONLY published version rows — the editor
// draft is never public.
//
// Rendering is dynamic: the page reads searchParams (for preview) and islands
// pull live data (spots remaining, testimonials). Caching published pages is a
// Phase 2 concern, tracked in the plan.

import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { getPublishedStep } from "@/lib/db/funnels"
import { NodeRenderer } from "@/components/funnels/NodeRenderer"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile/css-scope"
import { resolveFunnelStepSeo } from "@/lib/funnels/seo"
import { buildFunnelPageSchema } from "@/lib/seo/build-funnel-page-schema"
import { JsonLd } from "@/components/shared/JsonLd"

interface PageProps {
  params: Promise<{ slug: string; step?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Only an admin or staff member may look at an unpublished funnel. */
async function resolvePreview(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<boolean> {
  if (searchParams.preview !== "1") return false
  const session = await auth()
  const role = session?.user?.role
  return role === "admin" || role === "staff"
}

/**
 * What a searcher and a share card see.
 *
 * Every decision here lives in `lib/funnels/seo.ts`, which is pure and shared
 * with the sitemap and the admin panel. This function's whole job is to map
 * that answer onto Next's `Metadata` shape. Putting a rule in here instead
 * would put it somewhere the other two callers cannot reach.
 *
 * ---------------------------------------------------------------------------
 * `openGraph` IS ALWAYS AN OBJECT. NEVER `undefined`.
 * ---------------------------------------------------------------------------
 * This is the fix, not a tidy-up. The previous version returned
 * `openGraph: stepRow.og_image_url ? {...} : undefined`, and an explicit
 * `undefined` from a child route does not mean "inherit" — it OVERRIDES the
 * root layout's `openGraph` and deletes it. `app/layout.tsx` defines a full OG
 * block; every published funnel page was emitting zero `og:` tags, verified
 * against production on 2026-09-19 with `/online` as the control (3 tags there,
 * 0 here). A funnel link shared to Facebook, LinkedIn, WhatsApp or iMessage
 * rendered as a bare URL — on pages whose entire purpose is to be sent to an
 * athlete.
 *
 * `twitter` is set for the same reason in reverse: the child never named it, so
 * it inherited, and the page served the SITE-WIDE Twitter copy under a
 * page-specific `<title>`. An X share of the quiz advertised the homepage.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, step } = await params
  const stepSlug = step?.[0]

  const published = await getPublishedStep(slug, stepSlug).catch(() => null)
  if (!published) return {}

  const { funnel, step: stepRow } = published
  const seo = resolveFunnelStepSeo(funnel, stepRow)

  return {
    title: seo.title,
    // `?? undefined` and not `?? something`: a null description is a decision
    // this route must not quietly undo. See `resolveFunnelStepSeo`.
    description: seo.description ?? undefined,
    alternates: { canonical: seo.canonicalPath },
    openGraph: {
      title: seo.socialTitle,
      description: seo.description ?? undefined,
      url: seo.canonicalPath,
      type: "website",
      // ALWAYS EXPLICIT. `seo.ogImage` is the owner's `og_image_url` if they
      // set one, otherwise the generated card at `/og/funnel/<slug>` — the
      // resolver picks, and this route just names the answer.
      //
      // Deliberately NOT the `opengraph-image.tsx` file convention, which
      // would make those two compete through a precedence rule ("an explicit
      // `images` overrides the file") that is invisible at both call sites.
      // It is also impossible here: Turbopack refuses an `opengraph-image`
      // segment after an optional catch-all. See the route's own header.
      images: [seo.ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.socialTitle,
      description: seo.description ?? undefined,
      images: [seo.ogImage],
    },
    robots: seo.noindex ? { index: false, follow: false } : undefined,
  }
}

export default async function FunnelPage({ params, searchParams }: PageProps) {
  const { slug, step } = await params
  const stepSlug = step?.[0]

  // More than one path segment past the funnel slug is not a page we have.
  if (step && step.length > 1) notFound()

  const isPreview = await resolvePreview(await searchParams)

  const published = await getPublishedStep(slug, stepSlug, { includeUnpublished: isPreview })
  if (!published) notFound()

  const { funnel, step: stepRow, nodes, css } = published

  return (
    <div id={FUNNEL_ROOT_ID}>
      {/* STRUCTURED DATA, AND IT IS NOT IN THE COMPILED DOCUMENT.

          Everything inside `nodes`/`css` below was frozen into
          `funnel_step_versions` at publish time and only changes when the
          funnel is re-published. This <script> is rendered by the route on
          every request, from the same resolver `generateMetadata` uses — so it
          reaches a live page the moment the row changes, exactly like the
          title and description do, and it cannot drift from them.

          Putting it inside the compiled document instead would have made it
          stale the moment the owner edited a title, with no way to tell. */}
      <JsonLd data={buildFunnelPageSchema(resolveFunnelStepSeo(funnel, stepRow))} />
      {/* Scoped at publish time — every selector is prefixed with this id. */}
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      {isPreview && funnel.status !== "published" ? (
        <div data-djp-preview-banner role="status">
          Preview — this {funnel.kind === "page" ? "landing page" : "funnel"} is {funnel.status} and is
          not visible to the public.
        </div>
      ) : null}
      <NodeRenderer
        nodes={nodes}
        context={{
          funnelId: funnel.id,
          funnelSlug: funnel.slug,
          stepId: stepRow.id,
          stepSlug: stepRow.slug,
          isPreview,
        }}
      />
    </div>
  )
}
