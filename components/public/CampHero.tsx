import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FadeIn } from "@/components/shared/FadeIn"

const STATS = [
  { label: "Focus", value: "Overall Performance" },
  { label: "Block", value: "Off / Pre-Season" },
  { label: "Added Value", value: "Insight + Reporting", accent: true },
]

export function CampHero() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at top left, oklch(0.70 0.08 60 / 0.22), transparent 35%), radial-gradient(circle at bottom right, oklch(1 0 0 / 0.08), transparent 30%)",
        }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-20 md:px-6 md:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <FadeIn>
          <div className="inline-flex items-center rounded-full border border-primary-foreground/20 bg-primary-foreground/5 px-4 py-2 text-sm text-primary-foreground/80">
            Performance Camps · Off-Season + Pre-Season · Ages 12–18
          </div>
          <h1 className="mt-5 max-w-4xl font-heading text-5xl font-semibold tracking-tight md:text-7xl">
            Build more before the season takes over.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-primary-foreground/80 md:text-xl">
            Camps built to develop the physical base behind performance: speed, power, movement quality, conditioning,
            and robustness. In selected settings, athletes also get testing, insight, and reporting.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
              <Link href="#register-interest">
                Register Your Interest
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Link href="#what-gets-developed">See The Details</Link>
            </Button>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className={`rounded-2xl border p-4 ${
                  stat.accent ? "border-accent/40 bg-accent/15" : "border-primary-foreground/15 bg-primary-foreground/5"
                }`}
              >
                <div className="text-sm text-primary-foreground/60">{stat.label}</div>
                <div className="mt-1 text-lg font-semibold">{stat.value}</div>
              </div>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="rounded-3xl border-primary-foreground/15 bg-primary-foreground/[0.06] shadow-2xl backdrop-blur">
            <CardContent className="p-6 md:p-8">
              <div className="text-xs uppercase tracking-[0.3em] text-primary-foreground/50">The difference</div>
              <div className="mt-4 font-heading text-2xl font-medium leading-9 md:text-3xl">
                More than sessions that just leave athletes tired.
              </div>
              <div className="mt-5 space-y-4 text-sm leading-7 text-primary-foreground/75 md:text-base">
                <p>
                  The aim is to build real physical qualities with more structure, more purpose, and better feedback
                  around progress.
                </p>
                <p>
                  In some environments that also means using selected technology to give athletes clearer performance
                  insight.
                </p>
              </div>
              <div className="mt-7 rounded-2xl border border-accent/40 bg-accent/15 p-4 text-sm text-primary-foreground">
                Prepare properly now so the season does not expose what was missed.
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </section>
  )
}
