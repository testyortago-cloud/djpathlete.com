import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { findRelevantProgram } from "@/lib/blog/program-catalog"
import type { BlogPost } from "@/types/database"

interface ContextualCtaProps {
  post: BlogPost
}

/**
 * Renders the bottom-of-post CTA. When a program from the catalog matches
 * the post's tags / title / primary_keyword, the CTA points at the program.
 * Otherwise it falls back to the generic consultation copy.
 */
export function ContextualCta({ post }: ContextualCtaProps) {
  const program = findRelevantProgram({
    tags: post.tags,
    title: post.title,
    excerpt: post.excerpt,
    primary_keyword: post.primary_keyword,
  })

  const headline = program ? "Ready to put this into a program?" : "Ready to take your performance seriously?"
  const eyebrow = program ? `─ ${program.name}` : "─ Work with us"
  const body = program
    ? program.pitch
    : "If this article resonated, imagine what a coaching relationship built around your specific data, sport, and constraints could achieve."
  const cta = program ? `Explore ${program.name}` : "Book a free consultation"
  const href = program ? program.url : "/contact"

  return (
    <section className="relative bg-primary text-primary-foreground overflow-hidden px-4 sm:px-8 py-20 lg:py-28">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(196,155,122,0.7), transparent 38%), radial-gradient(circle at 85% 75%, rgba(196,155,122,0.45), transparent 45%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(196,155,122,0.6), transparent)",
        }}
      />

      <div className="max-w-5xl mx-auto relative">
        <div className="grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-7">
            <p className="djp-eyebrow text-accent">{eyebrow}</p>
            <h2
              className="mt-4 font-heading font-semibold tracking-[-0.02em] leading-[1.02]"
              style={{ fontSize: "clamp(2rem, 4.4vw, 3.25rem)" }}
            >
              {headline}
            </h2>
          </div>
          <div className="lg:col-span-5 lg:pl-8 lg:border-l lg:border-white/15">
            <p className="text-base lg:text-[17px] leading-relaxed text-primary-foreground/85">
              {body}
            </p>
            <Link
              href={href}
              className="group mt-7 inline-flex items-center gap-2 bg-accent text-accent-foreground px-7 py-3.5 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all"
            >
              {cta}
              <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
