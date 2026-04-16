import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FadeIn } from "@/components/shared/FadeIn"

const SPEC = [
  { value: "02", unit: "hrs", label: "Session" },
  { value: "8–12", unit: "max", label: "Athletes" },
  { value: "10–18", unit: "yrs", label: "Ages" },
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

      {/* Agility session plan — chalk-drawn kit on a pitch */}
      <svg
        aria-hidden
        viewBox="0 0 1400 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full opacity-85"
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

        {/* Subtle pitch corner markings */}
        <g stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" fill="none" filter="url(#chalk)">
          <path d="M 60 120 A 60 60 0 0 1 120 60" />
          <path d="M 1280 60 A 60 60 0 0 1 1340 120" />
          <path d="M 60 780 A 60 60 0 0 0 120 840" />
          <path d="M 1280 840 A 60 60 0 0 0 1340 780" />
          <line x1="60" y1="450" x2="140" y2="450" />
          <line x1="1260" y1="450" x2="1340" y2="450" />
        </g>

        {/* ======================= AGILITY LADDER (bottom-left) ======================= */}
        <g transform="translate(140 600) rotate(-14)" filter="url(#chalk)">
          <g stroke="rgba(255,255,255,0.55)" strokeWidth="3" fill="none">
            {/* rails */}
            <line x1="0" y1="0" x2="400" y2="0" />
            <line x1="0" y1="70" x2="400" y2="70" />
            {/* rungs */}
            {Array.from({ length: 9 }).map((_, i) => (
              <line key={i} x1={i * 50} y1="0" x2={i * 50} y2="70" />
            ))}
          </g>
        </g>
        <text
          x="140"
          y="760"
          fill="rgba(255,255,255,0.75)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="22"
          letterSpacing="3"
        >
          LADDER · QUICK FEET
        </text>

        {/* ======================= SLALOM CONES (middle) ======================= */}
        {[
          { x: 490, y: 600 },
          { x: 640, y: 540 },
          { x: 790, y: 480 },
          { x: 940, y: 420 },
        ].map((c, i) => (
          <g key={i} filter="url(#chalk)">
            {/* cone body */}
            <polygon
              points={`${c.x},${c.y - 50} ${c.x - 24},${c.y + 6} ${c.x + 24},${c.y + 6}`}
              fill="var(--accent)"
              fillOpacity="0.55"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="2.5"
            />
            {/* cone stripe */}
            <polygon
              points={`${c.x - 14},${c.y - 18} ${c.x + 14},${c.y - 18} ${c.x + 18},${c.y - 6} ${c.x - 18},${c.y - 6}`}
              fill="rgba(255,255,255,0.18)"
            />
            {/* base ellipse */}
            <ellipse cx={c.x} cy={c.y + 10} rx="26" ry="6" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
          </g>
        ))}
        <text
          x="640"
          y="360"
          fill="var(--accent)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="3"
        >
          SLALOM · CUT
        </text>

        {/* ======================= MINI HURDLES (right) ======================= */}
        <g stroke="rgba(255,255,255,0.65)" strokeWidth="3" fill="none" filter="url(#chalk)">
          {/* hurdle 1 */}
          <rect x="1100" y="560" width="90" height="40" />
          <line x1="1100" y1="580" x2="1190" y2="580" />
          {/* hurdle 2 */}
          <rect x="1210" y="560" width="90" height="40" />
          <line x1="1210" y1="580" x2="1300" y2="580" />
        </g>
        <text
          x="1100"
          y="660"
          fill="rgba(255,255,255,0.8)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="22"
          letterSpacing="3"
        >
          HURDLES · DECEL
        </text>

        {/* ======================= ROUTE — ladder → slalom → cut → hurdles ======================= */}
        {/* Start burst out of ladder */}
        <path
          d="M 470 720 C 480 680 490 660 500 640"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3.5"
          strokeDasharray="14 8"
          strokeLinecap="round"
          filter="url(#chalk)"
        />
        {/* Zig-zag through cones */}
        <path
          d="M 500 640 Q 540 580 600 580 Q 660 580 680 520 Q 720 470 790 470 Q 860 470 900 410 Q 950 370 1010 380"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="3"
          strokeDasharray="12 8"
          strokeLinecap="round"
          filter="url(#chalk)"
        />
        {/* Hard cut + run to hurdles */}
        <path
          d="M 1010 380 C 1060 400 1090 480 1140 540"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3.5"
          strokeDasharray="14 8"
          strokeLinecap="round"
          markerEnd="url(#arrowhead-accent)"
          filter="url(#chalk)"
        />
        {/* Plant marker at cut */}
        <circle cx="1010" cy="380" r="6" fill="var(--accent)" />
        <circle cx="1010" cy="380" r="14" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 4" />

        {/* Brake hashes before a cone */}
        <g stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" filter="url(#chalk)">
          <line x1="570" y1="560" x2="600" y2="555" />
          <line x1="585" y1="580" x2="615" y2="575" />
          <line x1="600" y1="600" x2="630" y2="595" />
        </g>

        {/* ======================= ATHLETE (stick figure) at ladder start ======================= */}
        <g fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3" strokeLinecap="round" filter="url(#chalk)">
          {/* head */}
          <circle cx="380" cy="720" r="11" fill="rgba(255,255,255,0.9)" stroke="none" />
          {/* torso */}
          <line x1="380" y1="732" x2="378" y2="778" />
          {/* leading arm (forward) */}
          <line x1="379" y1="745" x2="405" y2="738" />
          {/* trailing arm */}
          <line x1="379" y1="745" x2="360" y2="770" />
          {/* lead leg (drive) */}
          <line x1="378" y1="778" x2="408" y2="800" />
          {/* back leg (push) */}
          <line x1="378" y1="778" x2="355" y2="810" />
          {/* forward lean indicator */}
          <line x1="395" y1="715" x2="420" y2="705" strokeDasharray="4 4" strokeOpacity="0.6" />
        </g>

        {/* ======================= ROTATION ARC (top-right) ======================= */}
        <g filter="url(#chalk)">
          <path
            d="M 1180 220 A 70 70 0 1 0 1320 220"
            fill="none"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="3"
            strokeDasharray="8 6"
            strokeLinecap="round"
            markerEnd="url(#arrowhead)"
          />
          {/* pivot foot */}
          <circle cx="1250" cy="220" r="5" fill="var(--accent)" />
          <ellipse cx="1250" cy="228" rx="10" ry="3" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
        </g>
        <text
          x="1180"
          y="170"
          fill="var(--accent)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="24"
          letterSpacing="3"
        >
          ROTATE
        </text>

        {/* ======================= ACCEL label near athlete/ladder exit ======================= */}
        <text
          x="300"
          y="680"
          fill="var(--accent)"
          fontFamily="var(--font-heading), sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="3"
        >
          ACCEL
        </text>
      </svg>

      {/* Foreground content */}
      <div className="relative mx-auto max-w-7xl px-4 pt-28 pb-20 md:px-6 md:pt-36 md:pb-28">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-3 rounded-full bg-primary-foreground/10 border border-primary-foreground/20 backdrop-blur-sm px-4 py-1.5 text-[11px] uppercase tracking-[0.25em]">
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_currentColor] text-accent" />
              Agility Clinic · Ages 10–18 · 8–12 Athletes
            </div>

            <h1 className="mt-7 font-heading text-[40px] leading-[0.95] tracking-tight font-semibold sm:text-6xl md:text-7xl lg:text-[92px]">
              Move faster.
              <br />
              React sooner.
              <br />
              <span className="text-accent italic font-normal">Do it when it actually matters.</span>
            </h1>

            <p className="mt-7 max-w-xl text-base leading-7 text-primary-foreground/80 md:text-lg md:leading-8">
              A focused 2-hour session on the movements that change outcomes in real sport — starting,
              stopping, redirecting, and recovering. Smaller groups, proper coaching, and work that transfers
              to the pitch, court, or field.
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
