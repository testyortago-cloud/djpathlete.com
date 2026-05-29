import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, Quote, Target } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { TrustStrip } from "@/components/public/TrustStrip"
import { GoogleReviewsBadge } from "@/components/public/GoogleReviewsBadge"
import { TampaBayServiceArea, TAMPA_BAY_CITIES } from "@/components/public/TampaBayServiceArea"
import { AuthorCard } from "@/components/shared/AuthorCard"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import { SITE_URL } from "@/lib/constants"
import { DJP_AUTHOR_ID } from "@/lib/brand/author"
import { SPORTS, getSportBySlug } from "@/lib/data/sports"

interface Props {
  params: Promise<{ sport: string }>
}

export function generateStaticParams() {
  return SPORTS.map((s) => ({ sport: s.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sport: slug } = await params
  const sport = getSportBySlug(slug)
  if (!sport) return {}
  const pageUrl = `${SITE_URL}/sports/${sport.slug}`
  return {
    // Layout template appends " | DJP Athlete", so keep the brand out of the title.
    title: sport.h1.length > 60 ? `${sport.name} Performance Training, Tampa Bay` : sport.h1,
    description: sport.description,
    alternates: { canonical: `/sports/${sport.slug}` },
    openGraph: {
      title: `${sport.h1} | DJP Athlete`,
      description: sport.description,
      type: "website",
      url: pageUrl,
    },
    twitter: {
      card: "summary_large_image",
      title: `${sport.h1} | DJP Athlete`,
      description: sport.description,
    },
  }
}

export default async function SportPage({ params }: Props) {
  const { sport: slug } = await params
  const sport = getSportBySlug(slug)
  if (!sport) notFound()

  const pageUrl = `${SITE_URL}/sports/${sport.slug}`
  const isoDateModified = new Date().toISOString()

  // Sister sports for the bottom cross-link strip (everyone but the current one).
  const sisterSports = SPORTS.filter((s) => s.slug !== sport.slug).slice(0, 4)

  // ── Schema: WebPage + Service + HowTo + FAQPage ──────────────────────────
  // WebPage carries the speakable hint (helps voice assistants pick the
  // answer block to read) plus mainEntity → the Service node.
  const webPageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: sport.h1,
    description: sport.description,
    inLanguage: "en-US",
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}#website`, url: SITE_URL, name: "DJP Athlete" },
    primaryImageOfPage: { "@type": "ImageObject", url: `${SITE_URL}/images/gym-training-01.jpg` },
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: [".speakable-answer", "h1"],
    },
    about: { "@type": "Sport", name: sport.name },
    dateModified: isoDateModified,
  }

  // Service schema with provider linked to the canonical Person + LocalBusiness
  // entities, so Google merges this with the homepage's organization graph.
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${pageUrl}#service`,
    name: sport.h1,
    description: sport.description,
    url: pageUrl,
    serviceType: `${sport.name} Performance Training`,
    category: "Sports performance coaching",
    provider: {
      "@type": "Organization",
      "@id": `${SITE_URL}/#localbusiness`,
      name: "DJP Athlete",
      url: SITE_URL,
    },
    // Performer / responsible expert — links to the canonical Darren J Paul Person.
    performer: { "@type": "Person", "@id": DJP_AUTHOR_ID },
    areaServed: [
      ...TAMPA_BAY_CITIES.map((name) => ({ "@type": "Place", name })),
      { "@type": "Place", name: "Tampa Bay Area" },
      { "@type": "Place", name: "Worldwide (online)" },
    ],
    audience: {
      "@type": "PeopleAudience",
      audienceType: `${sport.name} players: competitive juniors through professional`,
    },
    about: { "@type": "Sport", name: sport.name },
    mainEntityOfPage: { "@id": `${pageUrl}#webpage` },
    dateModified: isoDateModified,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${sport.name} performance coaching`,
      itemListElement: [
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: `In-person ${sport.name.toLowerCase()} performance training (Tampa Bay)`,
            url: `${SITE_URL}/in-person`,
          },
        },
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: `Online ${sport.name.toLowerCase()} performance coaching`,
            url: `${SITE_URL}/online`,
          },
        },
      ],
    },
  }

  // HowTo — the coaching process applied to this sport. Google removed
  // HowTo rich results from SERPs in late 2023, but the schema still feeds AI
  // assistants and adds entity density for the page.
  const howToSchema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How ${sport.name.toLowerCase()} performance training works at DJP Athlete`,
    description: `The coaching process for developing the physical qualities that drive ${sport.name.toLowerCase()} outcomes: assessment, individualized programming, load monitoring, technical coaching and long-term development.`,
    totalTime: "P12W",
    step: [
      {
        "@type": "HowToStep",
        position: 1,
        name: "Assessment",
        text: `Test where the athlete sits on force production, asymmetry, movement quality and ${sport.name.toLowerCase()}-specific outputs. The plan is built from that diagnostic, not from a template.`,
      },
      {
        "@type": "HowToStep",
        position: 2,
        name: "Individualized programming",
        text: `Volume, intensity and exercise selection are tailored to the athlete's sport demands, training history and current outputs. No two ${sport.name.toLowerCase()} players run the same program.`,
      },
      {
        "@type": "HowToStep",
        position: 3,
        name: "Load monitoring",
        text: "Sessions are tracked against intent. Training load is adjusted week to week so the athlete adapts without breaking, particularly in-season.",
      },
      {
        "@type": "HowToStep",
        position: 4,
        name: "Technical coaching",
        text: "Every lift, sprint and drill is coached with cues, video and feedback. Reps that change the picture, not reps that fill the hour.",
      },
      {
        "@type": "HowToStep",
        position: 5,
        name: "Long-term development",
        text: `Programs look at the season, the calendar and the next two years. Sustainable output is the standard for ${sport.name.toLowerCase()} players, not eight-week peaks.`,
      },
    ],
  }

  return (
    <>
      <JsonLd data={webPageSchema} />
      <JsonLd data={serviceSchema} />
      <JsonLd data={howToSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Sports", url: "/sports" },
          { name: sport.name, url: `/sports/${sport.slug}` },
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
                Sports · {sport.name}
              </span>
            </div>
            <h1 className="mt-6 font-heading text-3xl font-semibold leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
              {sport.h1}
            </h1>
            <p className="mt-5 max-w-2xl font-heading text-lg font-medium leading-snug text-primary-foreground/90 sm:text-xl">
              {sport.hook}
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-primary-foreground/70 sm:text-lg">
              {sport.cardTagline}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href="/in-person">
                  In-person (Tampa Bay)
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
                  Online (worldwide)
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
        question={sport.answerQuestion}
        answer={sport.answer}
        className="speakable-answer"
      />

      {/* ─────────────── What we develop ─────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="flex items-center gap-3">
            <Target className="size-4 text-accent" aria-hidden />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
              What we develop
            </span>
          </div>
          <h2
            id="what-we-develop"
            className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl"
          >
            The four qualities that decide {sport.name.toLowerCase()} outcomes.
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
            Programmed from the diagnostic. Not bolted on at the end.
          </p>
          <ol className="mt-10 grid gap-6 md:grid-cols-2">
            {sport.qualities.map((q, i) => (
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

      {/* ─────────────── How we train it ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                How we train it
              </span>
            </div>
            <h2
              id="how-we-train-it"
              className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl"
            >
              How we coach {sport.name.toLowerCase()}.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Every program at DJP Athlete runs the same coaching logic. For {sport.name.toLowerCase()},
              it looks like this:
            </p>
            <dl className="mt-8 space-y-5">
              <FivePillar
                n="01"
                name="Assessment"
                body={`We start with a clear picture of where you sit on force production, asymmetry, movement quality and ${sport.name.toLowerCase()}-specific outputs. The plan is built from that picture.`}
              />
              <FivePillar
                n="02"
                name="Individualized programming"
                body={`No templates. Volume, intensity, exercise selection and progression are built around your sport demands, training history and current outputs.`}
              />
              <FivePillar
                n="03"
                name="Load monitoring"
                body={`Sessions are tracked against intent. Training load is adjusted week to week so you adapt without breaking, particularly in-season.`}
              />
              <FivePillar
                n="04"
                name="Technical coaching"
                body={`Every lift, sprint and drill is coached. Cues, video, feedback. Reps that move the picture, not reps that fill the hour.`}
              />
              <FivePillar
                n="05"
                name="Long-term development"
                body={`We are not chasing a peak in eight weeks. The plan looks at the season, the calendar and the next two years. Sustainable output is the standard.`}
              />
            </dl>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── Testimonial (when present) ─────────────── */}
      {sport.testimonialQuote && (
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <figure className="rounded-3xl border border-border bg-white p-8 sm:p-10">
              <Quote className="size-8 text-accent" aria-hidden />
              <blockquote className="mt-4 font-heading text-xl leading-snug text-primary sm:text-2xl">
                {sport.testimonialQuote.quote}
              </blockquote>
              <figcaption className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                {sport.testimonialQuote.attribution}
              </figcaption>
            </figure>
          </FadeIn>
        </section>
      )}

      {/* ─────────────── What changes in 12 weeks + live trust ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                What changes in 12 weeks
              </span>
            </div>
            <h2
              id="what-changes"
              className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl"
            >
              Realistic, measurable, programmed in.
            </h2>
            <ul className="mt-8 space-y-3">
              {sport.outcomes.map((o) => (
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
        heading={`${sport.name} players across Tampa Bay, Florida.`}
        intro={
          <>
            Our facility in <strong>Zephyrhills, FL</strong> is within driving distance of every major
            Tampa Bay city. {sport.name} players train here from across the region.
          </>
        }
      />

      {/* ─────────────── Related program callout ─────────────── */}
      {sport.relatedProgramSlug && (
        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-8 lg:py-16">
          <FadeIn>
            <div className="rounded-3xl border border-border bg-primary p-8 text-primary-foreground sm:p-10">
              <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                  Self-paced program
                </span>
              </div>
              <h2
                id="related-program"
                className="mt-4 font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Between coached engagements? Run the program.
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-primary-foreground/80">
                The same training principles, written as a structured block you can run on your own.
              </p>
              <Button asChild size="lg" className="mt-6 rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href={`/programs/${sport.relatedProgramSlug}`}>
                  See the program
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </FadeIn>
        </section>
      )}

      {/* ─────────────── FAQ (managed via CMS) ─────────────── */}
      <ManagedFaqSection
        pageKey={`sports/${slug}`}
        variant="list"
        eyebrow="Questions"
        title={`${sport.name} performance training, answered.`}
      />

      {/* Comparison + related-decision link strip */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-8 lg:pb-24">
        <FadeIn>
          <p className="text-center text-sm text-muted-foreground">
            Still deciding?{" "}
            <Link
              href="/services/online-vs-in-person"
              className="font-medium text-primary underline underline-offset-4 hover:text-accent"
            >
              Online vs in-person coaching, compared
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

      {/* ─────────────── Sister-sport cross-links ─────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-20">
        <FadeIn>
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-accent" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
              Other sports we coach
            </span>
          </div>
          <h2
            id="other-sports"
            className="mt-4 font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl"
          >
            One framework, multiple sports.
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sisterSports.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/sports/${s.slug}`}
                  className="group flex items-center justify-between gap-2 rounded-2xl border border-border bg-white px-5 py-4 transition-colors hover:border-accent/50 hover:bg-surface"
                >
                  <span className="font-heading text-base font-semibold text-primary">{s.name}</span>
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
              href="/sports"
              className="font-medium text-primary underline underline-offset-4 hover:text-accent"
            >
              See every sport-specific program →
            </Link>
          </p>
        </FadeIn>
      </section>

      {/* ─────────────── Footer CTA ─────────────── */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 lg:py-20">
          <FadeIn>
            <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              Train for the sport you actually play.
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-primary-foreground/75">
              Apply for {sport.name.toLowerCase()} performance coaching with Darren J Paul, PhD. We reply
              within 48 hours.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href="/in-person">
                  Apply, Tampa Bay
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
                  Apply, online
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
