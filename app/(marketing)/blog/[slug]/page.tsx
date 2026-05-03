import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import NextImage from "next/image"
import { ArrowLeft, ArrowUpRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { getPublishedBlogPostBySlug } from "@/lib/db/blog-posts"
import { DJP_AUTHOR_PERSON } from "@/lib/brand/author"
import { TableOfContents } from "@/components/marketing/blog/TableOfContents"
import { BlogFaqSection } from "@/components/marketing/blog/BlogFaqSection"
import { RelatedPosts } from "@/components/marketing/blog/RelatedPosts"
import { ContextualCta } from "@/components/marketing/blog/ContextualCta"
import { InlinePostNewsletterCapture } from "@/components/marketing/blog/InlinePostNewsletterCapture"
import { LeadMagnetBlock } from "@/components/marketing/blog/LeadMagnetBlock"
import type { BlogCategory, FaqEntry } from "@/types/database"

// Revalidate every 60 seconds so edits appear without redeploying.
export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

const categoryAccent: Record<BlogCategory, string> = {
  Performance: "text-primary",
  Recovery: "text-success",
  Coaching: "text-accent",
  "Youth Development": "text-warning",
}

function formatLong(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublishedBlogPostBySlug(slug)

  if (!post) {
    return { title: "Post Not Found" }
  }

  return {
    title: post.title,
    description: post.meta_description ?? post.excerpt,
    alternates: { canonical: `https://www.darrenjpaul.com/blog/${post.slug}` },
    openGraph: {
      title: `${post.title} | DJP Athlete`,
      description: post.meta_description ?? post.excerpt,
      type: "article",
      publishedTime: post.published_at ?? post.created_at,
      ...(post.cover_image_url && { images: [post.cover_image_url] }),
    },
    twitter: {
      card: "summary_large_image",
      title: `${post.title} | DJP Athlete`,
      description: post.meta_description ?? post.excerpt,
      ...(post.cover_image_url && { images: [post.cover_image_url] }),
    },
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = await getPublishedBlogPostBySlug(slug)

  if (!post) {
    notFound()
  }

  const blogPostSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.meta_description ?? post.excerpt,
    datePublished: post.published_at ?? post.created_at,
    url: `https://www.darrenjpaul.com/blog/${post.slug}`,
    author: DJP_AUTHOR_PERSON,
    publisher: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://www.darrenjpaul.com",
    },
    articleSection: post.category,
    ...(post.cover_image_url && { image: post.cover_image_url }),
  }

  const storedJsonLd = (post.seo_metadata as { json_ld?: Record<string, unknown> | Record<string, unknown>[] } | null)
    ?.json_ld
  const jsonLdData = (() => {
    if (Array.isArray(storedJsonLd) && storedJsonLd.length > 0) return storedJsonLd
    if (storedJsonLd && !Array.isArray(storedJsonLd) && Object.keys(storedJsonLd).length > 0) return storedJsonLd
    return blogPostSchema
  })()

  // Auto-add `id` slugs to any <h2> that lacks one, so the TOC anchor links
  // and the section navigation work even on legacy posts. Server-side only.
  const slugify = (raw: string): string =>
    raw
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80)

  const usedIds = new Set<string>()
  const html = (post.content as string).replace(
    /<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g,
    (match, attrs: string | undefined, inner: string) => {
      const safeAttrs = attrs ?? ""
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      if (!text) return match
      const existing = safeAttrs.match(/\bid\s*=\s*"([^"]+)"/)
      if (existing) {
        usedIds.add(existing[1])
        return match
      }
      let candidate = slugify(text) || "section"
      let suffix = 1
      while (usedIds.has(candidate)) {
        suffix += 1
        candidate = `${slugify(text) || "section"}-${suffix}`
      }
      usedIds.add(candidate)
      return `<h2${safeAttrs} id="${candidate}">${inner}</h2>`
    },
  )

  const tocEntries: { id: string; text: string }[] = []
  const h2Regex = /<h2\s+[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g
  let h2Match: RegExpExecArray | null
  while ((h2Match = h2Regex.exec(html)) !== null) {
    const text = h2Match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (text) tocEntries.push({ id: h2Match[1], text })
  }

  const wordCount = html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length
  const readMinutes = Math.max(1, Math.round(wordCount / 220))
  const showToc = tocEntries.length >= 2 && wordCount >= 600
  const faqEntries = ((post.faq as FaqEntry[] | null) ?? []) as FaqEntry[]

  const splitAtSecondH2 = (input: string): { before: string; after: string } | null => {
    const firstH2End = input.indexOf("</h2>")
    if (firstH2End === -1) return null
    const secondH2Start = input.indexOf("<h2", firstH2End + 5)
    if (secondH2Start === -1) return null
    return { before: input.slice(0, secondH2Start), after: input.slice(secondH2Start) }
  }

  const splitContent = splitAtSecondH2(html)
  const showInlineCapture = splitContent !== null

  const publishedISO = post.published_at ?? post.created_at
  const initials = authorInitials(DJP_AUTHOR_PERSON.name)

  // Pre-built share links (zero-JS, opens in new tab).
  const shareUrl = `https://www.darrenjpaul.com/blog/${post.slug}`
  const shareTitle = encodeURIComponent(post.title)
  const shareLinks = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${shareTitle}&url=${encodeURIComponent(shareUrl)}` },
    { label: "LI", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}` },
    { label: "FB", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}` },
    { label: "✉", href: `mailto:?subject=${shareTitle}&body=${encodeURIComponent(shareUrl)}` },
  ]

  return (
    <>
      <JsonLd data={jsonLdData} />

      {/* Scroll-driven reading progress (CSS-only). */}
      <div className="djp-progress" aria-hidden>
        <span />
      </div>

      {/* ─────────── Issue strap ─────────── */}
      <div className="djp-paper-deep border-b border-border/70 px-4 sm:px-8 pt-28 lg:pt-32 pb-4">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-primary hover:text-accent transition-colors"
          >
            <ArrowLeft className="size-3.5" /> The Performance Journal
          </Link>
          <div className="flex items-center gap-3">
            <span className={`${categoryAccent[post.category]} font-semibold`}>{post.category}</span>
            <span aria-hidden>·</span>
            <time dateTime={publishedISO}>{formatLong(publishedISO)}</time>
            <span aria-hidden>·</span>
            <span>{readMinutes} min read</span>
            <span aria-hidden className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">
              {wordCount.toLocaleString()} words
            </span>
          </div>
        </div>
      </div>

      {/* ─────────── Editorial title block ─────────── */}
      <header className="djp-paper-deep djp-grain px-4 sm:px-8 pt-10 lg:pt-16 pb-16 lg:pb-24 border-b border-border/70">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
            <div className="lg:col-span-9">
              <p className="djp-eyebrow">
                Article / {post.primary_keyword ?? post.category}
              </p>
              <h1
                className="mt-6 font-heading font-semibold text-primary tracking-[-0.02em] leading-[1.02]"
                style={{ fontSize: "clamp(2.25rem, 5.4vw, 4.5rem)" }}
              >
                {post.title}
              </h1>
              <p className="mt-7 text-lg lg:text-xl leading-relaxed text-muted-foreground max-w-2xl">
                {post.excerpt}
              </p>
            </div>

            <aside className="lg:col-span-3 lg:pl-8 lg:border-l lg:border-border/70 flex flex-col gap-6">
              <div>
                <p className="djp-issue-no text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Written by
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="size-11 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center font-heading font-semibold text-sm"
                  >
                    {initials}
                  </span>
                  <div>
                    <p className="font-heading text-primary font-semibold leading-tight">
                      {DJP_AUTHOR_PERSON.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {DJP_AUTHOR_PERSON.jobTitle}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <p className="djp-issue-no text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Share
                </p>
                <ul className="mt-3 flex items-center gap-2">
                  {shareLinks.map((s) => (
                    <li key={s.label}>
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Share on ${s.label}`}
                        className="size-8 inline-flex items-center justify-center rounded-full border border-border/70 text-[11px] font-mono text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </header>

      {/* ─────────── Cover image with caption ─────────── */}
      {post.cover_image_url && (
        <figure className="djp-paper px-4 sm:px-8 pt-10 lg:pt-14 pb-2">
          <div className="max-w-5xl mx-auto">
            <div className="relative aspect-[16/9] overflow-hidden bg-muted">
              <NextImage
                src={post.cover_image_url}
                alt={post.title}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 1024px"
                className="object-cover"
              />
              <div className="absolute inset-0 ring-1 ring-inset ring-foreground/5" />
            </div>
            <figcaption className="mt-4 text-center djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground">
              Cover · {post.category} · {formatLong(publishedISO)}
            </figcaption>
          </div>
        </figure>
      )}

      {/* ─────────── Lead magnet (renders only when active match) ─────────── */}
      <section className="djp-paper px-4 sm:px-8 pt-10">
        <div className="max-w-3xl mx-auto">
          <LeadMagnetBlock post={post} />
        </div>
      </section>

      {/* ─────────── Article body + ToC ─────────── */}
      <section className="djp-paper px-4 sm:px-8 pt-12 lg:pt-16 pb-20 lg:pb-28">
        <div
          className={
            showToc
              ? "mx-auto grid max-w-6xl gap-12 lg:grid-cols-[14rem_minmax(0,42rem)] lg:gap-16 lg:justify-center"
              : "mx-auto max-w-[42rem]"
          }
        >
          {showToc && (
            <div className="hidden lg:block">
              <TableOfContents entries={tocEntries} variant="desktop" />
            </div>
          )}

          {/* Mobile ToC always at the top of the article when applicable */}
          {showToc && (
            <div className="lg:hidden">
              <TableOfContents entries={tocEntries} variant="mobile" />
            </div>
          )}

          <div className="min-w-0">
            <article className="djp-prose-blog">
              {showInlineCapture && splitContent ? (
                <>
                  <div dangerouslySetInnerHTML={{ __html: splitContent.before }} />
                  <InlinePostNewsletterCapture />
                  <div dangerouslySetInnerHTML={{ __html: splitContent.after }} />
                </>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: html }} />
              )}
            </article>

            {/* End-of-article rule + tags */}
            <div className="mt-16">
              <p className="djp-rule djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-accent">
                <span>End of article</span>
              </p>

              {post.tags && post.tags.length > 0 && (
                <ul className="mt-6 flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <li key={tag}>
                      <span className="inline-block px-3 py-1 rounded-full text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground border border-border/70 bg-white/60">
                        {tag}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground">
                <span>Filed {formatLong(publishedISO)}</span>
                <span aria-hidden>·</span>
                <span className={`${categoryAccent[post.category]} font-semibold`}>
                  {post.category}
                </span>
                <span aria-hidden>·</span>
                <span>{readMinutes} min · {wordCount.toLocaleString()} words</span>
              </div>

              <Link
                href="/blog"
                className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-accent transition-colors"
              >
                <ArrowLeft className="size-4" />
                Back to all articles
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <BlogFaqSection entries={faqEntries} />

      {/* ─────────── Related ─────────── */}
      <RelatedPosts post={post} />

      {/* ─────────── Bottom CTA ─────────── */}
      <ContextualCta post={post} />

      {/* ─────────── Sign-off colophon ─────────── */}
      <section className="bg-primary text-primary-foreground/90 py-10 px-4 sm:px-8 border-t border-white/10">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 djp-issue-no text-[10.5px] uppercase tracking-[0.22em]">
          <span>DJP / The Performance Journal</span>
          <Link href="/blog" className="hover:text-accent transition-colors inline-flex items-center gap-1.5">
            More articles <ArrowUpRight className="size-3.5" />
          </Link>
          <span className="opacity-70">© {new Date().getUTCFullYear()} Darren J Paul</span>
        </div>
      </section>
    </>
  )
}
