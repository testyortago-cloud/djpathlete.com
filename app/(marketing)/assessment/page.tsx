import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Dumbbell, Activity, Target, Zap, Brain, BarChart3 } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { InquiryForm } from "@/components/public/InquiryForm"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Athlete Assessments — Return to Performance",
  description:
    "Athlete assessments built for performance, not just clearance. Athletic performance assessment, return to sport assessment, and assessment of injuries — Tampa Bay, FL.",
  alternates: { canonical: "/assessment" },
  openGraph: {
    title: "Athlete Assessments — Return to Performance | DJP Athlete",
    description:
      "Athlete assessments built for performance, not just clearance. Athletic performance assessment, return to sport assessment, and assessment of injuries — Tampa Bay, FL.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Athlete Assessments — Return to Performance | DJP Athlete",
    description:
      "Athlete assessments built for performance, not just clearance. Return to sport assessment in Tampa Bay, FL.",
  },
}

const assessmentSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: { "@type": "Organization", name: "DJP Athlete", url: "https://www.darrenjpaul.com" },
  serviceType: "Athlete Assessments — Return to Sport Assessment",
  areaServed: "Worldwide",
  description:
    "Athlete assessments built for performance, not just clearance. Athletic performance assessment, return to sport assessment, and assessment of athletic injuries — a sports performance assessment process that evaluates readiness for high-level sport after the conclusion of clinical care, contrasting traditional vs performance-based assessment.",
  url: "https://www.darrenjpaul.com/assessment",
}

// HowTo schema — the 4-step return-to-performance assessment process.
// AI Overviews favor step-extraction patterns for "how does X work" queries.
const assessmentHowToSchema = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How a Return-to-Performance Assessment Works",
  description:
    "A four-step return-to-performance assessment that bridges medical clearance and competition readiness for athletes recovering from injury.",
  totalTime: "P1D",
  estimatedCost: { "@type": "MonetaryAmount", currency: "USD" },
  supply: [
    { "@type": "HowToSupply", name: "Recent medical clearance documentation" },
    { "@type": "HowToSupply", name: "Training history (12 months)" },
    { "@type": "HowToSupply", name: "Sport schedule and competition demands" },
  ],
  tool: [
    { "@type": "HowToTool", name: "Force platform" },
    { "@type": "HowToTool", name: "Motion capture" },
    { "@type": "HowToTool", name: "Speed timing gates" },
    { "@type": "HowToTool", name: "Reactive testing equipment" },
  ],
  step: [
    {
      "@type": "HowToStep",
      position: 1,
      name: "Intake & history review",
      text: "We review the athlete's injury history, surgical or rehab notes, current medical clearance status, sport-specific demands, and competition timeline. Findings shape which instruments are prioritized in the assessment battery.",
      url: "https://www.darrenjpaul.com/assessment#step-1",
    },
    {
      "@type": "HowToStep",
      position: 2,
      name: "Instrumented assessment battery",
      text: "On-site testing across force production, asymmetry under load, movement quality, speed and deceleration, reactive response, and power output. Each instrument is selected based on the athlete's sport and injury context. Captured: force-platform metrics, motion-capture joint kinematics, speed splits, reactive latency, and rate-of-force-development data.",
      url: "https://www.darrenjpaul.com/assessment#step-2",
    },
    {
      "@type": "HowToStep",
      position: 3,
      name: "Performance profile & risk gap analysis",
      text: "Test data is interpreted against sport-specific competition demands and the athlete's developmental stage. Output is a written performance profile naming asymmetries, capacity gaps, and risk areas — distinct from clinical clearance criteria.",
      url: "https://www.darrenjpaul.com/assessment#step-3",
    },
    {
      "@type": "HowToStep",
      position: 4,
      name: "Return progression & readiness plan",
      text: "A staged return-to-performance plan is built from the performance profile, with measurable milestones the athlete must clear before progressing to the next phase. Plan delivered in writing for use by the athlete, their physiotherapist, and team performance staff.",
      url: "https://www.darrenjpaul.com/assessment#step-4",
    },
  ],
}

const traditionalProblems = [
  { label: "Strength numbers", aside: "without context" },
  { label: "Movement screens", aside: "without load" },
  { label: "Speed", aside: "without braking" },
  { label: "Power", aside: "without control" },
]

const collaborators = [
  "Physiotherapists",
  "Surgeons",
  "Strength & Conditioning coaches",
  "Team performance staff",
]

