import type { Metadata } from "next"
import {
  ArrowRight,
  Trophy,
  Users,
  ShieldCheck,
  Briefcase,
  ClipboardCheck,
  Map,
  Layers,
  RefreshCcw,
} from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"

export const metadata: Metadata = {
  title: "In-Person Coaching",
  description:
    "Advanced assessment-led performance coaching by Darren J Paul. Individualized programming for competitive athletes, elite youth, and return-to-performance athletes.",
  openGraph: {
    title: "In-Person Coaching | DJP Athlete",
    description:
      "Advanced assessment-led performance coaching by Darren J Paul. Individualized programming for competitive athletes, elite youth, and return-to-performance athletes.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "In-Person Coaching | DJP Athlete",
    description:
      "Advanced assessment-led performance coaching by Darren J Paul. Individualized programming for competitive athletes, elite youth, and return-to-performance athletes.",
  },
}

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: {
    "@type": "Person",
    name: "Darren J Paul",
    worksFor: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
    },
  },
  serviceType: "In-Person Athletic Performance Coaching",
  description:
    "Advanced assessment-led performance coaching. Individualized programming for competitive athletes, elite youth, and return-to-performance athletes.",
  url: "https://djpathlete.com/in-person",
}

const athleteTypes = [
  {
    icon: Trophy,
    title: "Competitive Athletes",
    description:
      "Athletes competing at high school, collegiate, semi-professional, or professional levels who require intelligent performance development beyond generic programs.",
  },
  {
    icon: Users,
    title: "Elite Youth Athletes",
    description:
      "Developing athletes who need long-term athletic development, not early burnout or shortcut training.",
  },
  {
    icon: ShieldCheck,
    title: "Return-to-Performance Athletes",
    description:
      "Post-injury athletes who are medically cleared but not performance-ready. This is the bridge from rehab to dominance.",
  },
  {
    icon: Briefcase,
    title: "High-Performing Professionals",
    description:
      "Individuals who train with the same intent they work. Precision, efficiency, and resilience matter.",
  },
]

const processSteps = [
  {
    step: "01",
    icon: ClipboardCheck,
    title: "Comprehensive Performance Assessment",
    description:
      "A detailed evaluation of movement quality, physical capacity, injury history, and sport demands. Nothing is assumed. Everything is measured.",
  },
  {
    step: "02",
    icon: Map,
    title: "Strategic Performance Blueprint",
    description:
      "A structured plan built from your assessment data — not a template. Your blueprint defines training priorities, timelines, and measurable targets.",
  },
  {
    step: "03",
    icon: Layers,
    title: "Structured Development",
    description:
      "Systematic training designed to build capacity progressively. Every session has purpose. Every phase builds on the last.",
  },
  {
    step: "04",
    icon: RefreshCcw,
    title: "Continuous Evaluation and Optimization",
    description:
      "Regular reassessment and data review ensure the program evolves with you. Adjustments are made based on evidence, not guesswork.",
  },
]

export default function InPersonPage() {
  return (
    <>
      <JsonLd data={serviceSchema} />

      {/* Hero — Video Background */}
      <section className="relative min-h-[70vh] flex items-center justify-center bg-primary overflow-hidden">
        {/* YouTube video background */}
        <div className="absolute inset-0 pointer-events-none">
          <iframe
            src="https://www.youtube.com/embed/h5YxEsY2vDI?autoplay=1&mute=1&loop=1&playlist=h5YxEsY2vDI&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1&disablekb=1"
            title="DJP Athlete Training"
            allow="autoplay; encrypted-media"
            className="absolute top-[60%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300%] h-[300%] min-w-full min-h-full object-cover"
            style={{ border: 0 }}
          />
        </div>
        {/* Dark overlay for text readability */}
        <div className="absolute inset-0 bg-primary/70" />

        <div className="relative z-10 max-w-5xl mx-auto text-center px-4 sm:px-8 pt-32 pb-16 lg:pt-40 lg:pb-24">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px w-8 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">
              In-Person Coaching
            </p>
            <div className="h-px w-8 bg-accent" />
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-white tracking-tight mb-6">
            High Performance Development.
            <br className="hidden sm:block" /> Delivered Precisely.
          </h1>
          <p className="text-lg text-white/80 max-w-2xl mx-auto leading-relaxed mb-8">
            Assessment-led, individually designed coaching for athletes who
            demand more than effort. This is structured performance development
            — built on science, guided by experience, and measured by results.
          </p>
          <Link
            href="/contact"
            className="group inline-flex items-center gap-2 bg-accent text-primary px-8 py-4 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all hover:shadow-md"
          >
            Apply Now
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* Who This Is For */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">
                Who This Is For
              </p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Built for Athletes Who Take Performance Seriously
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {athleteTypes.map((type) => {
              const Icon = type.icon
              return (
                <div
                  key={type.title}
                  className="group relative overflow-hidden bg-white rounded-2xl border border-border p-6 hover:shadow-md transition-shadow"
                >
                  <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                    <Icon className="size-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-primary mb-2">
                    {type.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {type.description}
                  </p>
                </div>
              )
            })}
          </div>

          <div className="mt-10 text-center">
            <p className="text-sm text-muted-foreground italic max-w-2xl mx-auto leading-relaxed">
              This is not entry-level training. This is not mass coaching.
              Capacity is limited to protect quality.
            </p>
          </div>
        </div>
      </section>

      {/* Process Steps */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">
                The Process
              </p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              A Clear, Structured Path to Performance
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Every engagement follows a proven process designed to eliminate
              guesswork and maximise outcomes.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {processSteps.map((step) => {
              const Icon = step.icon
              return (
                <div key={step.step} className="relative">
                  <div className="text-4xl font-heading font-bold text-accent/30 mb-3">
                    {step.step}
                  </div>
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 mb-3">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <h3 className="text-base font-semibold text-primary mb-2">
                    {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* The Difference */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">
                The Difference
              </p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Most Training Chases Fatigue.
              <br className="hidden sm:block" /> We Build Capacity.
            </h2>
          </div>

          <div className="space-y-6">
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                "Precision beats volume.",
                "Capacity beats fatigue.",
                "Systems beat workouts.",
              ].map((statement) => (
                <div
                  key={statement}
                  className="bg-white rounded-2xl border border-border p-5 text-center"
                >
                  <p className="text-base font-semibold text-primary">
                    {statement}
                  </p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-border p-6 sm:p-8">
              <p className="text-lg text-muted-foreground leading-relaxed">
                With over 20 years of experience, a PhD in athletic performance,
                and a track record trusted by the world&apos;s best, this is not
                theoretical coaching. Every decision is informed by evidence,
                refined by experience, and tested at the highest levels of sport.
                The difference is not just what we do — it is the depth of
                understanding behind every choice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Apply CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px w-8 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">
              Get Started
            </p>
            <div className="h-px w-8 bg-accent" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            Ready to Start?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            In-person coaching is limited by design. If you are serious about
            performance development, apply to begin the process.
          </p>
          <Link
            href="/contact"
            className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
          >
            Apply Now
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </>
  )
}
