import type { Metadata } from "next"
import Link from "next/link"
import NextImage from "next/image"
import { ArrowRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { getPublishedBlogPosts } from "@/lib/db/blog-posts"
import type { BlogCategory } from "@/types/database"

// Revalidate every 60 seconds so new/updated posts appear without redeploying
export const revalidate = 60

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Insights on performance, coaching, recovery, and athletic development from Darren J Paul.",
  openGraph: {
    title: "Blog | DJP Athlete",
    description:
      "Insights on performance, coaching, recovery, and athletic development from Darren J Paul.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog | DJP Athlete",
    description:
      "Insights on performance, coaching, recovery, and athletic development from Darren J Paul.",
  },
}

const blogSchema = {
  "@context": "https://schema.org",
  "@type": "Blog",
  name: "DJP Athlete Blog",
  description:
    "Insights on performance, coaching, recovery, and athletic development from Darren J Paul.",
  url: "https://djpathlete.com/blog",
  publisher: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
  },
}

const categoryStyles: Record<BlogCategory, string> = {
  Performance: "bg-primary/10 text-primary",
  Recovery: "bg-success/10 text-success",
  Coaching: "bg-accent/10 text-accent",
  "Youth Development": "bg-warning/10 text-warning",
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function BlogPage() {
  const posts = await getPublishedBlogPosts()
  return (
    <>
      <JsonLd data={blogSchema} />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px w-8 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">
              Blog
            </p>
            <div className="h-px w-8 bg-accent" />
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
            Insights on performance, coaching,
            <br className="hidden sm:block" /> and athletic development.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Practical perspectives from two decades of working with athletes at
            every level. No fluff, no fads — just what works.
          </p>
        </div>
      </section>

      {/* Blog Grid */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          {posts.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              No posts yet. Check back soon!
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  href={`/blog/${post.slug}`}
                  className="group"
                >
                  <article className="relative overflow-hidden bg-white rounded-xl border border-border hover:shadow-md transition-shadow h-full flex flex-col">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left z-10" />
                    {post.cover_image_url && (
                      <div className="relative aspect-[16/9] overflow-hidden">
                        <NextImage
                          src={post.cover_image_url}
                          alt={post.title}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    )}
                    <div className="p-5 flex flex-col flex-1">
                      <span
                        className={`inline-block self-start rounded-full px-3 py-1 text-xs font-medium ${categoryStyles[post.category]}`}
                      >
                        {post.category}
                      </span>
                      <h3 className="font-heading font-semibold text-primary mt-3 mb-2 group-hover:text-primary/80 transition-colors">
                        {post.title}
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-3 mb-3 flex-1">
                        {post.excerpt}
                      </p>
                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                        <time
                          dateTime={post.published_at ?? post.created_at}
                          className="text-xs text-muted-foreground"
                        >
                          {formatDate(post.published_at ?? post.created_at)}
                        </time>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:text-primary/80 transition-colors">
                          Read More
                          <ArrowRight className="size-3" />
                        </span>
                      </div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <FadeIn>
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px w-8 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">
              Get Started
            </p>
            <div className="h-px w-8 bg-accent" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            Want to work with us?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            If these ideas resonate, imagine what a personalized coaching
            relationship could do for your performance.
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
