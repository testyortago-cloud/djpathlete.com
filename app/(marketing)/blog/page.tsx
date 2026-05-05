import type { Metadata } from "next"
import Link from "next/link"
import NextImage from "next/image"
import { ArrowUpRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { getPublishedBlogPosts } from "@/lib/db/blog-posts"
import type { BlogCategory, BlogPost } from "@/types/database"

// Revalidate every 60 seconds so new/updated posts appear without redeploying.
export const revalidate = 60

export const metadata: Metadata = {
  title: "The Performance Journal — Coaching, Training & Recovery",
  description:
    "Performance writing from Darren J Paul. Two decades coaching elite athletes, distilled into practical articles on training, recovery, and the long game.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "The Performance Journal | DJP Athlete",
    description:
      "Performance writing from Darren J Paul. Practical articles on coaching, training, and recovery for serious athletes.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Performance Journal | DJP Athlete",
    description:
      "Performance writing from Darren J Paul. Practical articles on coaching, training, and recovery.",
  },
}

const blogSchema = {
  "@context": "https://schema.org",
  "@type": "Blog",
  name: "DJP Athlete — The Performance Journal",
  description:
    "Articles on performance, coaching, recovery, and athletic development from Darren J Paul.",
  url: "https://www.darrenjpaul.com/blog",
  publisher: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://www.darrenjpaul.com",
  },
}

const CATEGORY_ORDER: BlogCategory[] = ["Performance", "Recovery", "Coaching", "Youth Development"]

