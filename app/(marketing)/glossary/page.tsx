import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, ChevronRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"

export const metadata: Metadata = {
  title: "Sports Performance Glossary",
  description:
    "Definitions of sports performance terms used at DJP Athlete: the Grey Zone, Five Pillar Framework, return-to-performance, capacity, readiness, autoregulation, force production, and more.",
  alternates: { canonical: "/glossary" },
  openGraph: {
    title: "Sports Performance Glossary | DJP Athlete",
    description:
      "Definitions of the methodology terms used by Darren J Paul, PhD — the Grey Zone, Five Pillar Framework, return-to-performance, capacity, readiness, and more.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Performance Glossary | DJP Athlete",
    description:
      "Definitions of the methodology terms used at DJP Athlete: the Grey Zone, Five Pillar Framework, return-to-performance, capacity, readiness, and more.",
  },
}

interface Term {
  id: string
  term: string
  alsoKnownAs?: string[]
  category: "Methodology" | "Diagnostics" | "Programming" | "Recovery & Readiness" | "Athletic Development"
  definition: string
  inPracticeAt?: { label: string; href: string }
}

/**
 * Glossary entries — each becomes a `DefinedTerm` JSON-LD entry inside a
 * `DefinedTermSet`. Per the ai-seo skill, AI engines weight definitional
 * content heavily for "what is X" queries.
 *
 * Definitions are 50-90 words each — matched to the 50-60 word
 * "nuggetization" passage length AI Overviews extract.
 */
const TERMS: Term[] = [
  {
    id: "the-grey-zone",
    term: "The Grey Zone",
    category: "Methodology",
    definition:
      "Darren J Paul's coaching philosophy. The Grey Zone refers to the space between textbook training protocols and real-world performance demands — where adaptation actually happens. The framework rejects training in extremes (all-out or rest, rigid protocol or no structure) in favor of context-aware decision-making informed by daily readiness data, video review, and coach observation.",
    inPracticeAt: { label: "Read the Grey Zone philosophy", href: "/philosophy" },
  },
  {
    id: "five-pillar-framework",
    term: "Five Pillar Framework",
    category: "Methodology",
    definition:
      "DJP Athlete's coaching methodology. Five interconnected pillars structure every program: (1) Assessment & Diagnostics, (2) Individualized Programming, (3) Load & Readiness Monitoring, (4) Technical Coaching & Feedback, (5) Long-Term Athlete Development. Each pillar feeds the next; no pillar runs in isolation.",
    inPracticeAt: { label: "See the framework", href: "/philosophy" },
  },
  {
    id: "return-to-performance",
    term: "Return-to-Performance",
    alsoKnownAs: ["RTP", "Return-to-Sport Performance Phase"],
    category: "Methodology",
    definition:
      "The bridge between medical clearance and competition readiness. Distinct from clinical rehab — which ends at clearance — return-to-performance ends when an athlete is verifiably ready to compete at full intensity. The phase restores capacity, reintegrates speed and power, and rebuilds confidence to compete. Most reinjuries happen in this gap because clinical milestones do not equal competition readiness.",
    inPracticeAt: { label: "See the assessment process", href: "/assessment" },
  },
  {
    id: "supervised-system",
    term: "Supervised System",
    category: "Methodology",
    definition:
      "DJP Athlete's positioning contrast: a coach-overseen, application-only program — explicit alternative to self-service training apps and template-based programming. Every athlete's plan is built from assessment data, monitored continuously, and adjusted in real time by the coach. Used to describe both online and in-person coaching, since both share the same supervised methodology.",
  },
  {
    id: "performance-blueprint",
    term: "Performance Blueprint",
    category: "Programming",
    definition:
      "The structured plan built from a specific athlete's assessment data. The Blueprint defines training priorities, periodization, measurable targets, and reassessment milestones. It travels with the athlete across formats — an athlete moving from in-person to online coaching keeps the same Blueprint, with delivery details adapting.",
  },
  {
    id: "capacity",
    term: "Capacity",
    category: "Athletic Development",
    definition:
      "Trainable, durable physical qualities the athlete can rely on under competition stress. Capacity covers strength, force production, repeated-effort tolerance, change-of-direction durability, and reactive control. Distinct from readiness (a daily state), capacity is built over training blocks and remains stable across days. The goal of long-term programming is capacity that holds when readiness is low.",
  },
  {
    id: "readiness",
    term: "Readiness",
    category: "Recovery & Readiness",
    definition:
      "The athlete's day-to-day state of fatigue, recovery, and load tolerance. Readiness drives daily training decisions — when to push, when to cut volume, when to swap modalities. Tracked via wellness markers (HRV, sleep duration and quality, sRPE), session metrics, and subjective check-ins. Distinct from capacity, which is the underlying physical quality.",
  },
  {
    id: "autoregulation",
    term: "Autoregulation",
    category: "Programming",
    definition:
      "The practice of adjusting daily training load based on the athlete's current readiness rather than rigid pre-written prescriptions. Autoregulation tools include RPE-based load selection, velocity-based training cutoffs, and wellness-driven volume changes. Used at DJP Athlete to make programs robust to travel, in-season demand, and post-injury recovery.",
  },
  {
    id: "force-platform-testing",
    term: "Force Platform Testing",
    alsoKnownAs: ["Force Plate Testing"],
    category: "Diagnostics",
    definition:
      "An instrumented assessment of how an athlete produces ground reaction force. Outputs include peak force, rate of force development, eccentric/concentric work, and left/right asymmetry under load. Used at DJP Athlete to identify capacity gaps and risk asymmetries that visual screens miss — particularly in return-to-performance work after lower-limb injury.",
    inPracticeAt: { label: "See assessment instruments", href: "/assessment" },
  },
  {
    id: "long-term-athlete-development",
    term: "Long-Term Athlete Development",
    alsoKnownAs: ["LTAD"],
    category: "Athletic Development",
    definition:
      "A multi-year approach to building robust, adaptable athletes — distinct from chasing short-term performance peaks at the expense of long-term capacity. LTAD respects developmental stage (especially for youth athletes), prioritizes movement quality before specialization, and structures training across competitive seasons rather than within a single phase.",
  },
  {
    id: "load-monitoring",
    term: "Load & Readiness Monitoring",
    category: "Recovery & Readiness",
    definition:
      "Continuous tracking of training load, wellness markers, and performance indicators across days and weeks. At DJP Athlete, monitoring informs whether the athlete should progress, hold, or regress on a given session. Inputs: HRV, sleep, sRPE, training volume, video review, and reactive testing. The aim is data-informed decisions, not assumption-based ones.",
  },
  {
    id: "athlete-tier",
    term: "Serious Athlete",
    category: "Methodology",
    definition:
      "DJP Athlete's audience definition: athletes whose goals, time commitment, and intent justify supervised, assessment-driven coaching. Includes high school, collegiate, semi-professional, and professional competitors; elite youth athletes in long-term development; post-injury return-to-performance athletes; and high-performing professionals who train with athletic intent. Explicitly excludes recreational fitness clients.",
  },
]

