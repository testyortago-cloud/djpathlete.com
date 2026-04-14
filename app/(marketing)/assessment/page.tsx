import type { Metadata } from "next"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Dumbbell,
  Activity,
  Target,
  Shield,
  Users,
  BarChart3,
  Zap,
  Brain,
  Footprints,
} from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { InquiryForm } from "@/components/public/InquiryForm"

export const metadata: Metadata = {
  title: "Assessment & Return to Performance",
  description:
    "Performance-based assessment for athletes beyond rehab. Close the gap between medical clearance and true competitive readiness.",
  openGraph: {
    title: "Assessment & Return to Performance | DJP Athlete",
    description:
      "Performance-based assessment for athletes beyond rehab. Close the gap between medical clearance and true competitive readiness.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Assessment & Return to Performance | DJP Athlete",
    description:
      "Performance-based assessment for athletes beyond rehab. Close the gap between medical clearance and true competitive readiness.",
  },
}

const assessmentSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
  },
  serviceType: "Return to Performance Assessment",
  areaServed: "Worldwide",
  description:
    "Performance-based assessment process designed to evaluate readiness for high-level sport after the conclusion of clinical care.",
  url: "https://djpathlete.com/assessment",
}

const traditionalProblems = [
  {
    icon: Dumbbell,
    text: "Strength numbers without context",
  },
  {
    icon: Footprints,
    text: "Movement screens without load",
  },
  {
    icon: Zap,
    text: "Speed without braking",
  },
  {
    icon: Activity,
    text: "Power without control",
  },
]

const collaborators = ["Physiotherapists", "Surgeons", "Strength & Conditioning coaches", "Team performance staff"]

const assessmentUses = [
  "Inform a structured return-to-performance program",
  "Guide in-person or online coaching",
  "Identify readiness gaps before competition",
  "Reduce reinjury risk through targeted development",
]

const equipmentPlaceholders = [
  { icon: Dumbbell, label: "Force Platform" },
  { icon: Activity, label: "Motion Capture" },
  { icon: BarChart3, label: "Load Monitoring" },
  { icon: Zap, label: "Speed Timing" },
  { icon: Brain, label: "Reactive Testing" },
  { icon: Target, label: "Power Diagnostics" },
]

const outcomes = [
  "A clear performance profile",
  "Identification of asymmetries or strategic compensations",
  "Defined risk gaps",
  "A targeted return-to-performance progression strategy",
  "Greater confidence in competitive reintegration",
]

