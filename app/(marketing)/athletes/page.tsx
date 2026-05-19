import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Plane, GraduationCap, Sparkles, HeartPulse } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { AuthorCard } from "@/components/shared/AuthorCard"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import { SITE_URL } from "@/lib/constants"

export const metadata: Metadata = {
  title: "Sports Performance Training for Every Stage of Athlete",
  description:
    "Sports performance training for professional, collegiate, youth and return-to-sport athletes. Strength training, speed training and sport-specific training by Darren J Paul, PhD.",
  alternates: { canonical: "/athletes" },
  openGraph: {
    title: "Sports Performance Training for Every Stage of Athlete | DJP Athlete",
    description:
      "One training system, four stages: professional, collegiate, youth, return-to-sport. By Darren J Paul, PhD.",
    type: "website",
    url: `${SITE_URL}/athletes`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Performance Training for Every Stage of Athlete | DJP Athlete",
    description:
      "One training system, four stages: professional, collegiate, youth, return-to-sport.",
  },
}

// One page, one URL, one FAQPage / WebPage entity for crawlers.
const webPageSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Sports Performance Training for Every Stage of Athlete",
  url: `${SITE_URL}/athletes`,
  description:
    "Sports performance training for professional, collegiate, youth and return-to-sport athletes.",
  isPartOf: { "@type": "WebSite", name: "DJP Athlete", url: SITE_URL },
  about: [
    { "@type": "PeopleAudience", audienceType: "Professional athletes" },
    { "@type": "PeopleAudience", audienceType: "Collegiate and competitive amateur athletes" },
    { "@type": "PeopleAudience", audienceType: "Youth athletes in long-term development" },
    { "@type": "PeopleAudience", audienceType: "Athletes returning from injury" },
  ],
  speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1"] },
}

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What athletes do you train?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Four stages: professional athletes (touring pros across rotational and racquet sports), collegiate and competitive amateur athletes, youth athletes in long-term athletic development, and athletes returning from injury who have been cleared by a clinician but are not yet competition-ready. The same five-pillar training framework runs each stage, scaled to training age, sport and calendar.",
      },
    },
    {
      "@type": "Question",
      name: "Is strength training safe for young athletes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, when supervised and age-appropriate. The National Strength and Conditioning Association's position is that properly designed and supervised youth resistance training is safe, effective and beneficial. It does not stunt growth. Programmed correctly, it is one of the most effective injury-prevention tools available to young athletes.",
      },
    },
    {
      "@type": "Question",
      name: "How long after an ACL reconstruction can I return to sport?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Research published in the Journal of Orthopaedic & Sports Physical Therapy (2020) shows that returning to level-1 cutting and pivoting sport before 9 months after ACL reconstruction is associated with roughly a 7-fold higher rate of a second ACL injury. Each month of delay beyond that reduces reinjury risk by approximately 51 percent. Return-to-performance training runs alongside that timeline, not against it.",
      },
    },
    {
      "@type": "Question",
      name: "Should youth athletes specialize in one sport early?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Generally no. The 2016 American Orthopaedic Society for Sports Medicine consensus on early sport specialization concluded there is no evidence that early specialization benefits young athletes in the majority of sports, and that it is associated with increased overuse injury and burnout. Multi-sport participation through the early teens is the better long-term path.",
      },
    },
    {
      "@type": "Question",
      name: "Can a touring professional be trained remotely?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Online training is built around the realities of touring: travel, time zones, tournament density and the equipment available at the venue. Programming adjusts weekly to load and wellness markers, with video feedback and direct coach access. WTA professionals already train in this format.",
      },
    },
    {
      "@type": "Question",
      name: "How is sports performance training different from a personal trainer?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A personal trainer programs around general fitness. A sports performance coach programs around a sport — starting with diagnostics on force production, asymmetry, movement quality and sport-specific output, then building an individualized training plan that adjusts to load and wellness over time. Different goal, different toolset.",
      },
    },
  ],
}

interface Stage {
  id: string
  name: string
  icon: typeof Plane
  h2: string
  summary: string
  pillars: [string, string, string]
}

