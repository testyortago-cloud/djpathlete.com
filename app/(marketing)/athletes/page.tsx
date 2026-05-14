import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { TrustStrip } from "@/components/public/TrustStrip"
import { AuthorCard } from "@/components/shared/AuthorCard"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import { SITE_URL } from "@/lib/constants"
import { ATHLETES } from "@/lib/data/athletes"

export const metadata: Metadata = {
  title: "Sports Performance Coaching by Athlete Type",
  description:
    "Sports performance coaching at every stage: professional, collegiate, youth, return-to-sport. Tampa Bay in-person and online worldwide, by Darren J Paul, PhD.",
  alternates: { canonical: "/athletes" },
  openGraph: {
    title: "Sports Performance Coaching by Athlete Type | DJP Athlete",
    description:
      "Coaching designed around your stage: professional, collegiate, youth, return-to-sport. By Darren J Paul, PhD.",
    type: "website",
    url: `${SITE_URL}/athletes`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Performance Coaching by Athlete Type | DJP Athlete",
    description:
      "Coaching designed around your stage: professional, collegiate, youth, return-to-sport.",
  },
}

const collectionSchema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Sports Performance Coaching by Athlete Type",
  url: `${SITE_URL}/athletes`,
  description:
    "Audience-specific performance coaching pages: professional, collegiate and competitive amateur, youth, and return-to-sport athletes.",
  isPartOf: { "@type": "WebSite", name: "DJP Athlete", url: SITE_URL },
  speakable: { "@type": "SpeakableSpecification", cssSelector: [".speakable-answer", "h1"] },
}

const itemListSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Performance coaching by athlete stage",
  numberOfItems: ATHLETES.length,
  itemListElement: ATHLETES.map((a, i) => ({
    "@type": "ListItem",
    position: i + 1,
    item: {
      "@type": "Service",
      name: a.h1,
      url: `${SITE_URL}/athletes/${a.slug}`,
      description: a.description,
      provider: { "@type": "Organization", name: "DJP Athlete", url: SITE_URL },
      audience: { "@type": "PeopleAudience", audienceType: a.audienceType },
      areaServed: [
        { "@type": "Place", name: "Tampa Bay" },
        { "@type": "Place", name: "Worldwide (online)" },
      ],
    },
  })),
}

export default function AthletesHubPage() {
  return (
    <>
      <JsonLd data={collectionSchema} />
      <JsonLd data={itemListSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Athletes", url: "/athletes" },
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
                Athletes
              </span>
            </div>
            <h1 className="mt-6 font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Coached for the stage
              <br />
              <span className="text-accent">you are actually in.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-primary-foreground/75 sm:text-lg">
              Professional. Collegiate. Youth. Coming back from injury. The Five Pillar Framework is the
              same. The programming, the load and the expectations look very different in each.
            </p>
            <TrustStrip variant="compact" className="mt-8" />
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── AEO answer block ─────────────── */}
      <SemanticAnswerBlock
        eyebrow="What this is"
        question="What athletes does DJP Athlete coach?"
        answer="DJP Athlete coaches athletes at four distinct career stages: professional athletes (touring pros in tennis, golf, pickleball, baseball and other rotational sports), collegiate and competitive amateur athletes, elite youth athletes in long-term athletic development, and athletes returning from injury or surgery who have been cleared by a clinician but are not yet competition-ready. Each stage runs the same five-pillar framework (assessment, individualized programming, load monitoring, technical coaching, long-term development) at the intensity, frequency and supervision level appropriate to that stage. Coaching is by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), who has coached 500+ athletes across 15+ sports and three continents, including WTA professionals and professional pickleball players. In-person training is delivered at the Zephyrhills, Florida facility in the Tampa Bay area; online coaching is available worldwide with weekly programming, video feedback and ongoing coach oversight."
        className="speakable-answer"
      />

      {/* ─────────────── Audience grid ─────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="mb-12 max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                Pick your stage
              </span>
            </div>
            <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              Coaching designed around where you actually are.
            </h2>
          </div>
          <ul className="grid gap-6 md:grid-cols-2">
            {ATHLETES.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/athletes/${a.slug}`}
                  className="group relative block h-full overflow-hidden rounded-2xl border border-border bg-white p-6 transition-colors hover:border-accent/50 hover:bg-surface sm:p-7"
                >
                  <div className="absolute right-5 top-5 text-muted-foreground transition-colors group-hover:text-accent">
                    <ArrowUpRight className="size-5" aria-hidden />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent">
                    {a.name}
                  </p>
                  <h3 className="mt-3 font-heading text-2xl font-semibold tracking-tight text-primary">
                    {a.h1.split(":")[0].replace(/\sand\s.+$/, "")}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{a.cardTagline}</p>
                  <p className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:text-accent">
                    See the {a.name.toLowerCase()} program
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </FadeIn>
      </section>

      {/* ─────────────── Coach (E-E-A-T) ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="mb-6 flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                Who coaches every stage
              </span>
            </div>
            <AuthorCard variant="full" />
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── Cross-link to /sports ─────────────── */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 lg:py-20">
        <FadeIn>
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
            Prefer to browse by sport?
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
            Every athlete-stage program is delivered through sport-specific programming. See the per-sport
            pages for tennis, golf, baseball, soccer, lacrosse and pickleball.
          </p>
          <Button asChild size="lg" className="mt-8 rounded-full">
            <Link href="/sports">
              Browse by sport
              <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
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
              Apply for performance coaching with Darren J Paul, PhD. We reply within 48 hours.
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
