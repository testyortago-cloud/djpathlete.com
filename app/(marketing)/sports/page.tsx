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
import { SPORTS } from "@/lib/data/sports"

export const metadata: Metadata = {
  // Layout template appends " | DJP Athlete".
  title: "Sports Performance Training by Sport",
  description:
    "Sport-specific performance training in Tampa Bay and online: tennis, golf, baseball, soccer, lacrosse, pickleball. Coached by Darren J Paul, PhD (CSCS, NASM).",
  alternates: { canonical: "/sports" },
  openGraph: {
    title: "Sports Performance Training by Sport | DJP Athlete",
    description:
      "Sport-specific performance training: tennis, golf, baseball, soccer, lacrosse, pickleball. In-person in Tampa Bay or online. By Darren J Paul, PhD.",
    type: "website",
    url: `${SITE_URL}/sports`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Performance Training by Sport | DJP Athlete",
    description:
      "Sport-specific performance training: tennis, golf, baseball, soccer, lacrosse, pickleball. By Darren J Paul, PhD.",
  },
}

// CollectionPage + ItemList of per-sport Service entries — eligible for
// Google's list-style rich treatment and gives AI assistants a clean
// inventory of what DJP Athlete coaches.
const collectionSchema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Sports Performance Training by Sport",
  url: `${SITE_URL}/sports`,
  description:
    "Sport-specific performance training services from DJP Athlete: tennis, golf, baseball, soccer, lacrosse and pickleball, in-person in Tampa Bay or online.",
  about: SPORTS.map((s) => ({
    "@type": "Sport",
    name: s.name,
    url: `${SITE_URL}/sports/${s.slug}`,
  })),
  isPartOf: { "@type": "WebSite", name: "DJP Athlete", url: SITE_URL },
  speakable: {
    "@type": "SpeakableSpecification",
    cssSelector: [".speakable-answer", "h1"],
  },
}

const itemListSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Sport-specific performance training programs",
  numberOfItems: SPORTS.length,
  itemListElement: SPORTS.map((s, i) => ({
    "@type": "ListItem",
    position: i + 1,
    item: {
      "@type": "Service",
      name: s.h1,
      url: `${SITE_URL}/sports/${s.slug}`,
      description: s.description,
      provider: { "@type": "Organization", name: "DJP Athlete", url: SITE_URL },
      areaServed: [
        { "@type": "Place", name: "Tampa Bay" },
        { "@type": "Place", name: "Worldwide (online)" },
      ],
    },
  })),
}

export default function SportsHubPage() {
  return (
    <>
      <JsonLd data={collectionSchema} />
      <JsonLd data={itemListSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Sports", url: "/sports" },
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
                Sports
              </span>
            </div>
            <h1 className="mt-6 font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Performance Training,
              <br />
              <span className="text-accent">Built for Your Sport.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-primary-foreground/75 sm:text-lg">
              Tennis. Golf. Baseball. Soccer. Lacrosse. Pickleball. Each sport rewards different
              qualities. Each program is built around the ones yours decides games on, not the ones
              that look good on a gym leaderboard.
            </p>
            <TrustStrip variant="compact" className="mt-8" />
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── AEO answer block (speakable) ─────────────── */}
      <SemanticAnswerBlock
        eyebrow="What this is"
        question="What sports does DJP Athlete coach?"
        answer={`DJP Athlete coaches performance training for athletes in tennis, golf, baseball, soccer, lacrosse and pickleball, in-person at our Zephyrhills facility in the Tampa Bay area and online for athletes anywhere. Every sport gets a dedicated program built around what that sport actually demands: tennis around acceleration, deceleration and rotational power; golf around clubhead speed and rotational chain; baseball around exit velocity, throwing velocity and durability; soccer around repeated-sprint capacity and reactive agility; lacrosse around rotational power for shooting and dodge agility; pickleball around lateral movement and joint durability. Training is delivered by Darren J Paul, PhD (CSCS, NASM), who has coached 500+ athletes across 15+ sports including WTA professionals and pro pickleball players.`}
        className="speakable-answer"
      />

      {/* ─────────────── Sports grid ─────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="mb-12 max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                Pick your sport
              </span>
            </div>
            <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              Programmed around the demands of your game.
            </h2>
          </div>
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SPORTS.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/sports/${s.slug}`}
                  className="group relative block h-full overflow-hidden rounded-2xl border border-border bg-white p-6 transition-colors hover:border-accent/50 hover:bg-surface sm:p-7"
                >
                  <div className="absolute right-5 top-5 text-muted-foreground transition-colors group-hover:text-accent">
                    <ArrowUpRight className="size-5" aria-hidden />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent">
                    {s.name}
                  </p>
                  <h3 className="mt-3 font-heading text-2xl font-semibold tracking-tight text-primary">
                    {s.h1.split(":")[0].replace(/,.*$/, "")}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {s.cardTagline}
                  </p>
                  <p className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:text-accent">
                    See the {s.name.toLowerCase()} program
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </FadeIn>
      </section>

      {/* ─────────────── Who coaches every program (E-E-A-T) ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="mb-6 flex items-center gap-3">
              <div className="h-px w-8 bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                Who coaches every sport
              </span>
            </div>
            <AuthorCard variant="full" />
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── Don't see your sport ─────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 lg:py-20">
          <FadeIn>
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
              Don&apos;t see your sport?
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
              The framework runs the same way across sports. We have coached 500+ athletes across
              15+ sports. If your sport is not listed above, tell us about it and we will build the
              right program.
            </p>
            <Button asChild size="lg" className="mt-8 rounded-full">
              <Link href="/contact">
                Talk to a coach
                <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────── Footer CTA ─────────────── */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 lg:py-20">
          <FadeIn>
            <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              Train for the sport you actually play.
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-primary-foreground/75">
              Apply for sport-specific performance coaching with Darren J Paul, PhD. We reply within
              48 hours.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href="/in-person">
                  In-person, Tampa Bay
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
                  Online, worldwide
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