const instruments: {
  icon: typeof Dumbbell
  id: string
  label: string
  metric: string
  description: string
}[] = [
  {
    icon: Dumbbell,
    id: "I-01",
    label: "Force Platform",
    metric: "kN · asymmetry %",
    description: "Ground reaction force, peak output, left/right balance under load.",
  },
  {
    icon: Activity,
    id: "I-02",
    label: "Motion Capture",
    metric: "joint angles · quality",
    description: "Movement strategy, control, and compensation patterns frame by frame.",
  },
  {
    icon: BarChart3,
    id: "I-03",
    label: "Load Monitoring",
    metric: "exposure · tolerance",
    description: "Cumulative training load tracked against recovery and readiness.",
  },
  {
    icon: Zap,
    id: "I-04",
    label: "Speed Timing",
    metric: "split · top-end",
    description: "Acceleration, top speed, and deceleration across measured distances.",
  },
  {
    icon: Brain,
    id: "I-05",
    label: "Reactive Testing",
    metric: "latency · accuracy",
    description: "Decision-making under stimulus — cued and open-environment responses.",
  },
  {
    icon: Target,
    id: "I-06",
    label: "Power Diagnostics",
    metric: "watts · RFD",
    description: "Explosive output and rate of force development across movement planes.",
  },
]

const outcomes = [
  { label: "Performance profile", detail: "a clear, testable read of current qualities" },
  { label: "Asymmetries identified", detail: "compensations and strategy flagged" },
  { label: "Risk gaps defined", detail: "where exposure outstrips capacity" },
  { label: "Return progression", detail: "a targeted plan to close the gap" },
  { label: "Competitive confidence", detail: "evidence behind the decision to play" },
]

