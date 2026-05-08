import type { Metadata } from "next"
import { ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import { CampHero } from "@/components/public/CampHero"
import { EventsComingSoonPanel } from "@/components/public/EventsComingSoonPanel"
import { InquiryForm } from "@/components/public/InquiryForm"
import { getPublishedEvents } from "@/lib/db/events"
import { EventCard } from "@/components/public/EventCard"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "High-Performance Soccer Camps in Tampa Bay, FL",
  description:
    "Elite soccer performance camps in Zephyrhills, FL (Tampa Bay area) for college, semi-pro, and professional players, plus emerging talent aged 14–17. 2-week intensive off-season and pre-season blocks.",
  alternates: { canonical: "/camps" },
  openGraph: {
    title: "High-Performance Soccer Camps in Tampa Bay, FL | DJP Athlete",
    description:
      "Elite soccer performance camps in Zephyrhills, FL. 2-week intensive off-season and pre-season blocks for college, semi-pro, professional players, and emerging talent aged 14–17.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "High-Performance Soccer Camps in Tampa Bay, FL | DJP Athlete",
    description:
      "Elite soccer performance camps for college, semi-pro, professional, and emerging talent in Zephyrhills, FL.",
  },
}

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: {
    "@type": "Person",
    name: "Darren J Paul",
    worksFor: { "@type": "Organization", name: "DJP Athlete", url: "https://www.darrenjpaul.com" },
  },
  serviceType: "High-Performance Soccer Camps · Off-Season / Pre-Season",
  description:
    "High-performance soccer camps and elite soccer performance training. 2-week intensive sports performance camps and soccer performance training blocks for college, semi-pro, and professional players, plus emerging talent aged 14–17.",
  url: "https://www.darrenjpaul.com/camps",
  audience: {
    "@type": "Audience",
    audienceType: "Soccer players — college, semi-pro, professional, and emerging talent aged 14–17",
  },
}

const PILLARS: { n: string; title: string; lede: string; body: string }[] = [
  {
    n: "I",
    title: "Speed + Agility",
    lede: "Sharper. Faster.",
    body: "Acceleration, sprint mechanics, change of direction, explosive outputs, and force expression.",
  },
  {
    n: "II",
    title: "Strength + Power",
    lede: "A foundation that holds.",
    body: "Physical qualities that support robustness, force transfer, and repeatable performance.",
  },
  {
    n: "III",
    title: "Movement Quality",
    lede: "Look like an athlete.",
    body: "Better posture, coordination, and control through athletic actions.",
  },
  {
    n: "IV",
    title: "Conditioning",
    lede: "Capacity to compete.",
    body: "Capacity to train, recover, and compete without turning sessions into random suffering.",
  },
]

const TRACKS = [
  {
    tag: "High-performing talent",
    title: "Professional and college-level players.",
    body: "For players already competing at college, semi-professional, or professional level who need a structured off-season or pre-season block. The standard is high. The expectation is that you rise to the level.",
    meta: "18+ · College, semi-pro, and professional",
  },
  {
    tag: "Emerging talent",
    title: "Serious players on the way up.",
    body: "For players aged 14–17 who are competing at a high level and want to build the physical foundation before the next step. Coached with the same standards as the senior group — just calibrated for where you are right now.",
    meta: "14–17 · Academy, club, and regional level",
  },
]

