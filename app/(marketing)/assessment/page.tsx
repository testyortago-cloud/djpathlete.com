import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Dumbbell, Activity, Target, Zap, Brain, BarChart3 } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { InquiryForm } from "@/components/public/InquiryForm"
import { Button } from "@/components/ui/button"

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
  provider: { "@type": "Organization", name: "DJP Athlete", url: "https://djpathlete.com" },
  serviceType: "Return to Performance Assessment",
  areaServed: "Worldwide",
  description:
    "Performance-based assessment process designed to evaluate readiness for high-level sport after the conclusion of clinical care.",
  url: "https://djpathlete.com/assessment",
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

const assessmentUses = [
  "Inform a structured return-to-performance program",
  "Guide in-person or online coaching",
  "Identify readiness gaps before competition",
  "Reduce reinjury risk through targeted development",
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

      {/* ===================== HERO · CLINICAL BLUEPRINT ===================== */}
      <section className="relative overflow-hidden bg-surface text-primary">
        {/* Warm corner glow */}
        <div
          aria-hidden
          className="absolute top-0 right-0 w-1/2 h-full pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 90% 30%, oklch(0.7 0.08 60 / 0.12), transparent 60%)",
          }}
        />

        {/* Top dossier bar */}
        <div className="relative border-b border-primary/15">
          <div className="mx-auto max-w-7xl px-4 md:px-6 py-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em]">
            <span className="text-primary/55">Dossier · RTP / 2026.04</span>
            <span className="hidden sm:flex items-center gap-4">
              <span className="text-primary/55">Subject · Cleared Athlete</span>
              <span className="h-3 w-px bg-primary/20" />
              <span className="text-accent">Stage · Post-Clearance</span>
            </span>
          </div>
        </div>

        <div className="relative mx-auto max-w-7xl px-4 md:px-6 pt-20 md:pt-28 pb-20 md:pb-28">
          <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 items-start">
            <FadeIn>
              <div>
                <div className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] pr-4 text-primary/55">
                  <span className="inline-block size-1.5 rounded-full bg-accent" />
                  Return to Performance
                </div>

                <h1 className="mt-6 font-heading text-[42px] leading-[0.98] tracking-tight sm:text-6xl md:text-7xl font-semibold text-primary">
                  Cleared
                  <br />
                  is not the same
                  <br />
                  as <span className="italic font-normal text-accent">ready.</span>
                </h1>

                <p className="mt-8 max-w-lg text-base leading-7 md:text-lg md:leading-8 text-muted-foreground">
                  Medical clearance is a starting line, not a finish. Competition exposes a different
                  reality — high-speed chaos, reactive decisions, accumulated fatigue.
                  Return-to-performance testing closes that gap.
                </p>

                {/* Cleared → Ready gauge */}
                <div className="mt-10 max-w-lg">
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] mb-2 text-primary/55">
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

            {/* Right — anatomical blueprint card */}
            <FadeIn delay={0.1}>
              <div className="relative">
                <div className="rounded-sm border border-primary/15 bg-background p-6 md:p-8">
                  {/* Blueprint header */}
                  <div className="flex items-center justify-between pb-4 border-b border-primary/15 font-mono text-[10px] uppercase tracking-[0.3em] text-primary/50">
                    <span>Fig · A1 / Readiness map</span>
                    <span>Scale · 1:1</span>
                  </div>

                  {/* Anatomical blueprint */}
                  <div className="relative mt-5 aspect-[5/6]">
                    <svg
                      viewBox="0 0 500 600"
                      className="absolute inset-0 w-full h-full"
                      aria-hidden
                    >
                      <defs>
                        <pattern
                          id="bp-grid"
                          x="0"
                          y="0"
                          width="25"
                          height="25"
                          patternUnits="userSpaceOnUse"
                        >
                          <path
                            d="M 25 0 L 0 0 0 25"
                            fill="none"
                            stroke="var(--primary)"
                            strokeOpacity="0.1"
                            strokeWidth="0.5"
                          />
                        </pattern>
                      </defs>
                      <rect width="500" height="600" fill="url(#bp-grid)" />

                      {/* Abstract human silhouette */}
                      <g
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="250" cy="80" r="28" />
                        <path d="M250,108 L250,140 M210,150 C225,142 275,142 290,150 L295,250 L290,320 L270,330 L230,330 L210,320 L205,250 Z" />
                        <line
                          x1="250"
                          y1="140"
                          x2="250"
                          y2="330"
                          strokeDasharray="2 3"
                          stroke="var(--primary)"
                          strokeOpacity="0.5"
                        />
                        <path d="M210,160 L170,210 L160,290 L168,340" />
                        <path d="M290,160 L330,210 L340,290 L332,340" />
                        <path d="M215,330 L230,370 L250,375 L270,370 L285,330" />
                        <path d="M232,370 L220,470 L212,560" />
                        <path d="M268,370 L280,470 L288,560" />
                        <path d="M200,560 L230,560 L235,572 L205,572 Z" />
                        <path d="M270,560 L300,560 L295,572 L265,572 Z" />
                      </g>

                      {/* Measurement crosshairs */}
                      {[
                        { x: 250, y: 80, id: "M-01", label: "Neuro-reactive", pos: "right" },
                        { x: 160, y: 290, id: "M-02", label: "Symmetry · L", pos: "left" },
                        { x: 340, y: 290, id: "M-03", label: "Symmetry · R", pos: "right" },
                        { x: 250, y: 375, id: "M-04", label: "Hip/pelvis load", pos: "right" },
                        { x: 220, y: 470, id: "M-05", label: "Decel braking", pos: "left" },
                      ].map((p) => (
                        <g key={p.id}>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r="14"
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth="1"
                          />
                          <circle cx={p.x} cy={p.y} r="3" fill="var(--accent)" />
                          <line
                            x1={p.x - 20}
                            y1={p.y}
                            x2={p.x - 9}
                            y2={p.y}
                            stroke="var(--accent)"
                            strokeWidth="0.8"
                          />
                          <line
                            x1={p.x + 9}
                            y1={p.y}
                            x2={p.x + 20}
                            y2={p.y}
                            stroke="var(--accent)"
                            strokeWidth="0.8"
                          />
                          <line
                            x1={p.x}
                            y1={p.y - 20}
                            x2={p.x}
                            y2={p.y - 9}
                            stroke="var(--accent)"
                            strokeWidth="0.8"
                          />
                          <line
                            x1={p.x}
                            y1={p.y + 9}
                            x2={p.x}
                            y2={p.y + 20}
                            stroke="var(--accent)"
                            strokeWidth="0.8"
                          />
                          {p.pos === "right" ? (
                            <g>
                              <line
                                x1={p.x + 14}
                                y1={p.y}
                                x2={p.x + 70}
                                y2={p.y}
                                stroke="var(--primary)"
                                strokeOpacity="0.5"
                                strokeWidth="0.8"
                              />
                              <text
                                x={p.x + 76}
                                y={p.y - 4}
                                fontFamily="var(--font-mono), monospace"
                                fontSize="10"
                                letterSpacing="2"
                                fill="var(--accent)"
                              >
                                {p.id}
                              </text>
                              <text
                                x={p.x + 76}
                                y={p.y + 9}
                                fontFamily="var(--font-body), sans-serif"
                                fontSize="10"
                                fill="var(--primary)"
                              >
                                {p.label}
                              </text>
                            </g>
                          ) : (
                            <g>
                              <line
                                x1={p.x - 14}
                                y1={p.y}
                                x2={p.x - 70}
                                y2={p.y}
                                stroke="var(--primary)"
                                strokeOpacity="0.5"
                                strokeWidth="0.8"
                              />
                              <text
                                x={p.x - 76}
                                y={p.y - 4}
                                fontFamily="var(--font-mono), monospace"
                                fontSize="10"
                                letterSpacing="2"
                                textAnchor="end"
                                fill="var(--accent)"
                              >
                                {p.id}
                              </text>
                              <text
                                x={p.x - 76}
                                y={p.y + 9}
                                fontFamily="var(--font-body), sans-serif"
                                fontSize="10"
                                textAnchor="end"
                                fill="var(--primary)"
                              >
                                {p.label}
                              </text>
                            </g>
                          )}
                        </g>
                      ))}

                      <line
                        x1="100"
                        x2="400"
                        y1="580"
                        y2="580"
                        stroke="var(--primary)"
                        strokeOpacity="0.3"
                      />
                      <text
                        x="405"
                        y="584"
                        fontFamily="var(--font-mono), monospace"
                        fontSize="9"
                        letterSpacing="2"
                        fill="var(--primary)"
                        fillOpacity="0.5"
                      >
                        GROUND
                      </text>
                    </svg>
                  </div>

                  {/* Footer spec */}
                  <div className="mt-5 grid grid-cols-3 divide-x divide-primary/15 border-t border-primary/15">
                    {[
                      { v: "Post-rehab", l: "Stage" },
                      { v: "Performance", l: "Method" },
                      { v: "Data-led", l: "Evidence" },
                    ].map((s) => (
                      <div key={s.l} className="px-3 pt-4 first:pl-0 last:pr-0">
                        <div className="font-heading text-sm font-semibold text-primary">{s.v}</div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.25em] mt-0.5 text-primary/50">
                          {s.l}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ===================== EDITORIAL · THE PROBLEM ===================== */}
      <section className="relative py-24 lg:py-32 px-4 sm:px-8 bg-background">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
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
                      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent tabular-nums shrink-0 w-10">
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
                <div className="absolute -top-3 left-6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] bg-surface text-accent">
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
                <h3 className="mt-10 font-mono text-[10px] uppercase tracking-[0.3em] mb-4 text-primary/55">
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
                <div className="absolute -top-3 left-6 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] bg-surface text-primary/70">
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

      {/* ===================== ASSESSMENT USES ===================== */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 bg-background">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
              § 3 · Integration
            </div>
            <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] text-primary max-w-3xl">
              Assessment is the starting point, not the end.
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-12 grid gap-0 border-y border-border">
              {assessmentUses.map((u, i) => (
                <div
                  key={u}
                  className="group flex items-center gap-6 py-6 border-b border-border last:border-b-0 transition-colors hover:bg-surface px-2"
                >
                  <span className="font-mono text-xs uppercase tracking-[0.3em] text-accent tabular-nums shrink-0 w-14">
                    USE/{String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-heading text-xl md:text-2xl font-medium tracking-tight text-primary flex-1">
                    {u}
                  </span>
                  <ArrowRight className="size-5 text-accent opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== INSTRUMENTS ===================== */}
      <section id="instruments" className="relative py-24 lg:py-32 px-4 sm:px-8 overflow-hidden bg-surface">
        <div className="relative max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-16">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
                  § 4 · Instruments
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
                      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
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
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
              § 5 · Outcome
            </div>
            <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.02] text-primary max-w-3xl">
              The result of this process is{" "}
              <span className="italic font-normal text-accent">clarity.</span>
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-12 border border-border rounded-sm overflow-hidden">
              <div className="grid grid-cols-[80px_1fr_1fr] font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground bg-surface border-b border-border">
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

      {/* ===================== INTAKE ===================== */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 bg-surface" id="apply">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-10 lg:gap-16">
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="lg:sticky lg:top-28">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
                  § 6 · Intake
                </div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-primary leading-[1.05]">
                  Find out where you{" "}
                  <span className="italic font-normal">truly stand.</span>
                </h2>
                <p className="mt-5 text-muted-foreground leading-7">
                  Beyond clearance, beyond guesswork. Book an assessment to begin the process.
                </p>
                <div className="mt-8 border border-dashed border-primary/25 rounded-sm px-5 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent mb-2">
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