export default function AssessmentPage() {
  return (
    <>
      <JsonLd data={assessmentSchema} />
      <JsonLd data={assessmentHowToSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Services", url: "/services" },
          { name: "Return-to-Performance Assessment", url: "/assessment" },
        ]}
      />

      {/* ===================== HERO · CLINICAL BLUEPRINT ===================== */}
      <section className="relative overflow-hidden bg-surface text-primary">
        <div className="relative mx-auto max-w-7xl px-4 md:px-6 pt-20 md:pt-28 pb-20 md:pb-28">
          <div className="max-w-2xl">
            <FadeIn>
              <div>
                <div className="inline-flex items-center gap-3 font-mono font-bold text-[10px] uppercase tracking-[0.3em] pr-4 text-primary/55">
                  <span className="inline-block size-1.5 rounded-full bg-accent" />
                  Return to Performance
                </div>

                <h1 className="mt-6 font-heading text-[40px] leading-[1.02] tracking-tight sm:text-5xl md:text-6xl font-semibold text-primary">
                  Athlete Assessments for Return-to-Performance
                </h1>
                <p className="mt-4 font-heading text-2xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-primary/85 leading-[1.05]">
                  Cleared is not the same as <span className="italic font-normal text-accent">ready.</span>
                </p>

                <p className="mt-8 max-w-lg text-base leading-7 md:text-lg md:leading-8 text-muted-foreground">
                  Medical clearance is a starting line, not a finish. Competition exposes a different
                  reality — high-speed chaos, reactive decisions, accumulated fatigue.
                  Return-to-performance testing closes that gap.
                </p>

                {/* Cleared → Ready gauge */}
                <div className="mt-10 max-w-lg">
                  <div className="flex items-center justify-between font-mono font-bold text-[10px] uppercase tracking-[0.3em] mb-2 text-primary/55">
                    <span>Cleared</span>
                    <span className="text-accent">Gap · measured</span>
                    <span>Ready</span>
                  </div>
                  <div className="relative h-3 rounded-full bg-primary/10 overflow-visible">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary/35"
                      style={{ width: "36%" }}
                    />
                    <div
                      className="absolute top-0 bottom-0 border-l-2 border-dashed border-accent"
                      style={{ left: "36%" }}
                    />
                    <div
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: "36%",
                        width: "64%",
                        background:
                          "repeating-linear-gradient(45deg, oklch(0.7 0.08 60 / 0.25) 0 6px, transparent 6px 10px)",
                      }}
                    />
                    <div
                      className="absolute -top-1.5 size-6 rounded-full border-2 border-accent bg-surface flex items-center justify-center"
                      style={{ left: "calc(36% - 12px)" }}
                    >
                      <span className="size-2 rounded-full bg-accent" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between font-mono text-[10px] tabular-nums tracking-widest text-primary/50">
                    <span>T 0</span>
                    <span>CURRENT · 36%</span>
                    <span>T 100</span>
                  </div>
                </div>

                <div className="mt-10 flex flex-wrap gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Link href="#apply">
                      Book an assessment
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="rounded-full bg-transparent border-primary/25 text-primary hover:bg-primary/5"
                  >
                    <Link href="#instruments">View the instruments</Link>
                  </Button>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ===================== SEMANTIC ANSWER BLOCK (AEO) =====================
          Hidden visually (boss flagged as noisy) but kept in DOM via sr-only
          so AI Overviews / LLM crawlers still extract the RTP definition. */}
      <div className="sr-only" aria-hidden="false">
        <SemanticAnswerBlock
          eyebrow="Quick answer"
          question="What is return-to-performance assessment?"
          answer="Return-to-performance assessment is criterion-based testing that bridges medical clearance and competition readiness — the answer to every cleared athlete's question, &lsquo;I&rsquo;m cleared, but am I ready?&rsquo; Distinct from clinical rehab, return-to-performance ends only when objective testing confirms it: force-platform output, limb-symmetry index above 90%, single-leg hop performance, reactive control, and psychological readiness. Most ACL athletes need 9–12 months post-surgery to reach this point, and research shows fewer than half pass standard symmetry thresholds at the typical 6-month clearance window. We work alongside your physiotherapist, surgeon, and team staff — additive to clinical care, never a replacement. Conducted at our Zephyrhills, Florida facility by Darren J Paul, PhD (CSCS, NASM)."
        />
      </div>

      {/* ===================== EDITORIAL · THE PROBLEM ===================== */}
      <section className="relative py-24 lg:py-32 px-4 sm:px-8 bg-background">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
              <div>
                <div className="font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-accent">
                  § 1 · The Problem
                </div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] text-primary">
                  Traditional assessment asks the wrong question.
                </h2>
              </div>
              <div>
                <p className="text-xl leading-9 text-foreground">
                  <span className="italic text-muted-foreground">&ldquo;Are you healed?&rdquo;</span> is a
                  clinical milestone.{" "}
                  <span className="italic text-accent">&ldquo;Are you prepared to perform?&rdquo;</span>{" "}
                  is a different question entirely — and the only one that matters at kickoff.
                </p>

                <div className="mt-10 divide-y divide-border border-y border-border">
                  {traditionalProblems.map((p, i) => (
                    <div key={p.label} className="flex items-baseline gap-6 py-5">
                      <span className="font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-accent tabular-nums shrink-0 w-10">
                        §{String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-heading text-xl md:text-2xl font-semibold text-primary tracking-tight">
                        {p.label}
                      </span>
                      <span className="ml-auto text-sm md:text-base italic text-muted-foreground text-right">
                        {p.aside}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== WHAT IT IS · NOT ===================== */}
      <section className="relative py-24 lg:py-32 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <div className="grid gap-14 lg:grid-cols-2 lg:gap-16">
            <FadeIn>
              <div className="relative rounded-sm border border-primary/15 bg-background p-8 md:p-10 h-full">
                <div className="absolute -top-3 left-6 px-3 py-1 font-mono font-bold text-[10px] uppercase tracking-[0.3em] bg-surface text-accent">
                  § 2 · What this is
                </div>
                <p className="mt-4 text-xl leading-8 text-primary">
                  A performance-based assessment process designed to evaluate readiness for high-level sport
                  after the conclusion of clinical care.
                </p>
                <p className="mt-5 text-base leading-7 text-muted-foreground">
                  My role is to assess movement strategy, force characteristics, load tolerance, and
                  decision-making under physical stress.
                </p>
                <h3 className="mt-10 font-mono font-bold text-[10px] uppercase tracking-[0.3em] mb-4 text-primary/55">
                  Collaborates with
                </h3>
                <ul className="space-y-2.5">
                  {collaborators.map((c) => (
                    <li key={c} className="flex items-baseline gap-3 text-base text-primary">
                      <span className="h-px w-6 bg-accent shrink-0 translate-y-[-3px]" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="relative rounded-sm border-2 border-dashed border-primary/20 p-8 md:p-10 h-full">
                <div className="absolute -top-3 left-6 px-3 py-1 font-mono font-bold text-[10px] uppercase tracking-[0.3em] bg-surface text-primary/70">
                  § 2 · What this is not
                </div>
                <p className="mt-4 font-heading text-3xl md:text-4xl font-semibold leading-tight tracking-tight text-primary">
                  Not rehabilitation.
                  <br />
                  Not diagnosis.
                  <br />
                  <span className="italic font-normal text-muted-foreground">
                    Not injury management.
                  </span>
                </p>
                <p className="mt-6 text-base leading-7 text-muted-foreground">
                  The goal is alignment — not replacement of medical professionals. This assessment is a
                  performance layer on top of the clinical work, not a substitute for it.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ===================== INSTRUMENTS ===================== */}
      <section id="instruments" className="relative py-24 lg:py-32 px-4 sm:px-8 overflow-hidden bg-surface">
        <div className="relative max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-16">
              <div>
                <div className="font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-accent">
                  § 3 · Instruments
                </div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.02] max-w-xl text-primary">
                  Measuring what actually{" "}
                  <span className="italic font-normal text-accent">matters.</span>
                </h2>
              </div>
              <p className="md:max-w-sm text-base leading-7 text-muted-foreground">
                Industry-grade equipment mapped to the qualities that decide performance — force, speed,
                control, readiness.
              </p>
            </div>
          </FadeIn>

          <div className="grid gap-px bg-primary/15 sm:grid-cols-2 lg:grid-cols-3">
            {instruments.map((item, i) => {
              const Icon = item.icon
              return (
                <FadeIn key={item.id} delay={i * 0.05}>
                  <div className="relative h-full p-7 bg-surface">
                    {/* Measurement bracket corners */}
                    <div className="absolute top-3 left-3 size-5 border-t border-l border-primary/40" />
                    <div className="absolute top-3 right-3 size-5 border-t border-r border-primary/40" />
                    <div className="absolute bottom-3 left-3 size-5 border-b border-l border-primary/40" />
                    <div className="absolute bottom-3 right-3 size-5 border-b border-r border-primary/40" />

                    <div className="flex items-center justify-between">
                      <Icon className="size-6 text-primary" strokeWidth={1.5} />
                      <span className="font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-accent">
                        {item.id}
                      </span>
                    </div>
                    <h3 className="mt-6 font-heading text-lg font-semibold tracking-tight text-primary">
                      {item.label}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/55">
                      {item.metric}
                    </p>
                    <p className="mt-5 text-sm leading-6 text-muted-foreground">{item.description}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* ===================== OUTCOME LEDGER ===================== */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 bg-background">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-accent">
              § 4 · Outcome
            </div>
            <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.02] text-primary max-w-3xl">
              The result of this process is{" "}
              <span className="italic font-normal text-accent">clarity.</span>
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-12 border border-border rounded-sm overflow-hidden">
              <div className="grid grid-cols-[80px_1fr_1fr] font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-muted-foreground bg-surface border-b border-border">
                <div className="px-4 py-3">№</div>
                <div className="px-4 py-3">Output</div>
                <div className="px-4 py-3">Detail</div>
              </div>
              {outcomes.map((o, i) => (
                <div
                  key={o.label}
                  className="grid grid-cols-[80px_1fr_1fr] items-baseline border-b border-border last:border-b-0"
                >
                  <div className="px-4 py-5 font-mono text-xs tabular-nums text-accent tracking-widest">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="px-4 py-5 font-heading text-lg font-semibold text-primary tracking-tight">
                    {o.label}
                  </div>
                  <div className="px-4 py-5 text-sm text-muted-foreground leading-6 italic">
                    {o.detail}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-8 text-base md:text-lg italic text-muted-foreground leading-8 max-w-2xl">
              The objective is not to eliminate risk — sport always carries risk. The objective is to reduce
              avoidable risk through informed performance decision-making.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* FAQ (managed via CMS) — renders only when published FAQs exist for this page */}
      <ManagedFaqSection
        pageKey="assessment"
        variant="cards"
        eyebrow="Common questions"
        title="Frequently asked questions."
      />

      {/* ===================== INTAKE ===================== */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 bg-surface" id="apply">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-10 lg:gap-16">
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="lg:sticky lg:top-28">
                <div className="font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-accent">
                  § 5 · Intake
                </div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-primary leading-[1.05]">
                  Find out where you{" "}
                  <span className="italic font-normal">truly stand.</span>
                </h2>
                <p className="mt-5 text-muted-foreground leading-7">
                  Beyond clearance, beyond guesswork. Book an assessment to begin the process.
                </p>
                <div className="mt-8 border border-dashed border-primary/25 rounded-sm px-5 py-4">
                  <p className="font-mono font-bold text-[10px] uppercase tracking-[0.3em] text-accent mb-2">
                    For cleared athletes
                  </p>
                  <p className="text-sm text-muted-foreground leading-6">
                    If you are still in active rehab, speak with your medical team first.
                  </p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.15} className="lg:col-span-3">
              <div className="bg-background rounded-sm border border-border p-6 sm:p-8">
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
