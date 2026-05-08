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
  title: "Speed & Agility Training Clinics in Tampa Bay, FL",
  description:
    "Speed and agility training clinics for athletes aged 10–18 in Zephyrhills, FL (Tampa Bay area). Small groups of 8–12, structured progression, and real coaching — not generic cone drills.",
  alternates: { canonical: "/clinics" },
  openGraph: {
    title: "Speed & Agility Training Clinics in Tampa Bay, FL | DJP Athlete",
    description:
      "Speed and agility training clinics for athletes aged 10–18. Small groups, structured progression, and real coaching at our Zephyrhills, FL facility.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Speed & Agility Training Clinics in Tampa Bay, FL | DJP Athlete",
    description:
      "Speed and agility training for athletes aged 10–18 in Zephyrhills, FL. Small groups, structured progression, real coaching.",
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

// Action diagrams — each rendered inline as a mini-play
type ActionDiagram = {
  n: string
  title: string
  cue: string
  body: string
  diagram: React.ReactNode
}

// Action-phase diagrams.
// Unified telemetry/biomechanics-lab aesthetic — no stick figures.
// Each plot reads as motion-as-data: dot-grid baseline, primary-color
// schematic, accent-color dynamic vector, mono-font micro-annotation.
// Designed to pair with the pit-wall pattern on /online and the
// Five Pillar diagnostic vocabulary throughout the brand.
const ACCENT = "oklch(0.70 0.08 60)"

const ACTIONS: ActionDiagram[] = [
  {
    n: "01",
    title: "Acceleration",
    cue: "first step · project",
    body: "First-step intent, projection, and creating a better start when space opens up.",
    diagram: (
      <svg viewBox="0 0 200 120" className="w-full h-full" aria-hidden>
        <defs>
          <pattern id="dot-grid-01" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill="currentColor" fillOpacity="0.18" />
          </pattern>
          <linearGradient id="vel-01" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.15" />
            <stop offset="60%" stopColor={ACCENT} stopOpacity="0.85" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="1" />
          </linearGradient>
          <marker id="ah-01" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={ACCENT} />
          </marker>
          <radialGradient id="halo-01" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.5" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="200" height="120" fill="url(#dot-grid-01)" />

        {/* baseline */}
        <line x1="14" y1="100" x2="186" y2="100" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="2 3" />

        {/* launch zone — starting block schematic */}
        <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="square">
          <line x1="22" y1="92" x2="22" y2="100" />
          <line x1="28" y1="88" x2="28" y2="100" />
          <line x1="34" y1="92" x2="34" y2="100" />
        </g>
        <line x1="20" y1="100" x2="36" y2="100" stroke={ACCENT} strokeOpacity="0.9" strokeWidth="1.5" strokeLinecap="round" />

        {/* impulse halo at launch point */}
        <circle cx="34" cy="98" r="14" fill="url(#halo-01)" />
        <circle cx="34" cy="98" r="3" fill={ACCENT} />

        {/* force-production dots — vertical impulse stack */}
        <g fill={ACCENT}>
          <circle cx="44" cy="92" r="1.5" opacity="0.95" />
          <circle cx="44" cy="84" r="1.5" opacity="0.8" />
          <circle cx="44" cy="76" r="1.5" opacity="0.6" />
          <circle cx="44" cy="68" r="1.5" opacity="0.4" />
          <circle cx="44" cy="60" r="1.5" opacity="0.22" />
        </g>

        {/* velocity step bars — short → long */}
        <g stroke={ACCENT} strokeWidth="2" strokeLinecap="round">
          <line x1="56" y1="92" x2="64" y2="92" opacity="0.4" />
          <line x1="68" y1="84" x2="86" y2="84" opacity="0.62" />
          <line x1="90" y1="74" x2="118" y2="74" opacity="0.85" />
        </g>

        {/* main projection arc */}
        <path
          d="M 34 98 Q 110 88 178 24"
          fill="none"
          stroke="url(#vel-01)"
          strokeWidth="2.6"
          strokeLinecap="round"
          markerEnd="url(#ah-01)"
        />

        {/* telemetry label */}
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="6" fill="currentColor" fillOpacity="0.55" letterSpacing="0.15em">
          <text x="138" y="14">V → V&#x2092;&#x2090;&#x2093;</text>
        </g>
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="5.5" fill="currentColor" fillOpacity="0.4" letterSpacing="0.1em">
          <text x="22" y="114">t&#x2080;</text>
        </g>
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
        <defs>
          <pattern id="dot-grid-02" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill="currentColor" fillOpacity="0.18" />
          </pattern>
          <linearGradient id="vel-02" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.65" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.2" />
          </linearGradient>
          <radialGradient id="halo-02" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.45" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="200" height="120" fill="url(#dot-grid-02)" />

        {/* baseline */}
        <line x1="14" y1="100" x2="186" y2="100" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="2 3" />

        {/* incoming velocity — long dashes that compress (deceleration profile) */}
        <g stroke="url(#vel-02)" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <line x1="20" y1="44" x2="46" y2="52" />
          <line x1="50" y1="53" x2="72" y2="60" />
          <line x1="76" y1="61" x2="92" y2="66" />
          <line x1="96" y1="67" x2="106" y2="70" />
          <line x1="110" y1="71" x2="116" y2="72" />
        </g>

        {/* brake zone — eccentric load corridor */}
        <g>
          <rect x="120" y="58" width="44" height="34" fill={ACCENT} fillOpacity="0.06" stroke={ACCENT} strokeOpacity="0.55" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="120" y1="58" x2="164" y2="92" stroke={ACCENT} strokeOpacity="0.18" strokeWidth="0.6" />
          <line x1="120" y1="92" x2="164" y2="58" stroke={ACCENT} strokeOpacity="0.18" strokeWidth="0.6" />
        </g>

        {/* eccentric force bars (vertical) — load is greatest at brake */}
        <g stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round">
          <line x1="128" y1="74" x2="128" y2="58" opacity="0.5" />
          <line x1="138" y1="78" x2="138" y2="50" opacity="0.75" />
          <line x1="148" y1="80" x2="148" y2="46" opacity="0.92" />
          <line x1="158" y1="80" x2="158" y2="50" opacity="0.7" />
        </g>

        {/* impact halo at hold point */}
        <circle cx="162" cy="78" r="14" fill="url(#halo-02)" />

        {/* control point — concentric stop indicator */}
        <g>
          <circle cx="162" cy="78" r="9" fill="none" stroke={ACCENT} strokeOpacity="0.4" strokeWidth="1" />
          <circle cx="162" cy="78" r="5" fill="none" stroke={ACCENT} strokeWidth="1.5" />
          <circle cx="162" cy="78" r="2" fill={ACCENT} />
        </g>

        {/* telemetry labels */}
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="6" fill="currentColor" fillOpacity="0.55" letterSpacing="0.15em">
          <text x="20" y="34">V&#x2080;</text>
          <text x="156" y="40">V → 0</text>
        </g>
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="5.5" fill="currentColor" fillOpacity="0.4" letterSpacing="0.12em">
          <text x="124" y="108">BRAKE · LOAD · HOLD</text>
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
          <pattern id="dot-grid-03" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill="currentColor" fillOpacity="0.18" />
          </pattern>
          <marker id="ah-03" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={ACCENT} />
          </marker>
          <radialGradient id="halo-03" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.5" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="200" height="120" fill="url(#dot-grid-03)" />

        {/* baseline */}
        <line x1="14" y1="100" x2="186" y2="100" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="2 3" />

        {/* approach vector */}
        <path
          d="M 22 84 L 90 50"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
        {/* approach tick — distance ladder */}
        <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" strokeLinecap="round">
          <line x1="35" y1="79" x2="38" y2="73" />
          <line x1="55" y1="69" x2="58" y2="63" />
          <line x1="75" y1="59" x2="78" y2="53" />
        </g>

        {/* plant point — bullseye / pressure target */}
        <circle cx="100" cy="48" r="22" fill="url(#halo-03)" />
        <g>
          <circle cx="100" cy="48" r="14" fill="none" stroke={ACCENT} strokeOpacity="0.3" strokeWidth="0.8" strokeDasharray="2 3" />
          <circle cx="100" cy="48" r="9" fill="none" stroke={ACCENT} strokeOpacity="0.55" strokeWidth="1" />
          <circle cx="100" cy="48" r="5" fill="none" stroke={ACCENT} strokeWidth="1.6" />
          <circle cx="100" cy="48" r="2" fill={ACCENT} />
        </g>
        {/* foot-angle indicator at plant */}
        <line x1="100" y1="48" x2="86" y2="38" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" />

        {/* angle arc between incoming and outgoing vectors */}
        <path
          d="M 84 38 A 18 18 0 0 0 116 64"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {/* outgoing redirect */}
        <path
          d="M 100 56 L 178 100"
          fill="none"
          stroke={ACCENT}
          strokeWidth="2.6"
          strokeDasharray="8 4"
          strokeLinecap="round"
          markerEnd="url(#ah-03)"
        />

        {/* telemetry labels */}
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="6" fill="currentColor" fillOpacity="0.55" letterSpacing="0.15em">
          <text x="14" y="40">V&#x1D62;&#x2099;</text>
          <text x="156" y="84">V&#x2092;&#x1D64;&#x209C;</text>
        </g>
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="5.5" fill="currentColor" fillOpacity="0.4" letterSpacing="0.12em">
          <text x="118" y="34">&#x0394;&#x03B8; ≈ 110°</text>
        </g>
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
          <pattern id="dot-grid-04" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill="currentColor" fillOpacity="0.18" />
          </pattern>
          <marker id="ah-04" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={ACCENT} />
          </marker>
          <radialGradient id="halo-04" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.4" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="200" height="120" fill="url(#dot-grid-04)" />

        {/* baseline */}
        <line x1="14" y1="108" x2="186" y2="108" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="2 3" />

        {/* axis halo */}
        <circle cx="100" cy="60" r="44" fill="url(#halo-04)" />

        {/* outer reference rings */}
        <g fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.8" strokeDasharray="2 3">
          <circle cx="100" cy="60" r="40" />
          <circle cx="100" cy="60" r="28" />
        </g>

        {/* axis crosshair */}
        <g stroke={ACCENT} strokeWidth="1.4" strokeLinecap="round">
          <line x1="92" y1="60" x2="108" y2="60" />
          <line x1="100" y1="52" x2="100" y2="68" />
        </g>
        <circle cx="100" cy="60" r="2.5" fill={ACCENT} />

        {/* radial centripetal indicators */}
        <g stroke={ACCENT} strokeWidth="1" strokeLinecap="round" strokeOpacity="0.4">
          <line x1="100" y1="32" x2="100" y2="38" />
          <line x1="124" y1="44" x2="120" y2="48" />
          <line x1="128" y1="60" x2="122" y2="60" />
          <line x1="124" y1="76" x2="120" y2="72" />
          <line x1="100" y1="88" x2="100" y2="82" />
          <line x1="76" y1="76" x2="80" y2="72" />
          <line x1="72" y1="60" x2="78" y2="60" />
          <line x1="76" y1="44" x2="80" y2="48" />
        </g>

        {/* rotation arc with arrowhead */}
        <path
          d="M 132 36 A 36 36 0 1 1 64 60"
          fill="none"
          stroke={ACCENT}
          strokeWidth="2.6"
          strokeDasharray="6 4"
          strokeLinecap="round"
          markerEnd="url(#ah-04)"
        />

        {/* footprint trace — rotating foot angles around the arc */}
        <g fill={ACCENT}>
          <ellipse cx="132" cy="36" rx="2.5" ry="3.8" transform="rotate(40, 132, 36)" opacity="0.95" />
          <ellipse cx="138" cy="60" rx="2.5" ry="3.8" transform="rotate(90, 138, 60)" opacity="0.7" />
          <ellipse cx="124" cy="84" rx="2.5" ry="3.8" transform="rotate(140, 124, 84)" opacity="0.5" />
          <ellipse cx="92" cy="92" rx="2.5" ry="3.8" transform="rotate(190, 92, 92)" opacity="0.32" />
        </g>

        {/* telemetry label */}
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="6" fill="currentColor" fillOpacity="0.55" letterSpacing="0.15em">
          <text x="46" y="28">&#x03C9; · 360°</text>
        </g>
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="5.5" fill="currentColor" fillOpacity="0.4" letterSpacing="0.12em">
          <text x="78" y="118">PIVOT · AXIS</text>
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