export default function AssessmentPage() {
  return (
    <>
      <JsonLd data={assessmentSchema} />

      {/* Hero — The Missing Middle */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">
                Assessment & Return to Performance
              </p>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              The Missing Middle
            </h1>
            <p className="text-xl sm:text-2xl font-heading font-medium text-primary/80 mb-8">
              The Gap Between Clearance and True Readiness
            </p>
            <div className="max-w-3xl space-y-5">
              <p className="text-lg text-muted-foreground leading-relaxed">
                Medical clearance does not equal performance readiness. An athlete may be pain-free. Strength may be
                &ldquo;within range.&rdquo; Tissue healing timelines may be complete. Yet competition exposes a
                different reality — high-speed chaos, reactive decision-making, accumulated fatigue, and repeated
                high-force demands. This is where reinjury often occurs.
              </p>
              <p className="text-lg text-foreground font-medium leading-relaxed">
                Assessment & Return to Performance Testing exists to close that gap.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Authority — Clearance Is Not Readiness */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">The Problem</p>
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Clearance Is Not Readiness.
            </h2>
            <div className="max-w-3xl mb-10">
              <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                Most athletes return to training cleared, but underprepared. They pass clinical milestones. They fail
                performance demands.
              </p>
              <p className="text-base text-muted-foreground leading-relaxed">Traditional assessments rely on:</p>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              {traditionalProblems.map((problem) => {
                const Icon = problem.icon
                return (
                  <div
                    key={problem.text}
                    className="flex items-center gap-3 p-4 rounded-xl bg-white border border-border"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                      <Icon className="size-5 text-destructive" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{problem.text}</p>
                  </div>
                )
              })}
            </div>
          </FadeIn>

          <div className="max-w-3xl space-y-4">
            <p className="text-lg text-muted-foreground leading-relaxed">
              This assessment system is built on our detailed Performance Framework. We do not ask, &ldquo;Are you
              healed?&rdquo; We answer, &ldquo;Are you prepared to perform?&rdquo;
            </p>
          </div>
        </div>
      </section>

      {/* What This Assessment Is — and Is Not */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-12 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">The Assessment</p>
          </div>
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-6">
            What This Assessment Is — and Is Not
          </h2>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <FadeIn>
              <div className="space-y-5">
                <div className="flex items-start gap-3 p-4 rounded-xl bg-surface border border-border">
                  <AlertTriangle className="size-5 text-accent shrink-0 mt-0.5" />
                  <p className="text-base text-foreground leading-relaxed">
                    This is not rehabilitation. It is not medical treatment, diagnosis, or injury management.
                  </p>
                </div>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  It is a performance-based assessment process designed to evaluate readiness for high-level sport after
                  the conclusion of clinical care.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  My role is to assess movement strategy, force characteristics, load tolerance, and decision-making
                  under physical stress.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.15}>
              <div>
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Users className="size-5 text-accent" />
                  Collaborates with
                </h3>
                <ul className="space-y-3">
                  {collaborators.map((role) => (
                    <li key={role} className="flex items-center gap-3 text-base text-foreground">
                      <CheckCircle className="size-4 text-accent shrink-0" />
                      {role}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-base text-muted-foreground leading-relaxed italic">
                  The goal is alignment — not replacement of medical professionals.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* How The System Integrates */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Integration</p>
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Assessment Is the Starting Point, Not the End.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-3xl">
              Athletes may use this assessment to:
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="grid sm:grid-cols-2 gap-4 mb-8 max-w-3xl">
              {assessmentUses.map((use) => (
                <div key={use} className="flex items-start gap-3 p-4 rounded-xl bg-white border border-border">
                  <Target className="size-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm text-foreground leading-relaxed">{use}</p>
                </div>
              ))}
            </div>
          </FadeIn>

          <p className="text-lg text-foreground font-medium leading-relaxed max-w-3xl">
            Assessment without follow-through is incomplete. This system provides both.
          </p>
        </div>
      </section>

      {/* Equipment Placeholder Grid */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">Our Tools</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                Assessment Tools & Equipment
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Industry-grade equipment to measure what matters — force, speed, control, and readiness.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {equipmentPlaceholders.map((item, i) => {
              const Icon = item.icon
              return (
                <FadeIn key={item.label} delay={i * 0.08}>
                  <div className="aspect-[4/3] rounded-2xl bg-surface border border-border flex flex-col items-center justify-center gap-4">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                      <Icon className="size-8 text-primary" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* The Outcome */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">The Outcome</p>
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              The Outcome
            </h2>
            <p className="text-xl font-heading font-medium text-primary/80 mb-8">
              The result of this process is clarity.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mb-8">
              <p className="text-base text-muted-foreground mb-5">Athletes and staff receive:</p>
              <div className="grid sm:grid-cols-2 gap-3 max-w-3xl">
                {outcomes.map((outcome) => (
                  <div key={outcome} className="flex items-start gap-3 p-3">
                    <Shield className="size-5 text-accent shrink-0 mt-0.5" />
                    <p className="text-base text-foreground leading-relaxed">{outcome}</p>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>

          <div className="max-w-3xl p-6 rounded-2xl bg-white border border-border">
            <p className="text-lg text-muted-foreground leading-relaxed">
              The objective is not to eliminate risk — sport always carries risk. The objective is to reduce avoidable
              risk through informed performance decision-making.
            </p>
          </div>
        </div>
      </section>

      {/* Apply — Inquiry Form */}
      <section className="py-16 lg:py-24 px-4 sm:px-8" id="apply">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-12">
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="lg:sticky lg:top-32">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-8 bg-accent" />
                  <p className="text-sm font-medium text-accent uppercase tracking-widest">Get Started</p>
                </div>
                <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                  Ready for a real assessment?
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Find out where you truly stand — beyond clearance, beyond guesswork. Book an assessment to begin the
                  process.
                </p>
                <div className="bg-primary rounded-2xl p-5 text-primary-foreground">
                  <p className="text-sm font-medium mb-1">For Cleared Athletes</p>
                  <p className="text-xs text-primary-foreground/80 leading-relaxed">
                    This assessment is for athletes who have completed clinical rehab and are medically cleared to
                    train. If you are still in rehab, speak with your medical team first.
                  </p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.15} className="lg:col-span-3">
              <div className="bg-white rounded-2xl border border-border p-6 sm:p-8">
                <InquiryForm
                  defaultService="assessment"
                  heading="Book an Assessment"
                  description="Tell us about yourself, your injury history, and your return-to-performance goals."
                />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>
    </>
  )
}
