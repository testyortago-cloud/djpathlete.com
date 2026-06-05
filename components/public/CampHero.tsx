import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FadeIn } from "@/components/shared/FadeIn"

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

      <div className="relative mx-auto max-w-7xl px-4 md:px-6 pt-16 md:pt-24 pb-8 md:pb-12">
        <FadeIn>
          {/* Headline — keyword-rich H1 + branded H2 */}
          <h1
            className="mt-10 font-heading font-semibold tracking-tight leading-[1.02] text-primary"
            style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}
          >
            High-Performance Soccer Camps for Athletes
          </h1>
          <h2
            className="mt-4 font-heading font-semibold tracking-tight leading-[0.92] text-primary"
            style={{ fontSize: "clamp(2rem, 7vw, 6rem)" }}
          >
            TRAIN AT THE LEVEL
            <br />
            THE GAME <span className="italic font-normal text-accent">DEMANDS.</span>
          </h2>

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

    </section>
  )
}
