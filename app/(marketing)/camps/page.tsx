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

export const metadata: Metadata = {
  title: "Performance Camps",
  description:
    "Off-season and pre-season performance camps for athletes aged 12–18. Speed, power, movement quality, conditioning, plus testing and reporting where included.",
  openGraph: {
    title: "Performance Camps | DJP Athlete",
    description:
      "Off-season and pre-season performance camps for athletes aged 12–18. Build a stronger base before the season takes over.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Performance Camps | DJP Athlete",
    description:
      "Off-season and pre-season performance camps for athletes aged 12–18. Build a stronger base before the season takes over.",
  },
}

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: {
    "@type": "Person",
    name: "Darren J Paul",
    worksFor: { "@type": "Organization", name: "DJP Athlete", url: "https://djpathlete.com" },
  },
  serviceType: "Off-Season / Pre-Season Performance Camp",
  description: "Multi-week off-season and pre-season athletic performance camps for youth athletes aged 12–18.",
  url: "https://djpathlete.com/camps",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 12–18" },
}

const PILLARS: { n: string; title: string; lede: string; body: string }[] = [
  {
    n: "I",
    title: "Speed + Power",
    lede: "Explode further, faster.",
    body: "Acceleration, sprint mechanics, jumping, and force expression — developed as qualities, not random workouts.",
  },
  {
    n: "II",
    title: "Strength",
    lede: "A foundation that holds.",
    body: "Physical qualities that support robustness, force transfer, and repeatable performance through a season.",
  },
  {
    n: "III",
    title: "Movement",
    lede: "Look like an athlete.",
    body: "Better rhythm, posture, coordination, and control through athletic actions — coached with intent.",
  },
  {
    n: "IV",
    title: "Conditioning",
    lede: "Capacity to compete.",
    body: "The capacity to train, recover, and compete — without turning sessions into random suffering.",
  },
]

const TECH_ITEMS = [
  { n: "01", label: "Selected testing", detail: "where it adds value, not as a gimmick" },
  { n: "02", label: "Useful insight", detail: "translating numbers into coaching decisions" },
  { n: "03", label: "Clear reporting", detail: "one-page summaries athletes and parents can read" },
  { n: "04", label: "Actionable feedback", detail: "the one or two things to work on next" },
]

const WHO_ITS_FOR = [
  "Athletes aged 12–18 in an off-season or pre-season block",
  "Players who want better physical preparation before competition ramps up",
  "Parents and teams who value both training quality and measurable feedback",
]

