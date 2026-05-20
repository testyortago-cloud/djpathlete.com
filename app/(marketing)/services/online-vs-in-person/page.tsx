import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, MapPin, Globe } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { TrustStrip } from "@/components/public/TrustStrip"

export const metadata: Metadata = {
  title: "Online vs In-Person Sports Performance Coaching",
  description:
    "Online vs in-person sports performance coaching, compared. Methodology, equipment, supervision, fit by athlete type, and pricing — at DJP Athlete in Tampa Bay, FL.",
  alternates: { canonical: "/services/online-vs-in-person" },
  openGraph: {
    title: "Online vs In-Person Sports Performance Coaching | DJP Athlete",
    description:
      "Side-by-side comparison of online and in-person sports performance coaching: methodology, who each fits, equipment, and outcomes.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Online vs In-Person Sports Performance Coaching | DJP Athlete",
    description:
      "Side-by-side comparison of online and in-person sports performance coaching: methodology, who each fits, and outcomes.",
  },
}

const comparePageSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Online vs In-Person Sports Performance Coaching",
  url: "https://www.darrenjpaul.com/services/online-vs-in-person",
  description:
    "Side-by-side comparison of online and in-person sports performance coaching at DJP Athlete: methodology, equipment, supervision, fit by athlete type, and outcomes.",
  about: [
    { "@type": "Service", name: "Online Sports Performance Coaching" },
    { "@type": "Service", name: "In-Person Sports Performance Coaching" },
  ],
  isPartOf: {
    "@type": "WebSite",
    name: "DJP Athlete",
    url: "https://www.darrenjpaul.com",
  },
}

export default function OnlineVsInPersonPage() {
  return (
    <>
      <JsonLd data={comparePageSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Services", url: "/services" },
          { name: "Online vs In-Person", url: "/services/online-vs-in-person" },
        ]}
      />

      {/* Hero */}
      <section className="pt-32 pb-12 lg:pt-40 lg:pb-16 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Compare</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              Online vs In-Person Coaching, Compared.
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Same methodology. Different delivery. Below is a direct comparison so athletes (and parents, agents, and
              physiotherapists) can pick the right path.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Semantic Answer Block (AEO) */}
      <SemanticAnswerBlock
        eyebrow="Quick answer"
        question="Online vs in-person sports performance coaching — which is better?"
        answer="Both formats deliver the same diagnostic-driven Five Pillar Framework methodology under Darren J Paul, PhD. In-person coaching at our Zephyrhills, Florida facility is preferred when real-time cueing, on-site instrumentation (force plates, motion capture, sprint timing), or post-injury supervision is the deciding factor — and is the strongest fit for return-to-performance phases and Tampa Bay-area youth athletes. Online coaching is preferred for touring professionals, collegiate athletes balancing in-season travel, athletes outside Florida, and high-performing professionals with demanding schedules. Outcomes converge when the online athlete has access to a well-equipped gym and engages with daily wellness logging, weekly video review, and direct messaging. Athletes routinely switch between formats as life and competition circumstances change."
      />

      {/* Format-at-a-glance */}
      <section className="py-16 lg:py-20 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-6">
            <FadeIn direction="left">
              <div className="rounded-2xl border border-border bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="size-5 text-accent" aria-hidden />
                  <p className="text-xs font-medium text-accent uppercase tracking-widest">In-Person</p>
                </div>
                <h2 className="text-xl font-heading font-semibold text-primary mb-2">
                  Tampa Bay, Florida.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Coach-led, on-site, instrumented. Best for return-to-performance, youth long-term development, and
                  athletes within driving range of Zephyrhills.
                </p>
                <Link
                  href="/in-person"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
                >
                  See in-person coaching
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </FadeIn>

            <FadeIn direction="right">
              <div className="rounded-2xl border border-border bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="size-5 text-accent" aria-hidden />
                  <p className="text-xs font-medium text-accent uppercase tracking-widest">Online</p>
                </div>
                <h2 className="text-xl font-heading font-semibold text-primary mb-2">
                  Worldwide. Coach-led.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Application-only, supervised remote system. Best for touring pros, traveling athletes, collegiates in
                  season, and high-performing professionals.
                </p>
                <Link
                  href="/online"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
                >
                  See online coaching
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* FAQs (CMS-managed) */}
      <ManagedFaqSection
        pageKey="services/online-vs-in-person"
        variant="cards"
        eyebrow="Common questions"
        title="Frequently asked"
      />

      {/* Trust strip + CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <FadeIn>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold tracking-tight mb-4">
              Still deciding? Apply once — we&apos;ll recommend the right path.
            </h2>
            <p className="text-lg text-primary-foreground/80 leading-relaxed mb-8">
              The application asks the questions we use to recommend in-person, online, or a hybrid path. No commitment
              until we&apos;ve agreed on fit.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
              <Link
                href="/online#apply"
                className="inline-flex items-center gap-2 bg-accent text-primary px-8 py-4 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all hover:shadow-md group"
              >
                Apply for coaching
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 border border-primary-foreground/30 text-primary-foreground px-8 py-4 rounded-full text-sm font-medium hover:bg-primary-foreground/5 transition-all"
              >
                Book free 15-min consultation
              </Link>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <TrustStrip variant="compact" className="text-primary-foreground/70" />
          </FadeIn>
        </div>
      </section>
    </>
  )
}
