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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, step } = await params
  const stepSlug = step?.[0]

  const published = await getPublishedStep(slug, stepSlug).catch(() => null)
  if (!published) return {}

  const { funnel, step: stepRow } = published
  return {
    title: stepRow.seo_title ?? stepRow.name ?? funnel.name,
    description: stepRow.seo_description ?? funnel.description ?? undefined,
    openGraph: stepRow.og_image_url ? { images: [stepRow.og_image_url] } : undefined,
    robots: stepRow.noindex ? { index: false, follow: false } : undefined,
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
      {/* Scoped at publish time — every selector is prefixed with this id. */}
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      {isPreview && funnel.status !== "published" ? (
        <div data-djp-preview-banner role="status">
          Preview — this funnel is {funnel.status} and is not visible to the public.
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
