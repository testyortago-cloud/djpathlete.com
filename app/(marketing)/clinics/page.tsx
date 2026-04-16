import type { Metadata } from "next"
import { ArrowUpRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ClinicHero } from "@/components/public/ClinicHero"
import { EventsComingSoonPanel } from "@/components/public/EventsComingSoonPanel"
import { InquiryForm } from "@/components/public/InquiryForm"
import { getPublishedEvents } from "@/lib/db/events"
import { EventCard } from "@/components/public/EventCard"

export const dynamic = "force-dynamic"

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
    worksFor: { "@type": "Organization", name: "DJP Athlete", url: "https://djpathlete.com" },
  },
  serviceType: "Youth Agility Clinic",
  description:
    "2-hour agility coaching clinics for youth athletes aged 12–18, focused on acceleration, deceleration, change of direction, and rotation.",
  url: "https://djpathlete.com/clinics",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 12–18" },
}

// Action diagrams — each rendered inline as a mini-play
type ActionDiagram = {
  n: string
  title: string
  cue: string
  body: string
  diagram: React.ReactNode
}

const ACTIONS: ActionDiagram[] = [
  {
    n: "01",
    title: "Acceleration",
    cue: "first step · project",
    body: "First-step intent, projection, and creating a better start when space opens up.",
    diagram: (
      <svg viewBox="0 0 200 120" className="w-full h-full" aria-hidden>
        {/* Player X */}
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="30" y1="85" x2="45" y2="100" />
          <line x1="45" y1="85" x2="30" y2="100" />
        </g>
        {/* Burst arrow */}
        <path
          d="M 55 92 L 170 30"
          fill="none"
          stroke="oklch(0.70 0.08 60)"
          strokeWidth="2.5"
          strokeDasharray="8 5"
          strokeLinecap="round"
          markerEnd="url(#ah1)"
        />
        {/* Acceleration step marks */}
        <g fill="oklch(0.70 0.08 60 / 0.6)">
          <circle cx="80" cy="72" r="2.5" />
          <circle cx="105" cy="58" r="2.5" />
          <circle cx="130" cy="46" r="2.5" />
        </g>
        <defs>
          <marker
            id="ah1"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.70 0.08 60)" />
          </marker>
        </defs>
      </svg>
    ),
  },
  {
    n: "02",
    title: "Deceleration",
    cue: "brake · load · hold",
    body: "Learning to brake with control so the next action is cleaner, quicker, and more usable.",
    diagram: (
      <svg viewBox="0 0 200 120" className="w-full h-full" aria-hidden>
        {/* Incoming path slowing */}
        <path
          d="M 30 30 L 150 90"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeDasharray="10 6"
          strokeLinecap="round"
        />
        {/* Brake hash marks */}
        <g stroke="oklch(0.70 0.08 60)" strokeWidth="3" strokeLinecap="round">
          <line x1="82" y1="62" x2="98" y2="52" />
          <line x1="98" y1="72" x2="114" y2="62" />
          <line x1="114" y1="82" x2="130" y2="72" />
        </g>
        {/* Player X stopped */}
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="145" y1="82" x2="160" y2="97" />
          <line x1="160" y1="82" x2="145" y2="97" />
        </g>
        {/* STOP marker */}
        <circle cx="152" cy="90" r="18" fill="none" stroke="oklch(0.70 0.08 60)" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    n: "03",
    title: "Change of direction",
    cue: "plant · redirect",
    body: "Sharper repositioning, better angles, and more efficient redirection under pressure.",
    diagram: (
      <svg viewBox="0 0 200 120" className="w-full h-full" aria-hidden>
        {/* Approach */}
        <path
          d="M 25 90 L 100 45"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeDasharray="8 5"
          strokeLinecap="round"
        />
        {/* Cut */}
        <path
          d="M 100 45 L 175 100"
          fill="none"
          stroke="oklch(0.70 0.08 60)"
          strokeWidth="2.5"
          strokeDasharray="8 5"
          strokeLinecap="round"
          markerEnd="url(#ah3)"
        />
        {/* Plant foot marker */}
        <circle cx="100" cy="45" r="6" fill="oklch(0.70 0.08 60)" />
        <circle cx="100" cy="45" r="12" fill="none" stroke="oklch(0.70 0.08 60)" strokeWidth="1.2" strokeDasharray="2 3" />
        <defs>
          <marker
            id="ah3"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.70 0.08 60)" />
          </marker>
        </defs>
      </svg>
    ),
  },
  {
    n: "04",
    title: "Rotation",
    cue: "turn · re-orient",
    body: "Turning, re-orienting, and organising the body better in the moments that matter.",
    diagram: (
      <svg viewBox="0 0 200 120" className="w-full h-full" aria-hidden>
        {/* Spiral / rotation arc */}
        <path
          d="M 100 30 A 35 35 0 1 0 135 65"
          fill="none"
          stroke="oklch(0.70 0.08 60)"
          strokeWidth="2.5"
          strokeDasharray="6 4"
          strokeLinecap="round"
          markerEnd="url(#ah4)"
        />
        <path
          d="M 100 30 A 60 60 0 1 1 160 90"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1.5"
          strokeDasharray="2 4"
          strokeLinecap="round"
        />
        {/* Center pivot */}
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="93" y1="53" x2="107" y2="67" />
          <line x1="107" y1="53" x2="93" y2="67" />
        </g>
        <defs>
          <marker
            id="ah4"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.70 0.08 60)" />
          </marker>
        </defs>
      </svg>
    ),
  },
]