const CATEGORIES: Term["category"][] = [
  "Methodology",
  "Diagnostics",
  "Programming",
  "Recovery & Readiness",
  "Athletic Development",
]

const definedTermSetSchema = {
  "@context": "https://schema.org",
  "@type": "DefinedTermSet",
  "@id": "https://www.darrenjpaul.com/glossary#defined-term-set",
  name: "DJP Athlete Sports Performance Glossary",
  url: "https://www.darrenjpaul.com/glossary",
  description: "Definitions of methodology and diagnostic terms used in sports performance coaching at DJP Athlete.",
  hasDefinedTerm: TERMS.map((t) => ({
    "@type": "DefinedTerm",
    "@id": `https://www.darrenjpaul.com/glossary#${t.id}`,
    name: t.term,
    alternateName: t.alsoKnownAs,
    description: t.definition,
    url: `https://www.darrenjpaul.com/glossary#${t.id}`,
    inDefinedTermSet: "https://www.darrenjpaul.com/glossary#defined-term-set",
  })),
}

export default function GlossaryPage() {
  return (
    <>
      <JsonLd data={definedTermSetSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Glossary", url: "/glossary" },
        ]}
      />

      {/* Hero */}
      <section className="pt-32 pb-12 lg:pt-40 lg:pb-16 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Glossary</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              Sports performance, defined.
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              The methodology terms, diagnostic concepts, and developmental ideas behind every DJP Athlete program — in
              clear language. Use this as a reference when reading service pages or talking with the coach.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Category navigation */}
      <section className="px-4 sm:px-8 pb-8">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <nav aria-label="Glossary categories" className="flex flex-wrap gap-2 justify-center">
              {CATEGORIES.map((cat) => {
                const slug = cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")
                return (
                  <a
                    key={cat}
                    href={`#category-${slug}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                  >
                    {cat}
                    <ChevronRight className="size-3.5" />
                  </a>
                )
              })}
            </nav>
          </FadeIn>
        </div>
      </section>

      {/* Glossary by category */}
      <section className="px-4 sm:px-8 pb-16 lg:pb-24">
        <div className="max-w-4xl mx-auto space-y-16">
          {CATEGORIES.map((cat) => {
            const slug = cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")
            const inCategory = TERMS.filter((t) => t.category === cat)
            if (inCategory.length === 0) return null
            return (
              <div key={cat} id={`category-${slug}`} className="scroll-mt-32">
                <FadeIn>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px w-12 bg-accent" />
                    <p className="text-xs font-medium text-accent uppercase tracking-widest">{cat}</p>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-8">
                    {cat}
                  </h2>
                </FadeIn>

                <dl className="space-y-4">
                  {inCategory.map((t, i) => (
                    <FadeIn key={t.id} delay={i * 0.04}>
                      <article id={t.id} className="rounded-2xl border border-border bg-white p-6 scroll-mt-32">
                        <dt>
                          <h3 className="text-lg sm:text-xl font-heading font-semibold text-primary mb-1">
                            {t.term}
                          </h3>
                          {t.alsoKnownAs && t.alsoKnownAs.length > 0 && (
                            <p className="text-xs text-muted-foreground italic mb-2">
                              Also known as: {t.alsoKnownAs.join(", ")}
                            </p>
                          )}
                        </dt>
                        <dd className="text-sm sm:text-base text-muted-foreground leading-relaxed">{t.definition}</dd>
                        {t.inPracticeAt && (
                          <p className="mt-3">
                            <Link
                              href={t.inPracticeAt.href}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
                            >
                              {t.inPracticeAt.label}
                              <ArrowRight className="size-3.5" />
                            </Link>
                          </p>
                        )}
                      </article>
                    </FadeIn>
                  ))}
                </dl>
              </div>
            )
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <FadeIn className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            See these concepts applied.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            The glossary is a reference. The work is the program. If you&apos;re ready to see how the framework runs for
            a specific athlete, the next step is a conversation.
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