export default async function CampsPage() {
  const [events, waiverDoc] = await Promise.all([
    getPublishedEvents({ type: "camp" }),
    getActiveDocument("liability_waiver"),
  ])
  const waiverContent = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null
  return (
    <>
      <JsonLd data={serviceSchema} />

      <CampHero />

      {/* ===================== § 2 · WHY THIS CAMP ===================== */}
      <section
        id="why-this-camp"
        className="relative py-20 lg:py-28 px-4 sm:px-8 border-b-2 border-primary bg-background text-primary"
      >
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="font-heading text-xs uppercase tracking-[0.35em] mb-6 text-accent">§ Why this camp</div>
            <h2
              className="font-heading font-semibold tracking-tight leading-[0.95] text-primary"
              style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}
            >
              Built around what the game <span className="italic font-normal text-accent">actually requires.</span>
            </h2>
            <p className="mt-8 text-base md:text-lg leading-8 max-w-3xl text-muted-foreground">
              Most training environments don't move fast enough for players at this level. This camp does. Every session
              is structured around the physical demands of high-level soccer — acceleration, change of direction, force
              output, repeat sprint capacity, and the movement quality needed to stay on the pitch. In selected groups,
              athletes also receive testing and performance reporting so they leave with data, not just reps.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ===================== § 3 · PILLARS ===================== */}
      <section id="what-gets-developed" className="relative py-20 lg:py-28 px-4 sm:px-8 bg-surface text-primary">
        <div className="relative max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex items-end justify-between flex-wrap gap-6 border-b-2 border-primary pb-6 mb-14">
              <div>
                <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent mb-4">
                  § What gets developed · 4 pillars
                </div>
                <h2
                  className="font-heading font-semibold tracking-tight leading-[0.9] text-primary"
                  style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)" }}
                >
                  The four <span className="italic font-normal text-accent">pillars.</span>
                </h2>
              </div>
              <div className="font-heading text-xs uppercase tracking-[0.35em] text-primary/55">§ Feature · page 3</div>
            </div>
          </FadeIn>

          <div className="grid gap-x-10 gap-y-12 md:grid-cols-2 xl:grid-cols-4">
            {PILLARS.map((p, i) => (
              <FadeIn key={p.n} delay={i * 0.05}>
                <article className="relative">
                  <div
                    className="font-heading font-bold leading-none text-accent"
                    style={{
                      fontSize: "clamp(3rem, 7vw, 5rem)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {p.n}
                  </div>
                  <div className="mt-3 border-t border-primary" />
                  <h3 className="mt-5 font-heading text-2xl md:text-3xl font-semibold tracking-tight leading-tight text-primary">
                    {p.title}
                  </h3>
                  <p className="mt-2 font-heading italic text-base md:text-lg text-accent">{p.lede}</p>
                  <p className="mt-4 text-sm md:text-[15px] leading-7 text-muted-foreground">{p.body}</p>
                </article>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== COACH · RESERVED PLACEHOLDER ===================== */}
      {/*
        Reserved per handoff doc: "Reserve a section on the page for future video content
        from Darren. Can be slotted in without restructuring the rest of the page."
        The slot is hidden from the UI by default — flip to visible once the video is ready.
      */}
      <section
        id="coach"
        aria-hidden="true"
        className="hidden border-t-2 border-b-2 border-primary bg-background py-20 lg:py-28 px-4 sm:px-8"
      >
        <div className="max-w-7xl mx-auto">
          <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent mb-6">§ Coach · reserved</div>
          <div className="aspect-video w-full border-2 border-dashed border-primary/30 bg-surface grid place-items-center">
            <span className="font-heading text-sm uppercase tracking-[0.3em] text-primary/40">
              Video content — to be slotted in
            </span>
          </div>
        </div>
      </section>

      {/* ===================== § 4 · WHO IT'S FOR · TWO TRACKS ===================== */}
      <section className="relative overflow-hidden py-20 lg:py-28 px-4 sm:px-8 border-t-2 border-b-2 border-primary bg-primary text-primary-foreground">
        <div className="relative max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex items-end justify-between flex-wrap gap-6 border-b border-primary-foreground/20 pb-6 mb-14">
              <div>
                <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent">
                  § Who it's for · Two tracks
                </div>
                <h3
                  className="mt-4 font-heading font-semibold tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}
                >
                  Select the track that <span className="italic font-normal text-accent">fits you.</span>
                </h3>
              </div>
            </div>
          </FadeIn>

          <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
            {TRACKS.map((t, i) => (
              <FadeIn key={t.tag} delay={i * 0.08}>
                <article className="relative h-full p-8 md:p-10 border-2 border-primary-foreground/25 bg-primary-foreground/[0.04]">
                  <div className="font-heading text-[11px] uppercase tracking-[0.35em] text-accent">{t.tag}</div>
                  <h4 className="mt-5 font-heading text-2xl md:text-3xl font-semibold tracking-tight leading-tight">
                    {t.title}
                  </h4>
                  <p className="mt-5 leading-7 text-primary-foreground/80">{t.body}</p>
                  <div className="mt-8 pt-5 border-t border-primary-foreground/15 font-heading text-[11px] uppercase tracking-[0.3em] text-primary-foreground/70">
                    {t.meta}
                  </div>
                </article>
              </FadeIn>
            ))}
          </div>

          <FadeIn delay={0.15}>
            <div className="mt-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 items-start">
              <div>
                <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent">
                  § What you leave with
                </div>
                <p
                  className="mt-4 font-heading font-semibold tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 4.5vw, 3.5rem)" }}
                >
                  Faster.
                  <br />
                  Stronger.
                  <br />
                  <span className="italic font-normal text-accent">Ready.</span>
                </p>
                <p className="mt-6 max-w-lg leading-7 text-primary-foreground/80">
                  Two weeks of structured, high-intensity work builds the physical base that carries into the season.
                  Where testing is included, you also leave with a performance report — concrete data on what improved
                  and what to keep working on.
                </p>
              </div>

              <div className="relative p-8 md:p-10 border-2 border-accent bg-accent/[0.08]">
                <div className="absolute -top-3 -right-3 rotate-6 px-3 py-1 border-2 border-accent font-heading text-[11px] uppercase tracking-[0.3em] text-accent bg-primary">
                  Apply
                </div>
                <p className="font-heading text-2xl md:text-3xl font-semibold tracking-tight leading-tight">
                  Not sure which track is right for you?{" "}
                  <span className="italic font-normal text-accent">Let's talk.</span>
                </p>
                <p className="mt-5 leading-7 text-primary-foreground/80">
                  Places are limited and selected carefully. Fill in your details and Darren will be in touch directly
                  to talk through where you're at, which track fits, and whether the camp is the right move for you
                  right now.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="mt-8 rounded-none bg-accent text-primary hover:bg-accent/90 font-heading font-semibold uppercase tracking-[0.15em]"
                >
                  <Link href="#register-interest">
                    Apply for a spot
                    <ArrowUpRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== § 6 · UPCOMING SESSIONS ===================== */}
      <section className="relative py-20 lg:py-28 px-4 sm:px-8 bg-surface text-primary">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex items-end justify-between flex-wrap gap-6 border-b-2 border-primary pb-6 mb-6">
              <div>
                <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent mb-4">
                  § Upcoming sessions
                </div>
                <h2
                  className="font-heading font-semibold tracking-tight leading-[0.9] text-primary"
                  style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)" }}
                >
                  When and where
                </h2>
              </div>
              <div className="font-heading text-xs uppercase tracking-[0.35em] text-primary/55">
                § Fixtures · page 6
              </div>
            </div>
            <p className="mb-12 max-w-2xl text-muted-foreground leading-7">
              Select a track to filter, or browse all upcoming camp blocks below. Places are limited to 8 per group.
            </p>
          </FadeIn>
          <div>
            {events.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} waiverContent={waiverContent} />
                ))}
              </div>
            ) : (
              <EventsComingSoonPanel type="camp" />
            )}
          </div>
        </div>
      </section>

      {/* ===================== § 7 · INQUIRY · CALL FUNNEL ===================== */}
      <section id="register-interest" className="relative py-20 lg:py-28 px-4 sm:px-8 bg-surface text-primary">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="border-b-2 border-primary pb-6 mb-10">
              <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent">§ Back page · Apply</div>
            </div>
            <div className="bg-background rounded-none border-2 border-primary p-6 sm:p-8">
              <InquiryForm
                defaultService="camp"
                heading="Apply for a spot"
                description="Places are limited and selected carefully. If you're serious about the work, fill in your details below and Darren will be in touch directly — within 48 hours — to set up a call. No hard sell, just an honest conversation about what you need."
              />
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  )
}
