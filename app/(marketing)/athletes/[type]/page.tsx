import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, Quote, Target } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { TrustStrip } from "@/components/public/TrustStrip"
import { GoogleReviewsBadge } from "@/components/public/GoogleReviewsBadge"
import { TampaBayServiceArea, TAMPA_BAY_CITIES } from "@/components/public/TampaBayServiceArea"
import { AuthorCard } from "@/components/shared/AuthorCard"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import { SITE_URL } from "@/lib/constants"
import { DJP_AUTHOR_ID } from "@/lib/brand/author"
import { ATHLETES, getAthleteAudienceBySlug } from "@/lib/data/athletes"

interface Props {
  params: Promise<{ type: string }>
}

export function generateStaticParams() {
  return ATHLETES.map((a) => ({ type: a.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params
  const audience = getAthleteAudienceBySlug(type)
  if (!audience) return {}
  const pageUrl = `${SITE_URL}/athletes/${audience.slug}`
  return {
    title: audience.h1.length > 60 ? `${audience.name} Athletes — Performance Coaching` : audience.h1,
    description: audience.description,
    alternates: { canonical: `/athletes/${audience.slug}` },
    openGraph: {
      title: `${audience.h1} | DJP Athlete`,
      description: audience.description,
      type: "website",
      url: pageUrl,
    },
    twitter: {
      card: "summary_large_image",
      title: `${audience.h1} | DJP Athlete`,
      description: audience.description,
    },
  }
}

export default async function AthleteAudiencePage({ params }: Props) {
  const { type } = await params
  const audience = getAthleteAudienceBySlug(type)
  if (!audience) notFound()

  const pageUrl = `${SITE_URL}/athletes/${audience.slug}`
  const isoDateModified = new Date().toISOString()

  // Sister audiences for cross-link block (everyone except current).
  const sister = ATHLETES.filter((a) => a.slug !== audience.slug)

  // ── Schema: WebPage + Service + HowTo + FAQPage ──────────────────────────
  const webPageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: audience.h1,
    description: audience.description,
    inLanguage: "en-US",
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}#website`, url: SITE_URL, name: "DJP Athlete" },
    primaryImageOfPage: { "@type": "ImageObject", url: `${SITE_URL}/images/gym-training-01.jpg` },
    speakable: { "@type": "SpeakableSpecification", cssSelector: [".speakable-answer", "h1"] },
    audience: { "@type": "PeopleAudience", audienceType: audience.audienceType },
    dateModified: isoDateModified,
  }

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${pageUrl}#service`,
    name: audience.h1,
    description: audience.description,
    url: pageUrl,
    serviceType: `Sports performance coaching for ${audience.name.toLowerCase()} athletes`,
    category: "Sports performance coaching",
    provider: {
      "@type": "Organization",
      "@id": `${SITE_URL}/#localbusiness`,
      name: "DJP Athlete",
      url: SITE_URL,
    },
    performer: { "@type": "Person", "@id": DJP_AUTHOR_ID },
    areaServed: [
      ...TAMPA_BAY_CITIES.map((name) => ({ "@type": "Place", name })),
      { "@type": "Place", name: "Tampa Bay Area" },
      { "@type": "Place", name: "Worldwide (online)" },
    ],
    audience: { "@type": "PeopleAudience", audienceType: audience.audienceType },
    mainEntityOfPage: { "@id": `${pageUrl}#webpage` },
    dateModified: isoDateModified,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `Coaching formats for ${audience.name.toLowerCase()} athletes`,
      itemListElement: [
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: `In-person sports performance training (Tampa Bay)`,
            url: `${SITE_URL}/in-person`,
          },
        },
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: `Online sports performance coaching`,
            url: `${SITE_URL}/online`,
          },
        },
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: `Return-to-performance assessment`,
            url: `${SITE_URL}/assessment`,
          },
        },
      ],
    },
  }

  const howToSchema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How DJP Athlete coaches ${audience.name.toLowerCase()} athletes`,
    description: `The five-pillar process applied to ${audience.audienceType.toLowerCase()}: assessment, individualized programming, load monitoring, technical coaching and long-term development.`,
    totalTime: "P12W",
    step: [
      {
        "@type": "HowToStep",
        position: 1,
        name: "Assessment",
        text: `Diagnostic of force production, asymmetry, movement quality and sport-specific outputs for the athlete. The plan is built from that picture, not from a template.`,
      },
      {
        "@type": "HowToStep",
        position: 2,
        name: "Individualized programming",
        text: `Volume, intensity, exercise selection and progression tailored to this athlete's sport demands, training history and current outputs.`,
      },
      {
        "@type": "HowToStep",
        position: 3,
        name: "Load monitoring",
        text: "Sessions tracked against intent. Training load adjusted week to week to wellness markers, competition density and recovery status.",
      },
      {
        "@type": "HowToStep",
        position: 4,
        name: "Technical coaching",
        text: "Every lift, sprint and drill coached. Cues, video, feedback. Reps that change the picture, not reps that fill the hour.",
      },
      {
        "@type": "HowToStep",
        position: 5,
        name: "Long-term development",
        text: `The plan looks at the season, the calendar and the next two to four years. Sustainable output is the standard.`,
      },
    ],
  }

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: audience.faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  }

  return (
    <>
      <JsonLd data={webPageSchema} />
      <JsonLd data={serviceSchema} />
      <JsonLd data={howToSchema} />
      <JsonLd data={faqSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Athletes", url: "/athletes" },
          { name: audience.name, url: `/athletes/${audience.slug}` },
        ]}
      />

      {/* ─────────────── Hero ─────────────── */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 80% 15%, oklch(0.70 0.08 60 / 0.4), transparent 45%), linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "auto, 72px 72px, 72px 72px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-32 sm:px-8 lg:pb-24 lg:pt-40">
          <FadeIn>
            <div className="flex items-center gap-3">
              <div className="h-px w-10 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
                Athletes · {audience.name}
              </span>
            </div>
            <h1 className="mt-6 font-heading text-3xl font-semibold leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
              {audience.h1}
            </h1>
            <p className="mt-5 max-w-2xl font-heading text-lg font-medium leading-snug text-primary-foreground/90 sm:text-xl">
              {audience.hook}
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-primary-foreground/70 sm:text-lg">
              {audience.cardTagline}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href={audience.primaryCta.href}>
                  {audience.primaryCta.label}
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Link href={audience.secondaryCta.href}>
                  {audience.secondaryCta.label}
                  <ChevronRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── AEO answer block (speakable) ─────────────── */}
      <SemanticAnswerBlock
        eyebrow="What this is"
        question={audience.answerQuestion}
        answer={audience.answer}
        className="speakable-answer"
      />

      {/* ─────────────── What we develop ─────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="flex items-center gap-3">
            <Target className="size-4 text-accent" aria-hidden />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
              What we build
            </span>
          </div>
          <h2
            id="what-we-build"
            className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl"
          >
            The four things that decide outcomes for {audience.name.toLowerCase()} athletes.
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
            Programmed from the diagnostic. Built around your situation, not bolted onto a template.
          </p>
          <ol className="mt-10 grid gap-6 md:grid-cols-2">
            {audience.qualities.map((q, i) => (
              <li
                key={q.title}
                className="relative rounded-2xl border border-border bg-white p-6 sm:p-7"
              >
                <div className="absolute right-5 top-5 font-heading text-3xl font-semibold tabular-nums text-accent/30">
                  0{i + 1}
                </div>
                <h3 className="font-heading text-xl font-semibold text-primary">{q.title}</h3>
                <p className="mt-3 leading-7 text-muted-foreground">{q.body}</p>
              </li>
            ))}
          </ol>
        </FadeIn>
      </section>

      {/* ─────────────── How we coach it (Five Pillar) ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                How we coach it
              </span>
            </div>
            <h2
              id="how-we-coach-it"
              className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl"
            >
              The Five Pillar Framework, applied to {audience.name.toLowerCase()} athletes.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Every program at DJP Athlete runs the same five-pillar logic. For {audience.name.toLowerCase()} athletes,
              the pillars look like this:
            </p>
            <dl className="mt-8 space-y-5">
              <FivePillar
                n="01"
                name="Assessment"
                body={`A clear picture of where the athlete sits on force production, asymmetry, movement quality and sport-specific outputs. The plan is built from that picture.`}
              />
              <FivePillar
                n="02"
                name="Individualized programming"
                body={`No templates. Volume, intensity, exercise selection and progression are built around sport demands, training history and current outputs.`}
              />
              <FivePillar
                n="03"
                name="Load monitoring"
                body={`Sessions tracked against intent. Load adjusted week to week against wellness markers, competition density and recovery status.`}
              />
              <FivePillar
                n="04"
                name="Technical coaching"
                body={`Every lift, sprint and drill coached. Cues, video, feedback. Reps that move the picture, not reps that fill the hour.`}
              />
              <FivePillar
                n="05"
                name="Long-term development"
                body={`The plan looks at the season, the calendar and the next two to four years. Sustainable output is the standard.`}
              />
            </dl>
            <p className="mt-8 text-sm text-muted-foreground">
              Want the underlying philosophy?{" "}
              <Link
                href="/philosophy"
                className="font-medium text-primary underline underline-offset-4 hover:text-accent"
              >
                Read about the Grey Zone framework
              </Link>
              .
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── Testimonial (when present) ─────────────── */}
      {audience.testimonialQuote && (
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <figure className="rounded-3xl border border-border bg-white p-8 sm:p-10">
              <Quote className="size-8 text-accent" aria-hidden />
              <blockquote className="mt-4 font-heading text-xl leading-snug text-primary sm:text-2xl">
                {audience.testimonialQuote.quote}
              </blockquote>
              <figcaption className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                {audience.testimonialQuote.attribution}
              </figcaption>
            </figure>
          </FadeIn>
        </section>
      )}

      {/* ─────────────── Outcomes + live trust ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                What changes
              </span>
            </div>
            <h2
              id="what-changes"
              className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl"
            >
              Realistic, measurable, programmed in.
            </h2>
            <ul className="mt-8 space-y-3">
              {audience.outcomes.map((o) => (
                <li key={o} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                  <span className="text-muted-foreground">{o}</span>
                </li>
              ))}
            </ul>
            <div className="mt-10 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
              <GoogleReviewsBadge />
              <TrustStrip variant="compact" />
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── Tampa Bay service area (local SEO) ─────────────── */}
      <TampaBayServiceArea
        eyebrow="Tampa Bay Service Area"
        heading={`${audience.name} athletes across Tampa Bay, Florida.`}
        intro={
          <>
            Our facility in <strong>Zephyrhills, FL</strong> is within driving distance of every major
            Tampa Bay city. {audience.name} athletes train here from across the region.
          </>
        }
      />

      {/* ─────────────── Related program callout ─────────────── */}
      {audience.relatedProgramSlug && (
        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-8 lg:py-16">
          <FadeIn>
            <div className="rounded-3xl border border-border bg-primary p-8 text-primary-foreground sm:p-10">
              <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                  Self-paced program
                </span>
              </div>
              <h2 className="mt-4 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                Between coached engagements? Run the program.
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-primary-foreground/80">
                The same training principles, written as a structured block you can run on your own.
              </p>
              <Button asChild size="lg" className="mt-6 rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href={`/programs/${audience.relatedProgramSlug}`}>
                  See the program
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </FadeIn>
        </section>
      )}

      {/* ─────────────── FAQ (visible) ─────────────── */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-accent" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
              Questions
            </span>
          </div>
          <h2
            id="faq"
            className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl"
          >
            {audience.name} athletes, answered.
          </h2>
          <dl className="mt-8 divide-y divide-border rounded-2xl border border-border">
            {audience.faqs.map((f) => (
              <div key={f.question} className="p-5 md:p-6">
                <dt className="flex items-start gap-2 font-heading text-lg font-semibold text-primary">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>{f.question}</span>
                </dt>
                <dd className="mt-2 pl-3.5 leading-7 text-muted-foreground">{f.answer}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-10 text-center text-sm text-muted-foreground">
            Comparing options?{" "}
            <Link
              href="/services/online-vs-in-person"
              className="font-medium text-primary underline underline-offset-4 hover:text-accent"
            >
              Online vs in-person coaching
            </Link>{" "}
            ·{" "}
            <Link
              href="/services/coaching-vs-training-app"
              className="font-medium text-primary underline underline-offset-4 hover:text-accent"
            >
              Coaching vs a training app
            </Link>{" "}
            ·{" "}
            <Link
              href="/assessment"
              className="font-medium text-primary underline underline-offset-4 hover:text-accent"
            >
              Returning from an injury? Start with assessment
            </Link>
          </p>
        </FadeIn>
      </section>

      {/* ─────────────── Coach (E-E-A-T) ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="mb-6 flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                Who coaches it
              </span>
            </div>
            <AuthorCard variant="full" />
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── Sister-audience cross-links ─────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-20">
        <FadeIn>
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-accent" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
              Other athletes we coach
            </span>
          </div>
          <h2
            id="other-athletes"
            className="mt-4 font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl"
          >
            One framework, every stage of the career.
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sister.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/athletes/${a.slug}`}
                  className="group flex items-center justify-between gap-2 rounded-2xl border border-border bg-white px-5 py-4 transition-colors hover:border-accent/50 hover:bg-surface"
                >
                  <span className="font-heading text-base font-semibold text-primary">{a.name}</span>
                  <ArrowUpRight
                    className="size-4 text-muted-foreground transition-colors group-hover:text-accent"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            <Link
              href="/athletes"
              className="font-medium text-primary underline underline-offset-4 hover:text-accent"
            >
              See every athlete-segment program →
            </Link>{" "}
            ·{" "}
            <Link
              href="/sports"
              className="font-medium text-primary underline underline-offset-4 hover:text-accent"
            >
              Or browse by sport
            </Link>
          </p>
        </FadeIn>
      </section>

      {/* ─────────────── Footer CTA ─────────────── */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 lg:py-20">
          <FadeIn>
            <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              Coached the way you should be coached.
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-primary-foreground/75">
              Apply for coaching with Darren J Paul, PhD. We reply within 48 hours.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href={audience.primaryCta.href}>
                  {audience.primaryCta.label}
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Link href={audience.secondaryCta.href}>
                  {audience.secondaryCta.label}
                  <ChevronRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  )
}

function FivePillar({ n, name, body }: { n: string; name: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 font-heading text-2xl font-semibold tabular-nums text-accent/40">{n}</div>
      <div>
        <dt className="font-heading text-lg font-semibold text-primary">{name}</dt>
        <dd className="mt-1 leading-7 text-muted-foreground">{body}</dd>
      </div>
    </div>
  )
}
