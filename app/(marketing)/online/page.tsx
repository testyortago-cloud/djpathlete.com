import type { Metadata } from "next"
import {
  ArrowRight,
  AlertTriangle,
  ShieldCheck,
  Play,
  ClipboardList,
  Video,
  Activity,
  HeartPulse,
  MessageCircle,
} from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { FAQSection } from "@/components/FAQSection"
import { InquiryForm } from "@/components/public/InquiryForm"

export const metadata: Metadata = {
  title: "Online Coaching",
  description:
    "More than remote training. A complete, coach-led online performance system for serious athletes. Individualized programming, video feedback, and direct coaching access.",
  openGraph: {
    title: "Online Coaching | DJP Athlete",
    description:
      "More than remote training. A complete, coach-led online performance system for serious athletes. Individualized programming, video feedback, and direct coaching access.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Online Coaching | DJP Athlete",
    description:
      "More than remote training. A complete, coach-led online performance system for serious athletes. Individualized programming, video feedback, and direct coaching access.",
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
  serviceType: "Online Athletic Performance Coaching",
  description:
    "A complete, coach-led online performance system for serious athletes. Individualized programming, video feedback, and direct coaching access.",
  url: "https://djpathlete.com/online",
}

const failurePoints = [
  "Generic programming ignores context",
  "No detailed movement assessment",
  "No objective monitoring",
  "No adjustment for fatigue, travel, competition schedule, or injury history",
  "No meaningful coaching feedback",
]

const coreComponents = [
  {
    icon: ClipboardList,
    title: "Individualized Programming",
    description:
      "Every plan is built around the athlete's sport, history, and capacity. No templates. No recycled programs.",
  },
  {
    icon: Video,
    title: "Video Feedback and Technical Coaching",
    description:
      "Movement quality, intent, and execution are reviewed continuously. Technique is coached, not assumed.",
  },
  {
    icon: Activity,
    title: "Advanced Performance Testing",
    description: "Remote diagnostics inform readiness, speed qualities, and capacity development.",
  },
  {
    icon: HeartPulse,
    title: "Wellness and Load Monitoring",
    description: "Fatigue, recovery, and tolerance guide training decisions in real time.",
  },
  {
    icon: MessageCircle,
    title: "Direct Access to Expertise",
    description: "Athletes are supported, adjusted, and guided throughout the process.",
  },
]

const onlineFAQs = [
  {
    question: "How is this different from other online coaching?",
    answer:
      "Most online coaching delivers a spreadsheet and a check-in form. This system is diagnostic-driven. Every program is built from assessment data, adjusted through continuous monitoring, and refined with direct coaching feedback. It is the same methodology used in person — adapted for remote delivery without compromising quality.",
  },
  {
    question: "What does a typical week look like?",
    answer:
      "Your week includes structured programming tailored to your current phase, regular coaching check-ins, and video reviews of key sessions. You will receive detailed feedback on movement quality, load management adjustments based on wellness data, and direct communication with your coach as needed. Every week is planned with intention.",
  },
  {
    question: "How do I get started?",
    answer:
      "The process begins with an application. If accepted, you will complete a comprehensive remote assessment covering movement quality, training history, sport demands, and performance goals. From there, a strategic plan is built and your coaching begins. Entry is selective to ensure every athlete receives the attention they deserve.",
  },
  {
    question: "What equipment do I need?",
    answer:
      "Equipment requirements vary by sport and training goals. At minimum, access to a well-equipped gym with free weights, a squat rack, and basic conditioning tools is recommended. Specific requirements will be discussed during the assessment process and programming is adapted to your available environment.",
  },
]

export default function OnlinePage() {
  return (
    <>
      <JsonLd data={serviceSchema} />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-5xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Online Performance System</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              More than Training.
              <br className="hidden sm:block" /> A Complete Performance System.
            </h1>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              The Online Performance System is a fully personalised, data-informed, coach-led performance environment
              designed for serious athletes who want elite-level structure — without being physically onsite. This is
              not remote workouts. This is not generic programming.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* Why Most Online Programs Fail */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeIn direction="left">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-12 bg-accent" />
                  <p className="text-sm font-medium text-accent uppercase tracking-widest">The Problem</p>
                </div>
                <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                  Why Most Online Programs Fail
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Performance is not built on exercises alone. It is built on informed progression.
                </p>
              </div>
            </FadeIn>

            <FadeIn direction="right" delay={0.15}>
              <div className="space-y-3">
                {failurePoints.map((point) => (
                  <div key={point} className="flex items-start gap-3 bg-white rounded-xl border border-border p-4">
                    <AlertTriangle className="size-5 text-accent shrink-0 mt-0.5" />
                    <p className="text-sm text-foreground leading-relaxed">{point}</p>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* This Is Not Self Service */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-4">
                <ShieldCheck className="size-7 text-primary" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                This Is Not Self Service
              </h2>
            </div>

            <div className="space-y-6">
              <div className="bg-surface rounded-2xl border border-border p-6 sm:p-8">
                <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                  This system is built for athletes who value structure, oversight, and long-term performance. Standards
                  are high. Capacity is limited. Entry is selective.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  If you want automated workouts, this is not for you. If you want expert-guided performance
                  development, you may qualify.
                </p>
              </div>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* Video Placeholder */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <FadeIn>
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">See How It Works</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                See How It Works
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                A look inside the system that drives athlete development remotely.
              </p>
            </div>

            <div className="relative aspect-video bg-primary rounded-2xl overflow-hidden flex items-center justify-center group cursor-pointer">
              {/* Subtle gradient overlay */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/80 via-primary to-primary" />

              {/* Play button */}
              <div className="relative z-10 flex flex-col items-center gap-4">
                <div className="flex size-20 items-center justify-center rounded-full bg-accent/20 group-hover:bg-accent/30 transition-colors">
                  <Play className="size-8 text-accent ml-1" />
                </div>
                <p className="text-sm text-white/60">Video coming soon</p>
              </div>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* Core Components — Horizontal Scroll */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">What You Get</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                Core Components of the System
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Five integrated pillars that separate this from every other online program.
              </p>
            </div>
          </FadeIn>

          {/* Scrollable container with snap */}
          <FadeIn delay={0.1}>
            <div className="overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-4 scrollbar-hide">
              <div className="flex gap-4 w-max lg:w-full lg:grid lg:grid-cols-5">
                {coreComponents.map((component) => {
                  const Icon = component.icon
                  return (
                    <div
                      key={component.title}
                      className="group relative overflow-hidden snap-start shrink-0 w-[280px] lg:w-auto bg-white rounded-2xl border border-border p-6 hover:shadow-md transition-shadow"
                    >
                      <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                        <Icon className="size-6 text-primary" />
                      </div>
                      <h3 className="text-base font-semibold text-primary mb-2">{component.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{component.description}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Apply — Inquiry Form */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface" id="apply">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-12">
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="lg:sticky lg:top-32">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-8 bg-accent" />
                  <p className="text-sm font-medium text-accent uppercase tracking-widest">Get Started</p>
                </div>
                <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                  Apply for Online Coaching
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  The Online Performance System is not open enrollment. Begin with an application to determine if this
                  is the right fit.
                </p>
                <div className="bg-primary rounded-2xl p-5 text-primary-foreground">
                  <p className="text-sm font-medium mb-1">Selective Entry</p>
                  <p className="text-xs text-primary-foreground/80 leading-relaxed">
                    We only take on athletes we can genuinely help. Every application is reviewed personally within 48
                    hours.
                  </p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.15} className="lg:col-span-3">
              <div className="bg-white rounded-2xl border border-border p-6 sm:p-8">
                <InquiryForm
                  defaultService="online"
                  heading="Apply for Online Coaching"
                  description="Tell us about your goals and training background."
                />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <FAQSection title="Online Coaching FAQ" faqs={onlineFAQs} />
    </>
  )
}
