import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import NextImage from "next/image"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { getPublishedBlogPostBySlug } from "@/lib/db/blog-posts"
import type { BlogCategory } from "@/types/database"

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
    author: {
      "@type": "Person",
      name: "Darren J Paul",
      url: "https://djpathlete.com/about",
    },
    publisher: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
    },
    articleSection: post.category,
    ...(post.cover_image_url && { image: post.cover_image_url }),
  }

  const storedJsonLd = (post.seo_metadata as { json_ld?: Record<string, unknown> } | null)?.json_ld
  const jsonLdData = storedJsonLd && Object.keys(storedJsonLd).length > 0 ? storedJsonLd : blogPostSchema

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

      {/* Article Body */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto">
          <article
            className="prose prose-lg max-w-none text-muted-foreground prose-headings:font-heading prose-headings:text-primary prose-a:text-primary prose-strong:text-foreground prose-img:rounded-xl"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </div>
      </section>

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

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Work With Us</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Ready to take your performance seriously?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              If this resonated, imagine what a coaching relationship built around your specific needs could achieve.
            </p>
            <Link
              href="/contact"
              className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
            >
              Book Free Consultation
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </FadeIn>
      </section>
    </>
  )
}
