import type { Metadata } from "next"
import { ChevronRight, Radar } from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CampHero } from "@/components/public/CampHero"
import { FocusGrid, type FocusItem } from "@/components/public/FocusGrid"
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
    worksFor: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
    },
  },
  serviceType: "Off-Season / Pre-Season Performance Camp",
  description: "Multi-week off-season and pre-season athletic performance camps for youth athletes aged 12–18.",
  url: "https://djpathlete.com/camps",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 12–18" },
}

const FOCUS_ITEMS: FocusItem[] = [
  {
    title: "Speed + Power",
    body: "Acceleration, sprint mechanics, jumping, explosive outputs, and force expression.",
  },
  {
    title: "Strength Qualities",
    body: "Physical qualities that support robustness, force transfer, and repeatable performance.",
  },
  {
    title: "Movement Quality",
    body: "Better rhythm, posture, coordination, and control through athletic actions.",
  },
  {
    title: "Conditioning",
    body: "Capacity to train, recover, and compete without turning sessions into random suffering.",
  },
]

const TECH_ITEMS = [
  "Selected testing where appropriate",
  "Useful performance insight",
  "Clear summary reporting",
  "Feedback athletes can act on",
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

      <section id="what-gets-developed" className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">What gets developed</div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              A stronger, more complete performance base.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              Wider than agility alone. Built to help athletes develop the qualities that support performance before the
              competitive period ramps up.
            </p>
          </div>
          <div className="mt-10">
            <FocusGrid items={FOCUS_ITEMS} />
          </div>
        </FadeIn>
      </section>

      <section className="bg-surface border-y border-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:px-6 md:py-20 lg:grid-cols-[0.95fr_1.05fr]">
          <FadeIn>
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">Technology + feedback</div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              Train with more visibility on progress.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              Where appropriate, selected testing and reporting add another layer to the camp experience. Not to
              overcomplicate it — to make progress more visible and useful.
            </p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="grid gap-4 md:grid-cols-2">
              {TECH_ITEMS.map((item) => (
                <Card key={item} className="rounded-2xl border-border bg-background">
                  <CardContent className="flex items-start gap-3 p-5 text-foreground">
                    <Radar className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
                    <div>{item}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">Upcoming blocks</div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              When the next camp runs
            </h2>
          </div>
          <div className="mt-10">
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
        </FadeIn>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr]">
          <FadeIn>
            <Card className="rounded-3xl border-border bg-background">
              <CardContent className="p-8">
                <div className="text-sm uppercase tracking-[0.25em] text-accent">Who it is for</div>
                <h3 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
                  Athletes building toward the next level.
                </h3>
                <div className="mt-7 space-y-4 text-muted-foreground">
                  {WHO_ITS_FOR.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <ChevronRight className="mt-1 h-5 w-5 text-accent" />
                      <div>{item}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1}>
            <Card className="rounded-3xl border-border bg-gradient-to-br from-accent/10 to-surface">
              <CardContent className="p-8">
                <div className="text-sm uppercase tracking-[0.25em] text-muted-foreground">Outcome</div>
                <div className="mt-4 font-heading text-3xl font-semibold tracking-tight">
                  Better prepared. Better built. Better informed.
                </div>
                <p className="mt-5 leading-8 text-muted-foreground">
                  Athletes leave with a stronger performance base and, where included, a clearer view of what is
                  improving and what still needs work.
                </p>
                <Button asChild className="mt-8 rounded-full">
                  <Link href="#register-interest">Register Your Interest</Link>
                </Button>
              </CardContent>
            </Card>
          </FadeIn>
        </div>
      </section>

      <section id="register-interest" className="bg-surface border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-20">
          <FadeIn>
            <InquiryForm
              defaultService="camp"
              heading="Register interest in the next camp"
              description="Leave your details and we'll get in touch as soon as camp dates are confirmed."
            />
          </FadeIn>
        </div>
      </section>
    </>
  )
}
