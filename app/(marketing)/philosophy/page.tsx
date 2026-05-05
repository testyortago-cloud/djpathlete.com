import type { Metadata } from "next"
import { Search, ClipboardList, Activity, Video, TrendingUp, ArrowRight, Quote } from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"

export const metadata: Metadata = {
  title: "Coaching Philosophy",
  description:
    "The Grey Zone — Darren J Paul's Five Pillar Framework for athletic performance. Most training lives in black and white. Performance happens in the grey.",
  alternates: { canonical: "/philosophy" },
  openGraph: {
    title: "Coaching Philosophy | DJP Athlete",
    description:
      "The Grey Zone — a Five Pillar Framework built on assessment, individualized programming, load monitoring, technical coaching, and long-term athlete development.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Coaching Philosophy | DJP Athlete",
    description:
      "The Grey Zone — a Five Pillar Framework built on assessment, individualized programming, load monitoring, technical coaching, and long-term athlete development.",
  },
}

const philosophySchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Coaching Philosophy — The Grey Zone",
  description:
    "The Grey Zone Five Pillar Framework by Darren J Paul. A systems-based coaching philosophy for athletic performance.",
  url: "https://www.darrenjpaul.com/philosophy",
  author: {
    "@type": "Person",
    name: "Darren J Paul",
    jobTitle: "Head Coach & Founder",
    worksFor: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://www.darrenjpaul.com",
    },
  },
}

const pillars = [
  {
    number: "01",
    icon: Search,
    title: "Assessment & Diagnostics",
    description:
      "Understanding the athlete before building the plan. Movement quality, force characteristics, load tolerance, sport demands, and injury history.",
  },
  {
    number: "02",
    icon: ClipboardList,
    title: "Individualized Programming",
    description:
      "No templates. Every program is built from assessment data, aligned with sport demands, competition schedules, and the athlete's developmental stage.",
  },
  {
    number: "03",
    icon: Activity,
    title: "Load & Readiness Monitoring",
    description:
      "Continuous tracking of training load, wellness markers, and performance indicators. Decisions are data-informed, not assumption-based.",
  },
  {
    number: "04",
    icon: Video,
    title: "Technical Coaching & Feedback",
    description:
      "Movement is coached, not just programmed. Video analysis, cueing, and real-time feedback drive quality.",
  },
  {
    number: "05",
    icon: TrendingUp,
    title: "Long-Term Athlete Development",
    description:
      "Building robust, adaptable athletes over years — not chasing short-term results at the expense of long-term capacity.",
  },
]

export default function PhilosophyPage() {
  return (
    <>
      <JsonLd data={philosophySchema} />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Coaching Philosophy</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              The Grey Zone
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Most training lives in black and white. Performance happens in the grey.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* The Problem */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">The Problem</p>
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-6">
              Training in Extremes Does Not Work.
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="max-w-3xl space-y-5">
              <p className="text-lg text-muted-foreground leading-relaxed">
                Most training systems operate in extremes — all-out effort or complete rest, rigid protocols or no
                structure at all. They offer two speeds: maximum intensity or nothing.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed">
                But athletes exist in a complex space between these extremes. Context, readiness, and adaptation
                interact in ways that a spreadsheet cannot predict. Fatigue is not always visible. Progress is not
                always linear. Competition demands are never generic.
              </p>
              <p className="text-lg text-foreground font-medium leading-relaxed">
                Generic programming ignores this complexity. And athletes pay the price — in injuries, plateaus, and
                unrealized potential.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* The Core Idea */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeIn direction="left">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-12 bg-accent" />
                  <p className="text-sm font-medium text-accent uppercase tracking-widest">The Framework</p>
                </div>
                <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-6">
                  The Space Between Protocol and Performance
                </h2>
                <div className="space-y-5">
                  <p className="text-lg text-muted-foreground leading-relaxed">
                    The Grey Zone is the space between textbook protocols and real-world performance demands. It is
                    where adaptation actually happens — not in the controlled environment of theory, but in the
                    unpredictable reality of sport.
                  </p>
                  <p className="text-lg text-muted-foreground leading-relaxed">
                    Navigating it requires a coach who can read context, adjust in real time, and make informed
                    decisions based on what the athlete needs today — not what the plan said last week.
                  </p>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.15}>
              <div className="relative p-8 sm:p-10 rounded-2xl bg-surface border border-border">
                <Quote className="size-10 text-accent/30 mb-4" />
                <blockquote className="text-xl sm:text-2xl font-heading font-semibold text-primary leading-snug mb-4">
                  I think in systems, not exercises.
                </blockquote>
                <p className="text-sm text-muted-foreground">— Darren J Paul</p>
                <div className="absolute -bottom-3 -right-3 w-24 h-24 bg-accent/20 rounded-2xl -z-10" />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Five Pillar Framework */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">The System</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                The Five Pillar Framework
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Five interconnected pillars that drive every decision, every program, and every athlete interaction.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {pillars.map((pillar, i) => {
              const Icon = pillar.icon
              return (
                <FadeIn key={pillar.number} delay={i * 0.08}>
                  <div className="group relative overflow-hidden bg-white rounded-2xl border border-border p-6 hover:shadow-md transition-shadow h-full">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                    <div className="text-3xl font-heading font-bold text-accent/30 mb-3">{pillar.number}</div>
                    <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                      <Icon className="size-6 text-primary" />
                    </div>
                    <h3 className="text-base font-semibold text-primary mb-2">{pillar.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{pillar.description}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* Differentiator / Closing */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">The Difference</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-8">
                What Sets This Approach Apart
              </h2>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="grid sm:grid-cols-3 gap-6 mb-12">
              {["Precision beats volume.", "Capacity beats fatigue.", "Systems beat workouts."].map((statement) => (
                <div key={statement} className="text-center p-6 rounded-2xl bg-surface border border-border">
                  <p className="text-lg font-heading font-semibold text-primary">{statement}</p>
                </div>
              ))}
            </div>
          </FadeIn>

          <FadeIn delay={0.2}>
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-lg text-muted-foreground leading-relaxed">
                This is not about doing more. It is about doing what matters, when it matters, for the athlete in front
                of you. The Grey Zone is where good coaching lives — and it is where athletes become their best.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Get Started</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Ready to train in the Grey Zone?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Book a free consultation and find out how a systems-based approach can change the way you train, recover,
              and perform.
            </p>
            <Link
              href="/contact"
              className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
            >
              Book Free Consultation
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </FadeIn>
        </div>
      </section>
    </>
  )
}
