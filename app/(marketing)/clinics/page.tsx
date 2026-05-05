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
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Speed and Agility Training Clinics",
  description:
    "Speed and agility training for athletes aged 10–18. Agility drills for athletes and a structured speed and agility training program — coached in small groups of 8–12 for real feedback and transfer to sport.",
  alternates: { canonical: "/clinics" },
  openGraph: {
    title: "Speed and Agility Training Clinics | DJP Athlete",
    description:
      "Speed and agility training for athletes aged 10–18. Agility training for athletes in small groups with a sports agility coach — real feedback, real transfer to sport.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Speed and Agility Training Clinics | DJP Athlete",
    description:
      "Speed and agility training for athletes aged 10–18. Small groups, proper coaching, real transfer to sport.",
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
  keywords:
    "speed and agility training, agility drills for athletes, speed and agility training program, agility training for athletes, speed and agility training near me, speed and agility training for youth, youth speed and agility training, sports agility training",
  url: "https://www.darrenjpaul.com/clinics",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 10–18" },
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
        <defs>
          <marker id="ah1" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.70 0.08 60)" />
          </marker>
        </defs>
        {/* Ground line */}
        <line
          x1="10"
          y1="102"
          x2="190"
          y2="102"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {/* Starting line (two tick marks) */}
        <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round">
          <line x1="22" y1="95" x2="22" y2="108" />
          <line x1="28" y1="95" x2="28" y2="108" />
        </g>
        {/* Sprinter in drive phase */}
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
          <circle cx="44" cy="66" r="5" fill="currentColor" stroke="none" />
          <line x1="46" y1="70" x2="54" y2="88" />
          <line x1="50" y1="76" x2="60" y2="70" />
          <line x1="50" y1="78" x2="42" y2="86" />
          <line x1="54" y1="88" x2="64" y2="100" />
          <line x1="54" y1="88" x2="44" y2="100" />
        </g>
        {/* Track cones getting smaller (perspective) */}
        <g stroke="oklch(0.70 0.08 60)" strokeWidth="1.2" fill="oklch(0.70 0.08 60 / 0.4)">
          <polygon points="92,66 86,78 98,78" />
          <polygon points="122,52 117,62 127,62" />
          <polygon points="150,40 146,48 154,48" />
        </g>
        {/* Burst arrow */}
        <path
          d="M 68 70 L 178 22"
          fill="none"
          stroke="oklch(0.70 0.08 60)"
          strokeWidth="2.5"
          strokeDasharray="8 5"
          strokeLinecap="round"
          markerEnd="url(#ah1)"
        />
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
        {/* Ground line */}
        <line
          x1="10"
          y1="102"
          x2="190"
          y2="102"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {/* Incoming path (fading dashes) */}
        <path
          d="M 18 36 L 118 78"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeDasharray="10 6"
          strokeLinecap="round"
        />
        {/* Brake hash marks */}
        <g stroke="oklch(0.70 0.08 60)" strokeWidth="2.5" strokeLinecap="round">
          <line x1="72" y1="62" x2="86" y2="54" />
          <line x1="85" y1="70" x2="99" y2="62" />
          <line x1="98" y1="78" x2="112" y2="70" />
        </g>
        {/* Athlete braking — torso back, front leg planted */}
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
          <circle cx="128" cy="54" r="5" fill="currentColor" stroke="none" />
          <line x1="128" y1="58" x2="134" y2="82" />
          <line x1="130" y1="66" x2="120" y2="60" />
          <line x1="132" y1="72" x2="144" y2="68" />
          <line x1="134" y1="82" x2="144" y2="100" />
          <line x1="134" y1="82" x2="124" y2="100" />
        </g>
        {/* Cone at brake target */}
        <g stroke="oklch(0.70 0.08 60)" strokeWidth="1.5" fill="oklch(0.70 0.08 60 / 0.5)">
          <polygon points="170,78 162,98 178,98" />
          <ellipse cx="170" cy="100" rx="8" ry="2" fill="none" strokeOpacity="0.6" strokeWidth="1" />
        </g>
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
        <defs>
          <marker id="ah3" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.70 0.08 60)" />
          </marker>
        </defs>
        {/* Ground line */}
        <line
          x1="10"
          y1="102"
          x2="190"
          y2="102"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {/* Approach */}
        <path
          d="M 18 88 L 94 48"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeDasharray="8 5"
          strokeLinecap="round"
        />
        {/* Cone at cut point */}
        <g>
          <polygon
            points="100,32 90,54 110,54"
            fill="oklch(0.70 0.08 60 / 0.55)"
            stroke="currentColor"
            strokeOpacity="0.8"
            strokeWidth="1.8"
          />
          <rect x="94" y="40" width="12" height="3" fill="currentColor" fillOpacity="0.2" />
          <ellipse
            cx="100"
            cy="55"
            rx="11"
            ry="3"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </g>
        {/* Plant foot marker */}
        <ellipse cx="92" cy="62" rx="5" ry="3" fill="oklch(0.70 0.08 60)" transform="rotate(-30, 92, 62)" />
        <circle
          cx="92"
          cy="62"
          r="10"
          fill="none"
          stroke="oklch(0.70 0.08 60)"
          strokeWidth="1"
          strokeDasharray="2 3"
          strokeOpacity="0.6"
        />
        {/* Exit cut */}
        <path
          d="M 100 64 L 178 104"
          fill="none"
          stroke="oklch(0.70 0.08 60)"
          strokeWidth="2.5"
          strokeDasharray="8 5"
          strokeLinecap="round"
          markerEnd="url(#ah3)"
        />
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
        <defs>
          <marker id="ah4" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.70 0.08 60)" />
          </marker>
        </defs>
        {/* Ground line */}
        <line
          x1="10"
          y1="108"
          x2="190"
          y2="108"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {/* Central pivot cone */}
        <g>
          <polygon
            points="100,40 88,66 112,66"
            fill="oklch(0.70 0.08 60 / 0.5)"
            stroke="currentColor"
            strokeOpacity="0.8"
            strokeWidth="1.8"
          />
          <rect x="93" y="50" width="14" height="3" fill="currentColor" fillOpacity="0.2" />
          <ellipse
            cx="100"
            cy="67"
            rx="13"
            ry="3"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </g>
        {/* Rotation arc around cone */}
        <path
          d="M 100 22 A 38 38 0 1 0 138 60"
          fill="none"
          stroke="oklch(0.70 0.08 60)"
          strokeWidth="2.5"
          strokeDasharray="6 4"
          strokeLinecap="round"
          markerEnd="url(#ah4)"
        />
        {/* Footprints tracing the rotation */}
        <g fill="currentColor" fillOpacity="0.4">
          <ellipse cx="138" cy="28" rx="2.5" ry="4" transform="rotate(35, 138, 28)" />
          <ellipse cx="155" cy="58" rx="2.5" ry="4" transform="rotate(85, 155, 58)" />
          <ellipse cx="146" cy="86" rx="2.5" ry="4" transform="rotate(135, 146, 86)" />
        </g>
        {/* Athlete outside arc (body marker) */}
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none">
          <circle cx="62" cy="50" r="4" fill="currentColor" stroke="none" />
          <line x1="62" y1="54" x2="62" y2="72" />
          <line x1="62" y1="60" x2="54" y2="68" />
          <line x1="62" y1="60" x2="70" y2="64" />
        </g>
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
  return (
    <>
      <JsonLd data={serviceSchema} />

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
                  {/* Diagram */}
                  <div className="relative mx-5 mt-3 aspect-[5/3] text-primary-foreground/80">{a.diagram}</div>
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
                  A clear progression so quality comes before pressure. The session builds understanding, then asks
                  athletes to use it.
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
                        <span className="font-heading text-lg font-semibold text-primary tracking-wider">{step.n}</span>
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
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.3) 0 1px, transparent 1px 60px)",
          }}
        />
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
                  {/* Tape corners */}
                  <div className="absolute -top-2 left-6 h-4 w-16 bg-accent/30 rotate-[-3deg]" aria-hidden />
                  <div className="absolute -bottom-2 right-6 h-4 w-16 bg-accent/30 rotate-[2deg]" aria-hidden />

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
