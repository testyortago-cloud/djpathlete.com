import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Plane, GraduationCap, Sparkles, HeartPulse } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { AuthorCard } from "@/components/shared/AuthorCard"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import { SITE_URL } from "@/lib/constants"
import { getAthletesPageContent } from "@/lib/db/athletes-page"
import type { StageIcon } from "@/lib/validators/athletes-page"

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

/**
 * Lucide icon picker for the stage cards. Keep in sync with STAGE_ICONS in
 * lib/validators/athletes-page.ts — adding an icon there means adding a row
 * here too.
 */
const STAGE_ICON_MAP: Record<StageIcon, typeof Plane> = {
  plane: Plane,
  graduation_cap: GraduationCap,
  sparkles: Sparkles,
  heart_pulse: HeartPulse,
}

export default async function AthletesHubPage() {
  const content = await getAthletesPageContent()
  return (
    <>
      <JsonLd data={webPageSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Athletes", url: "/athletes" },
        ]}
      />

      {/* ─────────────── Hero — copy is editable via /admin/marketing/athletes ─────────────── */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-32 sm:px-8 lg:pb-24 lg:pt-40">
          <FadeIn>
            {content.hero_eyebrow && (
              <div className="flex items-center gap-3">
                <div className="h-px w-10 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
                  {content.hero_eyebrow}
                </span>
              </div>
            )}
            <h1 className="mt-6 font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              {content.hero_heading_line_1}
              <br />
              <span className="text-accent">{content.hero_heading_line_2}</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-primary-foreground/75 sm:text-lg">
              {content.hero_description}
            </p>
          </FadeIn>
        </div>
      </section>


      {/* ─────────────── Stage cards — copy is editable via /admin/marketing/athletes ─────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="mb-12 max-w-2xl">
            {content.stages_eyebrow && (
              <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
                  {content.stages_eyebrow}
                </span>
              </div>
            )}
            <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              {content.stages_heading}
            </h2>
          </div>
        </FadeIn>

        <div className="grid gap-6 md:grid-cols-2">
          {content.stages.map((stage, i) => {
            const Icon = STAGE_ICON_MAP[stage.icon]
            return (
              <FadeIn key={stage.id || i} delay={i * 0.08}>
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
                    {stage.heading}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                    {stage.summary}
                  </p>
                  <ul className="mt-5 space-y-2">
                    {stage.pillars.map((p, pi) => (
                      <li
                        key={`${p}-${pi}`}
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

      {/* ─────────────── FAQ (managed via CMS) ─────────────── */}
      <ManagedFaqSection
        pageKey="athletes"
        variant="cards"
        eyebrow="Common questions"
        title="Questions athletes and parents actually ask."
      />

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
