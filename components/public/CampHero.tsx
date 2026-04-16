import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FadeIn } from "@/components/shared/FadeIn"

const WEEKS = [
  { n: "D 01", phase: "Assess" },
  { n: "D 03", phase: "Build" },
  { n: "D 05", phase: "Apply" },
  { n: "D 07", phase: "Develop" },
  { n: "D 09", phase: "Peak", peak: true },
  { n: "D 10", phase: "Test" },
]

/**
 * Training Block Poster hero — editorial athletics-meet-poster.
 * Uses brand palette only: bg-surface paper, text-primary ink, text-accent.
 */
export function CampHero() {
  return (
    <section className="relative overflow-hidden bg-surface text-primary">
      {/* Corner accent glow */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 100% 0%, oklch(0.7 0.08 60 / 0.14), transparent 55%)",
        }}
      />

      {/* Top masthead bar */}
      <div className="relative border-b-2 border-primary">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 font-heading text-xs uppercase tracking-[0.35em] text-primary">
            <span className="inline-block h-4 w-1 bg-accent" />
            DJP / Performance Gazette
          </div>
          <div className="hidden sm:flex items-center gap-6 text-[11px] uppercase tracking-[0.3em] text-primary/60">
            <span>Vol. IV</span>
            <span>Issue · Off + Pre</span>
            <span>Soccer · College + Pro</span>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-4 md:px-6 pt-16 md:pt-24 pb-8 md:pb-12">
        <FadeIn>
          {/* Edition tag + stamp */}
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="inline-block border-2 border-primary px-3 py-1 font-heading text-[11px] uppercase tracking-[0.35em] text-primary">
                Soccer Performance Camp · Off + Pre-Season
              </div>
            </div>
            {/* Rubber stamp */}
            <div className="inline-flex items-center gap-2 rotate-[-6deg] border-2 border-accent rounded-sm px-4 py-2 font-heading font-bold uppercase tracking-[0.2em] text-sm md:text-base text-accent bg-accent/[0.06]">
              2-Week Intensive
              <span className="w-px h-5 bg-accent/50" />
              <span className="tabular-nums">2026</span>
            </div>
          </div>

          {/* Headline — huge poster typography */}
          <h1
            className="mt-10 font-heading font-semibold tracking-tight leading-[0.88] text-primary"
            style={{ fontSize: "clamp(2.5rem, 9vw, 8.5rem)" }}
          >
            TRAIN AT THE LEVEL
            <br />
            THE GAME <span className="italic font-normal text-accent">DEMANDS.</span>
          </h1>

          {/* Two-column lede */}
          <div className="mt-10 grid gap-10 md:grid-cols-[1.3fr_1fr] md:gap-16 max-w-5xl">
            <p className="text-base md:text-lg leading-7 md:leading-8 text-muted-foreground">
              Built for soccer players who are serious about what comes next. Whether you're competing at
              college or professional level — or pushing hard to get there — this camp is built around the
              physical qualities that separate players when it matters. Every session is designed to
              transfer directly to soccer-specific performance, not just general fitness.
            </p>
            <div className="border-l-2 border-primary/30 pl-6">
              <p className="font-heading text-lg md:text-xl font-semibold leading-snug text-primary">
                "The athlete you become in the off-season is the athlete you compete with in-season."
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-accent">— Camp ethos</p>
            </div>
          </div>

          {/* Pills */}
          <div className="mt-8 flex flex-wrap gap-2">
            {["Soccer-Specific Performance", "2-Week Intensive Camp", "2 Hours Per Session"].map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-2 border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-primary font-heading"
              >
                <span className="size-1.5 rounded-full bg-accent" />
                {p}
              </span>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Button
              asChild
              size="lg"
              className="rounded-none bg-primary text-primary-foreground hover:bg-primary/90 font-heading font-semibold uppercase tracking-[0.15em] shadow-none"
            >
              <Link href="#register-interest">
                Register interest
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-none bg-transparent border-primary text-primary hover:bg-primary/5 font-heading uppercase tracking-[0.15em]"
            >
              <Link href="#what-gets-developed">Read the programme</Link>
            </Button>
          </div>
        </FadeIn>
      </div>

      {/* Week strip — the signature piece */}
      <div className="relative border-y-2 border-primary bg-background">
        <div className="mx-auto max-w-7xl grid grid-cols-3 md:grid-cols-6 divide-x-2 divide-primary">
          {WEEKS.map((w, i) => (
            <div
              key={w.n}
              className={`relative px-4 py-5 md:py-7 ${w.peak ? "bg-accent/12" : ""}`}
            >
              <div className="font-heading text-lg md:text-2xl font-bold tabular-nums tracking-tight text-primary">
                {w.n}
              </div>
              <div className="mt-1 text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-accent">
                {w.phase}
              </div>
              <div className="mt-4 h-1 bg-primary/15 overflow-hidden">
                <div
                  className={w.peak ? "h-full bg-accent" : "h-full bg-primary"}
                  style={{
                    width: w.peak ? "100%" : i < 2 ? "60%" : i < 4 ? "80%" : "40%",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
