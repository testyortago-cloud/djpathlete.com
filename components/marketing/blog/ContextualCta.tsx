import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
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

  if (program) {
    return (
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">{program.name}</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Ready to put this into a program?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">{program.pitch}</p>
            <Link
              href={program.url}
              className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
            >
              Explore {program.name}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </FadeIn>
      </section>
    )
  }

  return (
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
  )
}