const categoryDeck: Record<BlogCategory, string> = {
  Performance: "Programming, periodization, and the discipline of getting better.",
  Recovery: "Restoring capacity, managing load, and building the body that lasts.",
  Coaching: "On the craft — assessment, communication, and what makes work transfer.",
  "Youth Development": "Long-game thinking for athletes who are still becoming.",
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

function formatShort(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function readingMinutes(html: string): number {
  const words = html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

function categoryAnchor(c: BlogCategory): string {
  return c.toLowerCase().replace(/\s+/g, "-")
}

function groupByCategory(posts: BlogPost[]): Record<BlogCategory, BlogPost[]> {
  const grouped: Record<BlogCategory, BlogPost[]> = {
    Performance: [],
    Recovery: [],
    Coaching: [],
    "Youth Development": [],
  }
  for (const p of posts) grouped[p.category].push(p)
  return grouped
}

export default async function BlogPage() {
  const posts = await getPublishedBlogPosts()
  const featured = posts[0] ?? null
  const rest = posts.slice(1)
  const grouped = groupByCategory(rest)
  const totalCount = posts.length
  const lastUpdated = posts[0]?.published_at ?? posts[0]?.created_at ?? null

  return (
    <>
      <JsonLd data={blogSchema} />

      {/* ─────────── Issue masthead ─────────── */}
      <header className="djp-paper-deep djp-grain border-b border-border/70 pt-32 pb-12 lg:pt-36 lg:pb-16 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap items-baseline justify-between gap-4 djp-issue-no text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="text-primary font-semibold">DJP / The Performance Journal</span>
            <span>Vol. 01</span>
            <span>
              Issue{" "}
              <span className="text-primary tabular-nums">
                {String(totalCount).padStart(3, "0")}
              </span>
            </span>
            {lastUpdated && (
              <span className="hidden sm:inline">
                Updated {formatShort(lastUpdated)}
              </span>
            )}
          </div>

          <div className="mt-12 lg:mt-16 grid lg:grid-cols-12 gap-8 lg:gap-12 items-end">
            <div className="lg:col-span-8">
              <p className="djp-eyebrow">The Performance Journal</p>
              <h1
                className="mt-6 font-heading font-semibold text-primary tracking-[-0.02em] leading-[0.95]"
                style={{ fontSize: "clamp(2.5rem, 6.8vw, 5.75rem)" }}
              >
                Performance<span className="text-accent">.</span>
                <br />
                Journal<span className="text-accent">.</span>
              </h1>
            </div>
            <div className="lg:col-span-4 lg:pl-8 lg:border-l lg:border-border/70">
              <p className="text-base lg:text-[17px] leading-relaxed text-muted-foreground">
                Two decades coaching elite athletes, written down. No fads, no hype —
                only what survives contact with the work.
              </p>
              <p className="mt-4 text-sm text-primary font-medium">
                — Darren J Paul, PhD · Strength &amp; Conditioning
              </p>
            </div>
          </div>

          {/* Category index — anchor jumps so the entire archive stays in one HTML doc. */}
          {posts.length > 0 && (
            <nav
              aria-label="Sections"
              className="mt-14 lg:mt-20 pt-6 border-t border-border/70 flex flex-wrap items-center gap-x-6 gap-y-3 djp-issue-no text-[11px] uppercase tracking-[0.22em]"
            >
              <span className="text-muted-foreground">Inside this issue</span>
              {CATEGORY_ORDER.map((cat) => {
                const count = grouped[cat].length + (featured?.category === cat ? 1 : 0)
                if (count === 0) return null
                return (
                  <a
                    key={cat}
                    href={`#${categoryAnchor(cat)}`}
                    className="group inline-flex items-baseline gap-1.5 text-primary hover:text-accent transition-colors"
                  >
                    {cat}
                    <span className="text-[10px] text-muted-foreground group-hover:text-accent">
                      {String(count).padStart(2, "0")}
                    </span>
                  </a>
                )
              })}
            </nav>
          )}
        </div>
      </header>

      {/* ─────────── Featured story ─────────── */}
      {featured && (
        <section className="djp-paper border-b border-border/70 px-4 sm:px-8 py-16 lg:py-24">
          <div className="max-w-7xl mx-auto">
            <p className="djp-eyebrow mb-8">Featured Article</p>

            <Link
              href={`/blog/${featured.slug}`}
              className="group grid lg:grid-cols-12 gap-8 lg:gap-14 items-center"
            >
              {featured.cover_image_url && (
                <div className="lg:col-span-7 relative aspect-[4/3] lg:aspect-[5/4] overflow-hidden bg-muted">
                  <NextImage
                    src={featured.cover_image_url}
                    alt={featured.title}
                    fill
                    priority
                    sizes="(max-width: 1024px) 100vw, 58vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 ring-1 ring-inset ring-foreground/5" />
                </div>
              )}
              <article className={featured.cover_image_url ? "lg:col-span-5" : "lg:col-span-12 max-w-3xl"}>
                <div className="flex items-center gap-3 djp-issue-no text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-5">
                  <span className={`${categoryAccent[featured.category]} font-semibold`}>
                    {featured.category}
                  </span>
                  <span aria-hidden>·</span>
                  <time dateTime={featured.published_at ?? featured.created_at}>
                    {formatLong(featured.published_at ?? featured.created_at)}
                  </time>
                  <span aria-hidden>·</span>
                  <span>{readingMinutes(featured.content)} min</span>
                </div>

                <h2
                  className="font-heading font-semibold text-primary tracking-[-0.02em] leading-[1.02] group-hover:text-primary/80 transition-colors"
                  style={{ fontSize: "clamp(2rem, 4.4vw, 3.5rem)" }}
                >
                  {featured.title}
                </h2>

                <p className="mt-6 text-lg leading-relaxed text-muted-foreground line-clamp-4">
                  {featured.excerpt}
                </p>

                <span className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  <span className="border-b border-accent pb-0.5 transition-all group-hover:pb-1.5">
                    Read the article
                  </span>
                  <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </article>
            </Link>
          </div>
        </section>
      )}

      {/* ─────────── Empty state ─────────── */}
      {posts.length === 0 && (
        <section className="djp-paper px-4 sm:px-8 py-24">
          <div className="max-w-2xl mx-auto text-center">
            <p className="djp-eyebrow justify-center">Coming Soon</p>
            <h2 className="mt-6 text-3xl font-heading font-semibold text-primary">
              The press is warming up.
            </h2>
            <p className="mt-4 text-muted-foreground">
              The Performance Journal hasn&apos;t shipped its first article yet.
              Subscribe below and we&apos;ll send it the day it lands.
            </p>
          </div>
        </section>
      )}

      {/* ─────────── Category sections ─────────── */}
      {posts.length > 0 && (
        <div className="djp-paper">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped[cat]
            if (items.length === 0) return null
            return (
              <section
                key={cat}
                id={categoryAnchor(cat)}
                className="djp-category-anchor border-b border-border/70 px-4 sm:px-8 py-20 lg:py-28"
              >
                <div className="max-w-7xl mx-auto">
                  <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 mb-12 lg:mb-16">
                    <div className="lg:col-span-4">
                      <p className="djp-issue-no text-[11px] uppercase tracking-[0.22em] text-accent">
                        Section {String(CATEGORY_ORDER.indexOf(cat) + 1).padStart(2, "0")}
                      </p>
                      <h2
                        className="mt-3 font-heading font-semibold text-primary tracking-[-0.02em] leading-[1]"
                        style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
                      >
                        {cat}
                      </h2>
                      <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-sm">
                        {categoryDeck[cat]}
                      </p>
                    </div>

                    <div className="lg:col-span-8">
                      <ul className="divide-y divide-border/70 border-y border-border/70">
                        {items.map((post, idx) => (
                          <li key={post.id}>
                            <Link
                              href={`/blog/${post.slug}`}
                              className="group grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[3rem_1fr_auto] gap-4 sm:gap-6 py-6 lg:py-8 items-start hover:bg-white/60 transition-colors -mx-4 sm:-mx-6 px-4 sm:px-6"
                            >
                              <span className="djp-issue-no text-xs sm:text-sm font-semibold text-accent pt-1.5">
                                №{String(idx + 1).padStart(2, "0")}
                              </span>

                              <div className="min-w-0">
                                <h3
                                  className="font-heading font-semibold text-primary tracking-[-0.01em] leading-[1.15] group-hover:text-primary/80 transition-colors"
                                  style={{ fontSize: "clamp(1.25rem, 2.2vw, 1.625rem)" }}
                                >
                                  {post.title}
                                </h3>
                                <p className="mt-2 text-sm text-muted-foreground leading-relaxed line-clamp-2 max-w-2xl">
                                  {post.excerpt}
                                </p>
                                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 djp-issue-no text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground">
                                  <time dateTime={post.published_at ?? post.created_at}>
                                    {formatShort(post.published_at ?? post.created_at)}
                                  </time>
                                  <span aria-hidden>·</span>
                                  <span>{readingMinutes(post.content)} min</span>
                                  {post.tags && post.tags.length > 0 && (
                                    <>
                                      <span aria-hidden>·</span>
                                      <span className="truncate max-w-[14rem]">
                                        {post.tags.slice(0, 2).join(" / ")}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {post.cover_image_url && (
                                <div className="hidden sm:block relative size-24 lg:size-28 overflow-hidden bg-muted shrink-0">
                                  <NextImage
                                    src={post.cover_image_url}
                                    alt=""
                                    fill
                                    sizes="120px"
                                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                                  />
                                </div>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ─────────── Closing colophon / CTA strip ─────────── */}
      <section className="bg-primary text-primary-foreground px-4 sm:px-8 py-20 lg:py-28 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, rgba(196,155,122,0.6), transparent 40%), radial-gradient(circle at 80% 70%, rgba(196,155,122,0.4), transparent 45%)",
          }}
        />
        <div className="max-w-5xl mx-auto relative">
          <div className="grid lg:grid-cols-12 gap-10 items-end">
            <div className="lg:col-span-7">
              <p className="djp-eyebrow text-accent">─ Colophon</p>
              <h2
                className="mt-4 font-heading font-semibold tracking-[-0.02em] leading-[1.02]"
                style={{ fontSize: "clamp(2rem, 4.5vw, 3.5rem)" }}
              >
                If the writing resonates, the coaching will too.
              </h2>
            </div>
            <div className="lg:col-span-5 lg:pl-8 lg:border-l lg:border-white/15">
              <p className="text-base lg:text-[17px] leading-relaxed text-primary-foreground/80">
                The Performance Journal is the public-facing edge of how we coach
                inside the program. If a personalized version is what you&apos;re
                after, the door is open.
              </p>
              <Link
                href="/contact"
                className="group mt-6 inline-flex items-center gap-2 bg-accent text-accent-foreground px-7 py-3.5 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all"
              >
                Book a free consultation
                <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
