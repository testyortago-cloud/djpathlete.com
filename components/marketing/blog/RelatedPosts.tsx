import Link from "next/link"
import NextImage from "next/image"
import type { BlogPost, SeoMetadata, SeoMetadataInternalLink } from "@/types/database"
import { getRelatedPostsByCategory } from "@/lib/db/blog-posts"

interface RelatedPostsProps {
  post: BlogPost
}

interface RelatedItem {
  title: string
  slug: string
  excerpt?: string
  cover_image_url?: string | null
}

/**
 * Renders a "Keep reading" block above the bottom CTA. Source priority:
 * 1. Top 3 entries from seo_metadata.internal_link_suggestions (computed by
 *    seo-enhance via tag-overlap scoring).
 * 2. If empty, fall back to the latest 3 published posts in the same category.
 *
 * Returns null when neither source produces ≥1 item.
 */
export async function RelatedPosts({ post }: RelatedPostsProps) {
  const items = await resolveRelatedItems(post)
  if (items.length === 0) return null

  return (
    <section className="py-16 lg:py-20 px-4 sm:px-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">─ Keep reading</p>
          <h2 className="mt-1 text-2xl sm:text-3xl font-heading font-semibold text-primary">More from DJP Athlete</h2>
        </header>
        <div className="grid gap-6 md:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.slug}
              href={`/blog/${item.slug}`}
              className="group block rounded-xl border border-border bg-white overflow-hidden hover:border-foreground/30 transition-colors"
            >
              {item.cover_image_url && (
                <div className="relative aspect-[16/9] bg-surface">
                  <NextImage
                    src={item.cover_image_url}
                    alt={item.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                </div>
              )}
              <div className="p-4">
                <h3 className="font-heading text-primary text-base leading-snug group-hover:underline underline-offset-4">
                  {item.title}
                </h3>
                {item.excerpt && (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{item.excerpt}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

async function resolveRelatedItems(post: BlogPost): Promise<RelatedItem[]> {
  const seo = post.seo_metadata as SeoMetadata | null
  const suggestions = (seo?.internal_link_suggestions ?? []) as SeoMetadataInternalLink[]
  if (suggestions.length > 0) {
    return suggestions.slice(0, 3).map((s) => ({
      title: s.title,
      slug: s.slug,
    }))
  }

  try {
    const fallback = await getRelatedPostsByCategory({
      category: post.category,
      excludeId: post.id,
      limit: 3,
    })
    return fallback.map((p) => ({
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? undefined,
      cover_image_url: p.cover_image_url ?? undefined,
    }))
  } catch (err) {
    console.warn(`[RelatedPosts] fallback query failed: ${(err as Error).message}`)
    return []
  }
}