const FLOW_STEPS = [
  {
    n: "I",
    title: "Prep the body",
    detail: "Purposeful warm-up and movement prep — not filler jogs and static stretches.",
  },
  {
    n: "II",
    title: "Coach the actions",
    detail: "Each action is introduced, cued, and drilled with clear technical feedback.",
  },
  {
    n: "III",
    title: "Build reaction",
    detail: "Reactive tasks layer stimulus and decision-making onto the movement.",
  },
  {
    n: "IV",
    title: "Pressure & compete",
    detail: "Finish with pressure and competition so skills become useable under stress.",
  },
]

const WHO_ITS_FOR = [
  "Field and court sport athletes aged 12–18",
  "Players who want sharper movement and more confidence in open play",
  "Parents looking for better athletic development, not generic hard work",
]

export default async function ClinicsPage() {
  const events = await getPublishedEvents({ type: "clinic" })
  return (
    <>
      <JsonLd data={serviceSchema} />

      <ClinicHero />

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
              <div className="text-[11px] uppercase tracking-[0.3em] text-accent">The Playbook</div>
              <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
                Four plays.
                <br />
                <span className="italic font-normal text-accent">Drawn up properly.</span>
              </h2>
              <p className="mt-5 text-primary-foreground/70 leading-7">
                Built around the movement actions that show up again and again in competitive sport. Less
                filler. More transfer.
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
                    <span className="font-mono text-xl font-semibold tabular-nums text-accent">
                      {a.n}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.25em] text-primary-foreground/50">
                      {a.cue}
                    </span>
                  </div>
                  {/* Diagram */}
                  <div className="relative mx-5 mt-3 aspect-[5/3] text-primary-foreground/80">
                    {a.diagram}
                  </div>
                  <div className="px-5 pb-6 pt-2">
                    <h3 className="font-heading text-xl font-semibold tracking-tight">{a.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-primary-foreground/65">{a.body}</p>
                  </div>
                  {/* Corner tape effect */}
                  <div className="absolute top-0 right-0 size-6 border-t border-r border-accent/40" />
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== HOW IT RUNS · PLAY SEQUENCE ===================== */}
      <section className="py-20 lg:py-28 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Session plan</div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] text-primary">
                  Coach first.
                  <br />
                  <span className="italic font-normal text-accent">Then challenge it.</span>
                </h2>
                <p className="mt-5 text-muted-foreground leading-7 max-w-md">
                  A clear progression so quality comes before pressure. The session builds understanding,
                  then asks athletes to use it.
                </p>
              </div>

              {/* Play sequence diagram */}
              <div className="relative">
                {/* Connecting dashed line */}
                <div
                  className="absolute left-0 right-0 top-[31px] hidden md:block"
                  aria-hidden
                  style={{
                    borderTop: "2px dashed oklch(0.70 0.08 60 / 0.5)",
                  }}
                />
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  {FLOW_STEPS.map((step) => (
                    <div key={step.n} className="relative text-center md:text-left">
                      <div className="relative mx-auto md:mx-0 flex size-16 items-center justify-center rounded-full bg-background border-2 border-primary shadow-sm">
                        <span className="font-heading text-lg font-semibold text-primary tracking-wider">
                          {step.n}
                        </span>
                      </div>
                      <h3 className="mt-4 font-heading text-lg font-semibold text-primary tracking-tight">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== UPCOMING ===================== */}
      <section className="mx-auto max-w-7xl px-4 py-20 md:px-6 md:py-28">
        <FadeIn>
          <div className="flex items-end justify-between flex-wrap gap-6">
            <div className="max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Next fixtures</div>
              <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight md:text-5xl text-primary">
                When and where
              </h2>
            </div>
          </div>
          <div className="mt-10">
            {events.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
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
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.3) 0 1px, transparent 1px 60px)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-4 py-20 md:px-6 md:py-28">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <FadeIn>
              <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Who it's for</div>
              <h3 className="mt-4 font-heading text-4xl font-semibold tracking-tight leading-[1.03] md:text-5xl lg:text-6xl">
                Athletes who want to look and{" "}
                <span className="italic font-normal text-accent">feel</span> more effective in sport.
              </h3>
              <ul className="mt-10 divide-y divide-primary-foreground/10 border-y border-primary-foreground/10">
                {WHO_ITS_FOR.map((item, i) => (
                  <li key={item} className="flex items-start gap-5 py-5">
                    <span className="font-heading text-2xl tabular-nums text-accent pt-0.5 min-w-[3rem]">
                      0{i + 1}
                    </span>
                    <span className="text-base md:text-lg leading-7 text-primary-foreground/85">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="lg:sticky lg:top-28">
                <div className="relative rounded-3xl border-2 border-dashed border-accent/40 bg-accent/[0.05] p-8 md:p-10">
                  {/* Tape corners */}
                  <div className="absolute -top-2 left-6 h-4 w-16 bg-accent/30 rotate-[-3deg]" aria-hidden />
                  <div className="absolute -bottom-2 right-6 h-4 w-16 bg-accent/30 rotate-[2deg]" aria-hidden />

                  <div className="text-[11px] uppercase tracking-[0.3em] text-accent">Final whistle</div>
                  <p className="mt-3 font-heading text-3xl font-semibold tracking-tight leading-tight md:text-4xl">
                    Better movement.
                    <br />
                    Better control.
                    <br />
                    <span className="italic font-normal text-accent">Better transfer.</span>
                  </p>
                  <p className="mt-6 leading-7 text-primary-foreground/75">
                    Athletes leave with clearer movement understanding, sharper agility mechanics, and better
                    confidence when the game becomes less predictable.
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
