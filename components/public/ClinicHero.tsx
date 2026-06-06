import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FadeIn } from "@/components/shared/FadeIn"
import { LocalVideoBackground } from "@/components/public/LocalVideoBackground"

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
      {/* Local MP4 video background — mirrors the in-person hero pattern */}
      <LocalVideoBackground
        src="/videos/clinics-hero.mp4"
        poster="/videos/clinics-hero-poster.jpg"
      />
      {/* Dark overlay for text readability over moving footage */}
      <div className="absolute inset-0 bg-primary/70" />
      {/* Bottom vignette — pure black alpha (neutral darken, no hue) */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 120%, rgba(0,0,0,0.5), transparent 55%)",
        }}
      />

      {/* Foreground content */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 pt-28 pb-20 md:px-6 md:pt-36 md:pb-28">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-3 rounded-full bg-primary-foreground/10 border border-primary-foreground/20 backdrop-blur-sm px-4 py-1.5 text-[11px] uppercase tracking-[0.25em]">
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_currentColor] text-accent" />
              Agility Clinic · Ages 10–18 · 8–12 Athletes
            </div>

            <h1 className="mt-7 font-heading text-[36px] leading-[1.02] tracking-tight font-semibold sm:text-5xl md:text-6xl">
              Speed and Agility Training Clinics for Athletes
            </h1>
            <p className="mt-5 font-heading text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight leading-[1.05]">
              Faster. Sooner.{" "}
              <span className="text-accent italic font-normal">When it matters.</span>
            </p>

            <p className="mt-7 max-w-xl text-base leading-7 text-primary-foreground/80 md:text-lg md:leading-8">
              A focused session on the movements that change outcomes in real sport — starting, stopping,
              redirecting, and recovering. Smaller groups, proper coaching, and work that transfers to the
              pitch, court, or field.
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
