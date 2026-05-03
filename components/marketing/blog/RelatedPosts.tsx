import Link from "next/link"
import NextImage from "next/image"
import { ArrowUpRight } from "lucide-react"
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
    <section className="djp-paper border-t border-border/70 py-20 lg:py-24 px-4 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <header className="grid lg:grid-cols-12 gap-6 mb-12 items-end">
          <div className="lg:col-span-7">
            <p className="djp-eyebrow">─ Continue reading</p>
            <h2
              className="mt-4 font-heading font-semibold text-primary tracking-[-0.015em] leading-[1.05]"
              style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}
            >
              More from the journal.
            </h2>
          </div>
          <div className="lg:col-span-5 lg:text-right">
            <Link
              href="/blog"
              className="djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-primary hover:text-accent transition-colors inline-flex items-center gap-1.5"
            >
              Browse all articles <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </header>

        <ol className="grid gap-8 md:grid-cols-3">
          {items.map((item, idx) => (
            <li key={item.slug} className="relative">
              <Link href={`/blog/${item.slug}`} className="group block h-full">
                <div className="flex items-baseline gap-3 mb-4">
                  <span className="djp-issue-no text-[11px] text-accent tabular-nums">
                    №{String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 h-px bg-border/70" />
                </div>

                {item.cover_image_url && (
                  <div className="relative aspect-[4/3] bg-muted overflow-hidden mb-5">
                    <NextImage
                      src={item.cover_image_url}
                      alt={item.title}
                      fill
                      className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                    <div className="absolute inset-0 ring-1 ring-inset ring-foreground/5" />
                  </div>
                )}
                <h3
                  className="font-heading font-semibold text-primary leading-[1.15] tracking-[-0.01em] group-hover:text-primary/80 transition-colors"
                  style={{ fontSize: "clamp(1.125rem, 1.8vw, 1.375rem)" }}
                >
                  {item.title}
                </h3>
                {item.excerpt && (
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed line-clamp-3">
                    {item.excerpt}
                  </p>
                )}
                <span className="mt-4 inline-flex items-center gap-1.5 text-xs djp-issue-no uppercase tracking-[0.22em] text-primary group-hover:text-accent transition-colors">
                  Read <ArrowUpRight className="size-3" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
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