export default async function CampsPage() {
  const events = await getPublishedEvents({ type: "camp" })
  return (
    <>
      <JsonLd data={serviceSchema} />

      <CampHero />

      {/* ===================== PILLARS · FEATURE SPREAD ===================== */}
      <section id="what-gets-developed" className="relative py-20 lg:py-28 px-4 sm:px-8 bg-surface text-primary">
        <div className="relative max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex items-end justify-between flex-wrap gap-6 border-b-2 border-primary pb-6 mb-14">
              <h2
                className="font-heading font-semibold tracking-tight leading-[0.9] text-primary"
                style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)" }}
              >
                The four <span className="italic font-normal text-accent">pillars.</span>
              </h2>
              <div className="font-heading text-xs uppercase tracking-[0.35em] text-primary/55">
                § Feature · page 2
              </div>
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

      {/* ===================== TECH + FEEDBACK · SPREAD ===================== */}
      <section className="relative py-20 lg:py-28 px-4 sm:px-8 border-t-2 border-b-2 border-primary bg-background text-primary">
        <div className="max-w-7xl mx-auto">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
            <FadeIn>
              <div>
                <div className="font-heading text-xs uppercase tracking-[0.35em] mb-6 text-accent">
                  § Column II · Technology + Feedback
                </div>
                <h2
                  className="font-heading font-semibold tracking-tight leading-[0.95] text-primary"
                  style={{ fontSize: "clamp(2rem, 4.5vw, 3.5rem)" }}
                >
                  Train with <span className="italic font-normal text-accent">receipts.</span>
                </h2>
                <p className="mt-6 text-base md:text-lg leading-8 max-w-md text-muted-foreground">
                  Where appropriate, selected testing and reporting add another layer to the camp
                  experience. Not to overcomplicate it — to make progress visible and useful.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <div>
                {TECH_ITEMS.map((item) => (
                  <div
                    key={item.n}
                    className="group grid grid-cols-[auto_1fr_auto] items-baseline gap-6 py-5 border-b-2 last:border-b-0 border-primary/15 transition-colors"
                  >
                    <span className="font-heading text-2xl font-bold tabular-nums text-accent">
                      {item.n}
                    </span>
                    <span className="font-heading text-xl md:text-2xl font-semibold tracking-tight text-primary">
                      {item.label}
                    </span>
                    <span className="text-sm md:text-base italic text-right text-muted-foreground">
                      {item.detail}
                    </span>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ===================== UPCOMING ===================== */}
      <section className="relative py-20 lg:py-28 px-4 sm:px-8 bg-surface text-primary">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex items-end justify-between flex-wrap gap-6 border-b-2 border-primary pb-6 mb-12">
              <h2
                className="font-heading font-semibold tracking-tight leading-[0.9] text-primary"
                style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)" }}
              >
                Upcoming blocks
              </h2>
              <div className="font-heading text-xs uppercase tracking-[0.35em] text-primary/55">
                § Fixtures · page 4
              </div>
            </div>
          </FadeIn>
          <div>
            {events.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <EventsComingSoonPanel type="camp" />
            )}
          </div>
        </div>
      </section>

      {/* ===================== WHO IT'S FOR ===================== */}
      <section className="relative overflow-hidden py-20 lg:py-28 px-4 sm:px-8 border-t-2 border-b-2 border-primary bg-primary text-primary-foreground">
        <div className="relative max-w-7xl mx-auto grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <FadeIn>
            <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent">
              § Readers · Who it's for
            </div>
            <h3
              className="mt-4 font-heading font-semibold tracking-tight leading-[0.95]"
              style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}
            >
              Athletes building toward the{" "}
              <span className="italic font-normal text-accent">next level.</span>
            </h3>
            <ul className="mt-10 divide-y divide-primary-foreground/15 border-y border-primary-foreground/15">
              {WHO_ITS_FOR.map((item, i) => (
                <li key={item} className="flex items-start gap-5 py-5">
                  <span className="font-heading text-2xl font-bold tabular-nums pt-0.5 min-w-[3rem] text-accent">
                    0{i + 1}
                  </span>
                  <span className="text-base md:text-lg leading-7 text-primary-foreground/85">{item}</span>
                </li>
              ))}
            </ul>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="lg:sticky lg:top-28">
              <div className="relative p-8 md:p-10 border-2 border-accent bg-accent/[0.08]">
                <div className="absolute -top-3 -right-3 rotate-6 px-3 py-1 border-2 border-accent font-heading text-[11px] uppercase tracking-[0.3em] text-accent bg-primary">
                  Verdict
                </div>
                <p
                  className="font-heading font-semibold tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)" }}
                >
                  Better prepared.
                  <br />
                  Better built.
                  <br />
                  <span className="italic font-normal text-accent">Better informed.</span>
                </p>
                <p className="mt-6 leading-7 text-primary-foreground/80">
                  Athletes leave with a stronger performance base and, where included, a clearer view of
                  what's improving and what still needs work.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="mt-8 rounded-none bg-accent text-primary hover:bg-accent/90 font-heading font-semibold uppercase tracking-[0.15em]"
                >
                  <Link href="#register-interest">
                    Register your interest
                    <ArrowUpRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== INTAKE ===================== */}
      <section id="register-interest" className="relative py-20 lg:py-28 px-4 sm:px-8 bg-surface text-primary">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="border-b-2 border-primary pb-6 mb-10">
              <div className="font-heading text-xs uppercase tracking-[0.35em] text-accent">
                § Back page · Apply
              </div>
            </div>
            <div className="bg-background rounded-none border-2 border-primary p-6 sm:p-8">
              <InquiryForm
                defaultService="camp"
                heading="Register interest in the next camp"
                description="Leave your details and we'll get in touch as soon as camp dates are confirmed."
              />
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  )
}
