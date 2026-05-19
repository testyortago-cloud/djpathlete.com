import type { Metadata } from "next"
import { ArrowUpRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import Image from "next/image"
import { ClinicHero } from "@/components/public/ClinicHero"
import { EventsComingSoonPanel } from "@/components/public/EventsComingSoonPanel"
import { InquiryForm } from "@/components/public/InquiryForm"
import { getPublishedEvents } from "@/lib/db/events"
import { buildEventListSchema } from "@/lib/seo/build-event-list-schema"
import { EventCard } from "@/components/public/EventCard"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Speed and Agility Training Clinics",
  description:
    "Speed and agility training for athletes aged 10–18 in Tampa Bay, FL. Agility drills for athletes and a structured training program — coached in small groups of 8–12.",
  alternates: { canonical: "/clinics" },
  openGraph: {
    title: "Speed and Agility Training Clinics | DJP Athlete",
    description:
      "Speed and agility training for athletes aged 10–18 in Tampa Bay, FL. Agility drills and a structured training program — coached in small groups of 8–12.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Speed and Agility Training Clinics | DJP Athlete",
    description:
      "Speed and agility training for athletes aged 10–18 in Tampa Bay, FL. Small groups, structured progression, real coaching.",
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
  serviceType: "Speed and Agility Training — Youth Agility Clinic",
  description:
    "Speed and agility training for athletes aged 10–18. A structured speed and agility training program covering agility drills for athletes, sports agility training, and youth speed and agility training — coached in groups of 8–12 with focus on acceleration, deceleration, change of direction, and rotation.",
  url: "https://www.darrenjpaul.com/clinics",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 10–18" },
}

// Action cards. Each renders a real Pexels action photo that "explains" the
// movement (acceleration → sprint start, deceleration → braking slide, etc.).
// Pexels license: free to use, attribution appreciated but not required. The
// `images.pexels.com` host is allowlisted in next.config.mjs remotePatterns.
type ActionCard = {
  n: string
  title: string
  cue: string
  body: string
  image: {
    src: string
    /** Descriptive alt text doubling as the photographer credit for SEO. */
    alt: string
    /** Pexels photo page — useful if we ever surface attribution. */
    pexelsPage: string
  }
}

const ACTIONS: ActionCard[] = [
  {
    n: "01",
    title: "Acceleration",
    cue: "first step · project",
    body: "First-step intent, projection, and creating a better start when space opens up.",
    image: {
      src: "https://images.pexels.com/photos/19787364/pexels-photo-19787364.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750",
      alt: "Sprinters exploding out of the starting block — the acceleration phase of speed training",
      pexelsPage: "https://www.pexels.com/photo/19787364/",
    },
  },
  {
    n: "02",
    title: "Deceleration",
    cue: "brake · load · hold",
    body: "Learning to brake with control so the next action is cleaner, quicker, and more usable.",
    image: {
      src: "https://images.pexels.com/photos/27532389/pexels-photo-27532389.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750",
      alt: "Soccer player braking hard and dropping low — the eccentric load of deceleration in sport",
      pexelsPage: "https://www.pexels.com/photo/27532389/",
    },
  },
  {
    n: "03",
    title: "Change of direction",
    cue: "plant · redirect",
    body: "Sharper repositioning, better angles, and more efficient redirection under pressure.",
    image: {
      src: "https://images.pexels.com/photos/7188044/pexels-photo-7188044.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750",
      alt: "Athlete working cone drills outdoors — change-of-direction and redirection training",
      pexelsPage: "https://www.pexels.com/photo/7188044/",
    },
  },
  {
    n: "04",
    title: "Rotation",
    cue: "turn · re-orient",
    body: "Turning, re-orienting, and organising the body better in the moments that matter.",
    image: {
      src: "https://images.pexels.com/photos/17724058/pexels-photo-17724058.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750",
      alt: "Baseball player swinging through full torso rotation — the rotational power moment",
      pexelsPage: "https://www.pexels.com/photo/17724058/",
    },
  },
]

const WHO_ITS_FOR = [
  "Field and court sport athletes aged 10–18",
  "Players who want sharper movement and more confidence in open play",
  "Parents looking for proper athletic development — not just hard work for its own sake",
]

export default async function ClinicsPage() {
  const [events, waiverDoc] = await Promise.all([
    getPublishedEvents({ type: "clinic" }),
    getActiveDocument("liability_waiver"),
  ])
  const waiverContent = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null
  const eventListSchema = buildEventListSchema(events, "clinic")
  return (
    <>
      <JsonLd data={serviceSchema} />
      {eventListSchema && <JsonLd data={eventListSchema} />}
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Speed & Agility Clinics", url: "/clinics" },
        ]}
      />

      <ClinicHero />

      {/* ===================== THE COACH ===================== */}
      <section className="relative py-20 lg:py-28 px-4 sm:px-8 bg-surface">
        <div className="mx-auto max-w-6xl">
          <FadeIn>
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 items-start">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-accent">The Coach</div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] text-primary">
                  Darren J Paul
                </h2>
                <p className="mt-5 max-w-md text-muted-foreground leading-7">
                  Not cone drills for the sake of cone drills.
                </p>
                <p className="mt-4 max-w-md font-heading text-lg md:text-xl font-semibold leading-snug text-primary">
                  Designed for athletes who want their movement to{" "}
                  <span className="italic font-normal text-accent">stand out</span>, not just their effort.
                </p>
              </div>
              <div className="space-y-5 text-base md:text-lg leading-8 text-muted-foreground">
                <p>
                  Darren has spent years working alongside elite athletes across football, rugby, athletics, and court
                  sports. His understanding of agility isn't borrowed from textbooks — it comes from being in
                  environments where movement decides outcomes, and from a genuine, deep study of how athletes
                  accelerate, decelerate, and change direction under pressure. These clinics are built around that work.
                </p>
                <p>
                  Athletes are coached through the actions that decide real moments in sport: starting, stopping,
                  redirecting, and re-organising under pressure. Smaller group numbers mean better feedback, better
                  reps, and a better standard of coaching throughout.
                </p>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== WHAT GETS COACHED · PLAY CARDS ===================== */}
      <section
        id="what-gets-coached"
        className="relative py-20 lg:py-28 px-4 sm:px-8 bg-primary text-primary-foreground overflow-hidden"
      >
        {/* Faint chalk dust */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.4) 0.5px, transparent 1px), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.3) 0.5px, transparent 1px), radial-gradient(circle at 40% 80%, rgba(255,255,255,0.35) 0.5px, transparent 1px)",
            backgroundSize: "60px 60px, 80px 80px, 50px 50px",
          }}
        />

        <div className="relative max-w-7xl mx-auto">
          <FadeIn>
            <div className="max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-accent">What gets coached</div>
              <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
                Agility work with
                <br />
                <span className="italic font-normal text-accent">proper coaching behind it.</span>
              </h2>
              <p className="mt-5 text-primary-foreground/70 leading-7">
                Built around the movement actions that show up again and again in competitive sport. Less filler. More
                transfer.
              </p>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {ACTIONS.map((a) => (
                <div
                  key={a.n}
                  className="group relative rounded-2xl border border-primary-foreground/15 bg-primary-foreground/[0.03] overflow-hidden transition-colors hover:border-accent/50 hover:bg-primary-foreground/[0.06]"
                >
                  {/* Faux chalkboard header strip */}
                  <div className="flex items-center justify-between px-5 pt-5">
                    <span className="font-mono text-xl font-semibold tabular-nums text-accent">{a.n}</span>
                    <span className="text-[10px] uppercase tracking-[0.25em] text-primary-foreground/50">{a.cue}</span>
                  </div>
                  {/* Real action photo (Pexels — free license) */}
                  <div className="relative mx-5 mt-3 aspect-[5/3] overflow-hidden rounded-md bg-primary-foreground/5">
                    <Image
                      src={a.image.src}
                      alt={a.image.alt}
                      fill
                      sizes="(min-width: 1280px) 22vw, (min-width: 768px) 45vw, 90vw"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="px-5 pb-6 pt-2">
                    <h3 className="font-heading text-xl font-semibold tracking-tight">{a.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-primary-foreground/65">{a.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== UPCOMING ===================== */}
      <section className="mx-auto max-w-7xl px-4 py-20 md:px-6 md:py-28">
        <FadeIn>
          <div className="flex items-end justify-between flex-wrap gap-6">
            <div className="max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Upcoming dates</div>
              <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight md:text-5xl text-primary">
                When and where
              </h2>
              <p className="mt-4 text-muted-foreground leading-7">Places are limited to 12 per session.</p>
            </div>
          </div>
          <div className="mt-10">
            {events.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} waiverContent={waiverContent} />
                ))}
              </div>
            ) : (
              <EventsComingSoonPanel type="clinic" />
            )}
          </div>
        </FadeIn>
      </section>

      {/* ===================== WHO IT'S FOR ===================== */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="relative mx-auto max-w-7xl px-4 py-20 md:px-6 md:py-28">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <FadeIn>
              <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Who it's for</div>
              <h3 className="mt-4 font-heading text-4xl font-semibold tracking-tight leading-[1.03] md:text-5xl lg:text-6xl">
                Athletes who want to look and <span className="italic font-normal text-accent">feel</span> more
                effective in sport.
              </h3>
              <ul className="mt-10 divide-y divide-primary-foreground/10 border-y border-primary-foreground/10">
                {WHO_ITS_FOR.map((item, i) => (
                  <li key={item} className="flex items-start gap-5 py-5">
                    <span className="font-heading text-2xl tabular-nums text-accent pt-0.5 min-w-[3rem]">0{i + 1}</span>
                    <span className="text-base md:text-lg leading-7 text-primary-foreground/85">{item}</span>
                  </li>
                ))}
              </ul>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="lg:sticky lg:top-28">
                <div className="relative rounded-3xl border-2 border-dashed border-accent/40 bg-accent/[0.05] p-8 md:p-10">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Outcome</div>
                  <p className="mt-3 font-heading text-3xl font-semibold tracking-tight leading-tight md:text-4xl">
                    Better movement.
                    <br />
                    Better control.
                    <br />
                    <span className="italic font-normal text-accent">Better transfer.</span>
                  </p>
                  <p className="mt-6 leading-7 text-primary-foreground/75">
                    Athletes leave with clearer movement understanding, sharper agility mechanics, and better confidence
                    when the game becomes less predictable.
                  </p>
                  <Button asChild size="lg" className="mt-8 rounded-full bg-accent text-primary hover:bg-accent/90">
                    <Link href="#register-interest">
                      Register your interest
                      <ArrowUpRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      <section id="register-interest" className="bg-surface border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-20 md:px-6 md:py-28">
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
