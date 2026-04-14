import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FadeIn } from "@/components/shared/FadeIn"

const SPEC = [
  { value: "02", unit: "hrs", label: "Session" },
  { value: "8–12", unit: "max", label: "Athletes" },
  { value: "12–18", unit: "yrs", label: "Ages" },
]

/**
 * Tactical Chalkboard hero — the field itself is the layout.
 * A pitch with chalk markings (primary-foreground) and four dashed action
 * routes on a solid brand-primary surface.
 */
export function ClinicHero() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      {/* Bottom vignette — pure black alpha (neutral darken, no hue) */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 120%, rgba(0,0,0,0.5), transparent 55%)",
        }}
      />

      {/* Chalk markings — goal box, halfway line, routes */}
      <svg
        aria-hidden
        viewBox="0 0 1400 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full opacity-80"
      >
        <defs>
          <filter id="chalk">
            <feTurbulence baseFrequency="0.9" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.8" />
          </filter>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.85)" />
          </marker>
          <marker
            id="arrowhead-accent"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* Outer touchline */}
        <rect
          x="60"
          y="60"
          width="1280"
          height="780"
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="2"
          filter="url(#chalk)"
        />
        {/* Halfway line */}
        <line
          x1="700"
          y1="60"
          x2="700"
          y2="840"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.5"
          filter="url(#chalk)"
        />
        {/* Center circle */}
        <circle
          cx="700"
          cy="450"
          r="100"
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.5"
          filter="url(#chalk)"
        />
        <circle cx="700" cy="450" r="3" fill="rgba(255,255,255,0.45)" />

        {/* Route 1 — Acceleration (hard linear burst) */}
        <path
          d="M 220 700 L 420 500"
          fill="none"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth="3"
          strokeDasharray="12 8"
          strokeLinecap="round"
          markerEnd="url(#arrowhead)"
          filter="url(#chalk)"
        />
        <text
          x="160"
          y="740"
          fill="var(--accent)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="3"
        >
          ACCEL
        </text>
        {/* X marker at start */}
        <g stroke="rgba(255,255,255,0.6)" strokeWidth="2" filter="url(#chalk)">
          <line x1="210" y1="690" x2="230" y2="710" />
          <line x1="230" y1="690" x2="210" y2="710" />
        </g>

        {/* Route 2 — Deceleration */}
        <path
          d="M 420 500 L 560 360"
          fill="none"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth="3"
          strokeDasharray="6 4"
          strokeLinecap="round"
          filter="url(#chalk)"
        />
        <g stroke="var(--accent)" strokeWidth="2.5">
          <line x1="480" y1="420" x2="510" y2="415" />
          <line x1="500" y1="440" x2="530" y2="435" />
          <line x1="520" y1="460" x2="550" y2="455" />
        </g>
        <text
          x="430"
          y="330"
          fill="var(--accent)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="3"
        >
          DECEL
        </text>

        {/* Route 3 — Cut */}
        <path
          d="M 560 360 C 640 340 720 400 820 280"
          fill="none"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth="3"
          strokeDasharray="12 8"
          strokeLinecap="round"
          markerEnd="url(#arrowhead-accent)"
          filter="url(#chalk)"
        />
        <circle cx="700" cy="340" r="6" fill="var(--accent)" />
        <text
          x="720"
          y="250"
          fill="rgba(255,255,255,0.9)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="3"
        >
          CUT
        </text>

        {/* Route 4 — Rotation */}
        <path
          d="M 1000 500 A 80 80 0 1 0 1160 500"
          fill="none"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth="3"
          strokeDasharray="8 6"
          strokeLinecap="round"
          markerEnd="url(#arrowhead)"
          filter="url(#chalk)"
        />
        <text
          x="1000"
          y="620"
          fill="var(--accent)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="3"
        >
          ROTATE
        </text>

        {/* O markers */}
        <g fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2">
          <circle cx="900" cy="700" r="14" />
          <circle cx="1100" cy="750" r="14" />
          <circle cx="350" cy="250" r="14" />
        </g>
      </svg>

      {/* Foreground content */}
      <div className="relative mx-auto max-w-7xl px-4 pt-28 pb-20 md:px-6 md:pt-36 md:pb-28">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-3 rounded-full bg-primary-foreground/10 border border-primary-foreground/20 backdrop-blur-sm px-4 py-1.5 text-[11px] uppercase tracking-[0.25em]">
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_currentColor] text-accent" />
              Agility Clinic · 12–18 yrs
            </div>

            <h1 className="mt-7 font-heading text-[42px] leading-[0.95] tracking-tight font-semibold sm:text-7xl md:text-8xl lg:text-[108px]">
              Move sharp.
              <br />
              <span className="text-accent italic font-normal">Think sharper.</span>
            </h1>

            <p className="mt-7 max-w-xl text-base leading-7 text-primary-foreground/80 md:text-lg md:leading-8">
              A 2-hour coaching session for athletes who want to move better, react faster, and look more in
              control when the game gets chaotic.
            </p>

            {/* Four-action pills, written as play-calls */}
            <div className="mt-9 flex flex-wrap gap-2 max-w-xl">
              {[
                { n: "1", label: "Accelerate" },
                { n: "2", label: "Decelerate" },
                { n: "3", label: "Cut" },
                { n: "4", label: "Rotate" },
              ].map((a) => (
                <span
                  key={a.label}
                  className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/25 bg-primary-foreground/5 backdrop-blur-sm px-3 py-1.5 text-sm"
                >
                  <span className="font-mono text-[10px] tabular-nums text-accent">{a.n}</span>
                  {a.label}
                </span>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="rounded-full bg-accent text-primary hover:bg-accent/90 shadow-lg"
              >
                <Link href="#register-interest">
                  Register your interest
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-primary-foreground/30 bg-primary-foreground/5 backdrop-blur-sm text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Link href="#what-gets-coached">See the plays</Link>
              </Button>
            </div>
          </div>
        </FadeIn>
      </div>

      {/* Scoreboard / spec strip — same bg-primary, separated by top border */}
      <div className="relative border-t border-primary-foreground/20 bg-primary">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: "rgba(0,0,0,0.25)" }}
        />
        <div className="relative mx-auto max-w-7xl px-4 md:px-6 py-5 grid grid-cols-3 divide-x divide-primary-foreground/15">
          {SPEC.map((s) => (
            <div key={s.label} className="flex items-baseline gap-3 px-4 first:pl-0">
              <div className="flex items-baseline gap-1 font-heading">
                <span className="text-3xl md:text-4xl font-semibold tabular-nums">{s.value}</span>
                <span className="text-[11px] uppercase tracking-[0.25em] text-primary-foreground/55">
                  {s.unit}
                </span>
              </div>
              <span className="ml-auto text-[10px] uppercase tracking-[0.3em] text-primary-foreground/55">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
