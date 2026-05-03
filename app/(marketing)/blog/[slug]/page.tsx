import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import NextImage from "next/image"
import { ArrowLeft } from "lucide-react"
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

// Revalidate every 60 seconds so edits appear without redeploying
export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

const categoryStyles: Record<BlogCategory, string> = {
  Performance: "bg-primary/10 text-primary",
  Recovery: "bg-success/10 text-success",
  Coaching: "bg-accent/10 text-accent",
  "Youth Development": "bg-warning/10 text-warning",
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
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
    url: `https://djpathlete.com/blog/${post.slug}`,
    author: DJP_AUTHOR_PERSON,
    publisher: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
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

  const html = post.content as string
  const tocEntries: { id: string; text: string }[] = []
  const h2Regex = /<h2\s+[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g
  let h2Match: RegExpExecArray | null
  while ((h2Match = h2Regex.exec(html)) !== null) {
    const text = h2Match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (text) tocEntries.push({ id: h2Match[1], text })
  }

  const wordCount = html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length
  const showToc = tocEntries.length >= 2 && wordCount >= 800
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

  return (
    <>
      <JsonLd data={jsonLdData} />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-3xl mx-auto">
          {/* Back link */}
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-8"
          >
            <ArrowLeft className="size-4" />
            All Posts
          </Link>

          {/* Category + Date */}
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${categoryStyles[post.category]}`}
            >
              {post.category}
            </span>
            <time dateTime={post.published_at ?? post.created_at} className="text-sm text-muted-foreground">
              {formatDate(post.published_at ?? post.created_at)}
            </time>
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
            {post.title}
          </h1>

          {/* Excerpt as lead */}
          <p className="text-lg text-muted-foreground leading-relaxed">{post.excerpt}</p>
        </div>
      </section>

      {/* Cover Image */}
      {post.cover_image_url && (
        <section className="px-4 sm:px-8 pb-8">
          <div className="max-w-4xl mx-auto">
            <div className="relative aspect-[16/9] rounded-xl overflow-hidden">
              <NextImage src={post.cover_image_url} alt={post.title} fill className="object-cover" priority />
            </div>
          </div>
        </section>
      )}

      {/* Lead magnet block — renders only when an active magnet matches */}
      <section className="px-4 sm:px-8 -mt-4 lg:-mt-6">
        <div className="max-w-3xl mx-auto">
          <LeadMagnetBlock post={post} />
        </div>
      </section>

      {/* Article Body + ToC */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
          <div className="lg:block">
            {showToc && <TableOfContents entries={tocEntries} />}
          </div>
          <div className="max-w-3xl mx-auto lg:mx-0">
            <article className="prose prose-lg max-w-none text-muted-foreground prose-headings:font-heading prose-headings:text-primary prose-a:text-primary prose-strong:text-foreground prose-img:rounded-xl prose-h2:scroll-mt-24">
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
          </div>
        </div>
      </section>

      {/* FAQ */}
      <BlogFaqSection entries={faqEntries} />

      {/* Tags */}
      {post.tags && post.tags.length > 0 && (
        <section className="py-8 px-4 sm:px-8">
          <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 rounded-full text-xs font-medium bg-surface text-muted-foreground border border-border"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Related posts */}
      <RelatedPosts post={post} />

      <ContextualCta post={post} />
    </>
  )
}
