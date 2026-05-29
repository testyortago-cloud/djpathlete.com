import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"

export const metadata: Metadata = {
  title: "FAQ — Sports Performance Coaching Questions",
  description:
    "Answers to common questions about sports performance coaching, online vs in-person training, and return-to-performance assessment.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ — Sports Performance Coaching Questions | DJP Athlete",
    description:
      "Common questions about sports performance coaching, online and in-person training, and return-to-performance assessment.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ — Sports Performance Coaching Questions | DJP Athlete",
    description:
      "Common questions about sports performance coaching, online and in-person training, and return-to-performance assessment.",
  },
}

export default function FAQPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "FAQ", url: "/faq" },
        ]}
      />

      {/* Hero */}
      <section className="pt-32 pb-12 lg:pt-40 lg:pb-16 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">FAQ</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              Sports performance coaching, answered.
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Common questions about online and in-person coaching and the return-to-performance phase. If yours
              isn&apos;t here, the application form is the next step.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* FAQs (CMS-managed) */}
      <ManagedFaqSection
        pageKey="faq"
        variant="cards"
        eyebrow="FAQ"
        title="Questions, answered."
        className="max-w-4xl pb-16 lg:pb-24"
      />

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <FadeIn className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            Question not here?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Book a free 15-minute consultation. We&apos;ll answer it directly.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md group"
          >
            Book Free Consultation
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </FadeIn>
      </section>
    </>
  )
}