// Four stages, one framework, one page. Copy is intentionally summary-length —
// crawlable and AI-extractable without restating the same training principles
// four times.
const STAGES: Stage[] = [
  {
    id: "professional",
    name: "Professional",
    icon: Plane,
    h2: "Performance training for professional athletes",
    summary:
      "Year-round, individualized training built around touring reality: travel, time zones, tournament density and in-season load. Programming adjusts weekly to wellness markers and the equipment available at the venue. Already used by WTA professionals and professional pickleball players among the 500+ athletes coached.",
    pillars: [
      "Travel-friendly programming that moves with the schedule",
      "In-season load monitoring with weekly programming changes",
      "Career longevity prioritized over short peak windows",
    ],
  },
  {
    id: "collegiate",
    name: "Collegiate & competitive amateur",
    icon: GraduationCap,
    h2: "Sports performance training for collegiate and competitive amateur athletes",
    summary:
      "A diagnostic-driven training plan instead of a roster template. Force production, asymmetry, movement quality and sport-specific output measured first, then strength training and speed training periodized across off-season, pre-season, in-season and post-season blocks. Works alongside school strength staff where they exist, not around them.",
    pillars: [
      "Diagnostic baseline before the program is written",
      "Year-round periodization built around the sport calendar",
      "Strength training that transfers to sprint speed, change of direction and rotational power",
    ],
  },
  {
    id: "youth",
    name: "Youth & long-term development",
    icon: Sparkles,
    h2: "Youth athletic performance training and long-term development",
    summary:
      "Strength training, movement quality and speed work programmed around training age and maturity, not chronological age. The NSCA's position is that supervised, age-appropriate resistance training is safe and effective for young athletes — and is one of the most effective injury-prevention tools available. Multi-sport participation is encouraged through the early teens; early single-sport specialization is not.",
    pillars: [
      "Age and stage-appropriate progression",
      "Movement quality, deceleration and change of direction trained from the foundation",
      "Long-term athletic development that protects the ceiling, not eight-week peaks",
    ],
  },
  {
    id: "return-to-sport",
    name: "Return to sport",
    icon: HeartPulse,
    h2: "Return-to-performance training for athletes coming back from injury",
    summary:
      "The bridge between medical clearance and competition readiness. Force production, single-leg asymmetry, reactive strength and sport-specific output are measured, then closed with structured strength training and progressive reactive loading. Works alongside the clinical team; does not replace physiotherapy.",
    pillars: [
      "Return-to-performance assessment before the rebuild starts",
      "Asymmetry-targeted strength training programmed from data",
      "Progressive reactive and sport-specific reintegration",
    ],
  },
]

export default function AthletesHubPage() {
  return (
    <>
      <JsonLd data={webPageSchema} />
      <JsonLd data={faqSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Athletes", url: "/athletes" },
        ]}
      />

      {/* ─────────────── Hero ─────────────── */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-32 sm:px-8 lg:pb-24 lg:pt-40">
          <FadeIn>
            <div className="flex items-center gap-3">
              <div className="h-px w-10 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
                Athletes
              </span>
            </div>
            <h1 className="mt-6 font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Sports performance training
              <br />
              <span className="text-accent">for every stage of athlete.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-primary-foreground/75 sm:text-lg">
              Professional. Collegiate. Youth. Coming back from injury. The same training
              framework runs each stage, scaled to training age, sport and calendar.
            </p>
          </FadeIn>
        </div>
      </section>


      {/* ─────────────── Four stages ─────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="mb-12 max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                The four stages
              </span>
            </div>
            <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              One training system, scaled to where you actually are.
            </h2>
          </div>
        </FadeIn>

        <div className="grid gap-6 md:grid-cols-2">
          {STAGES.map((stage, i) => {
            const Icon = stage.icon
            return (
              <FadeIn key={stage.id} delay={i * 0.08}>
                <article
                  id={stage.id}
                  className="h-full rounded-2xl border border-border bg-white p-6 sm:p-7"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-primary/[0.07]">
                      <Icon className="size-5 text-primary" strokeWidth={1.8} aria-hidden />
                    </div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent">
                      {stage.name}
                    </p>
                  </div>
                  <h3 className="mt-4 font-heading text-xl font-semibold tracking-tight text-primary sm:text-2xl">
                    {stage.h2}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                    {stage.summary}
                  </p>
                  <ul className="mt-5 space-y-2">
                    {stage.pillars.map((p) => (
                      <li
                        key={p}
                        className="flex items-start gap-2 text-sm leading-6 text-foreground"
                      >
                        <span
                          aria-hidden
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                        />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </FadeIn>
            )
          })}
        </div>
      </section>

      {/* ─────────────── Coach (E-E-A-T) ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="mb-6 flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                Who trains every stage
              </span>
            </div>
            <AuthorCard variant="full" />
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── FAQ (fact-checked) ─────────────── */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-8 lg:py-20">
        <FadeIn>
          <div className="mb-8 flex items-center gap-3">
            <div className="h-px w-8 bg-accent" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
              Common questions
            </span>
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
            Questions athletes and parents actually ask.
          </h2>
        </FadeIn>

        <dl className="mt-10 divide-y divide-border">
          {faqSchema.mainEntity.map((q, i) => (
            <FadeIn key={q.name} delay={i * 0.04}>
              <div className="py-6">
                <dt className="font-heading text-lg font-semibold text-primary">{q.name}</dt>
                <dd className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                  {q.acceptedAnswer.text}
                </dd>
              </div>
            </FadeIn>
          ))}
        </dl>
      </section>

      {/* ─────────────── Footer CTA ─────────────── */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 lg:py-20">
          <FadeIn>
            <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              Trained the way you should be trained.
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-primary-foreground/75">
              Apply for sports performance training with Darren J Paul, PhD. We reply within 48 hours.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href="/in-person">
                  Tampa Bay, in-person
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Link href="/online">
                  Worldwide, online
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  )
}
