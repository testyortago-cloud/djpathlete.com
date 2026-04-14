import type { Metadata } from "next"
import { ChevronRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ClinicHero } from "@/components/public/ClinicHero"
import { FocusGrid, type FocusItem } from "@/components/public/FocusGrid"
import { NumberedFlow } from "@/components/public/NumberedFlow"
import { EventsComingSoonPanel } from "@/components/public/EventsComingSoonPanel"
import { InquiryForm } from "@/components/public/InquiryForm"

export const metadata: Metadata = {
  title: "Agility Clinics",
  description:
    "2-hour agility coaching clinics for athletes aged 12–18. Acceleration, deceleration, change of direction, and rotation — coached in small groups for serious feedback.",
  openGraph: {
    title: "Agility Clinics | DJP Athlete",
    description:
      "2-hour agility coaching clinics for athletes aged 12–18. Small groups, proper coaching, real transfer to sport.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agility Clinics | DJP Athlete",
    description:
      "2-hour agility coaching clinics for athletes aged 12–18. Small groups, proper coaching, real transfer to sport.",
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
  serviceType: "Youth Agility Clinic",
  description:
    "2-hour agility coaching clinics for youth athletes aged 12–18, focused on acceleration, deceleration, change of direction, and rotation.",
  url: "https://djpathlete.com/clinics",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 12–18" },
}

const FOCUS_ITEMS: FocusItem[] = [
  {
    title: "Acceleration",
    body: "First-step intent, projection, and creating a better start when space opens up.",
  },
  {
    title: "Deceleration",
    body: "Learning to brake with control so the next action is cleaner, quicker, and more usable.",
  },
  {
    title: "Change of Direction",
    body: "Sharper repositioning, better angles, and more efficient redirection under pressure.",
  },
  {
    title: "Rotation",
    body: "Turning, re-orienting, and organising the body better in the moments that matter.",
  },
]

const FLOW_STEPS = [
  "Prep the body properly",
  "Coach the key actions clearly",
  "Build it into reactive tasks",
  "Finish with pressure and competition",
]

const WHO_ITS_FOR = [
  "Field and court sport athletes aged 12–18",
  "Players who want sharper movement and more confidence in open play",
  "Parents looking for better athletic development, not generic hard work",
]

export default function ClinicsPage() {
  return (
    <>
      <JsonLd data={serviceSchema} />

      <ClinicHero />

      <section id="what-gets-coached" className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">What gets coached</div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              Agility work with proper coaching behind it.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              Built around the movement actions that show up again and again in competitive sport. Less filler. More
              transfer.
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
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">How it runs</div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              Coach first. Then challenge it.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              A clear progression so quality comes before pressure. The session builds understanding, then asks athletes
              to use it.
            </p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <NumberedFlow steps={FLOW_STEPS} />
          </FadeIn>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">Upcoming dates</div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">When and where</h2>
          </div>
          <div className="mt-10">
            <EventsComingSoonPanel type="clinic" />
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
                  Athletes who want to look and feel more effective in sport.
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
                  Better movement. Better control. Better transfer.
                </div>
                <p className="mt-5 leading-8 text-muted-foreground">
                  Athletes leave with clearer movement understanding, sharper agility mechanics, and better confidence
                  when the game becomes less predictable.
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
              defaultService="clinic"
              heading="Register interest in the next clinic"
              description="Leave your details and we'll get in touch as soon as a clinic is scheduled."
            />
          </FadeIn>
        </div>
      </section>
    </>
  )
}
