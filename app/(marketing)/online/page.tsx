import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
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
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Online Sports Performance Training",
  description:
    "Online sports performance training for serious athletes. Online sports training programs with an online personal trainer for athletes — individualized, coach-led, with video feedback.",
  alternates: { canonical: "/online" },
  openGraph: {
    title: "Online Sports Performance Training | DJP Athlete",
    description:
      "Online sports performance training. Online sports training programs with an online personal trainer for athletes — individualized, coach-led, with video feedback.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Online Sports Performance Training | DJP Athlete",
    description:
      "Online sports performance training. Online sports training programs with individualized, coach-led programming and video feedback.",
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
      url: "https://www.darrenjpaul.com",
    },
  },
  serviceType: "Online Athletic Performance Coaching",
  description:
    "A complete, coach-led online performance system for serious athletes. Individualized programming, video feedback, and direct coaching access.",
  url: "https://www.darrenjpaul.com/online",
}

const failures: { n: string; headline: string; detail: string }[] = [
  {
    n: "01",
    headline: "Template programming.",
    detail: "Generic plans ignore sport, history, and the athlete in front of you.",
  },
  {
    n: "02",
    headline: "No real assessment.",
    detail: "Load gets prescribed before movement quality is even understood.",
  },
  {
    n: "03",
    headline: "Blind to readiness.",
    detail: "Fatigue, recovery, and tolerance go unmonitored until something breaks.",
  },
  {
    n: "04",
    headline: "Missing context.",
    detail: "Travel, competition, and injury history aren't adjusted for.",
  },
  {
    n: "05",
    headline: "No feedback.",
    detail: "Coaching stops the moment the spreadsheet goes out.",
  },
]

const components = [
  {
    icon: ClipboardList,
    n: "01",
    title: "Individualised programming",
    description:
      "Plans built around your sport, history, and capacity. No templates. No recycled blocks.",
    tag: "Fully bespoke",
  },
  {
    icon: Video,
    n: "02",
    title: "Video review",
    description:
      "Movement quality, intent, and execution reviewed continuously. Technique is coached, not assumed.",
    tag: "Weekly",
  },
  {
    icon: Activity,
    n: "03",
    title: "Performance testing",
    description:
      "Remote diagnostics track readiness, speed qualities, and capacity across training blocks.",
    tag: "Benchmarked",
  },
  {
    icon: HeartPulse,
    n: "04",
    title: "Load & wellness",
    description:
      "Fatigue, recovery, and tolerance guide training decisions in real time — not at quarter's end.",
    tag: "Daily check-in",
  },
  {
    icon: MessageCircle,
    n: "05",
    title: "Direct coaching",
    description:
      "You're supported, adjusted, and guided throughout. No DM dead-ends. No auto-replies.",
    tag: "Coach on-call",
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

/* Coaching-note feed — reads as a coach's working notes, not a log. */
const coachNotes: { time: string; note: string; by: "athlete" | "coach" }[] = [
  { time: "Mon 07:04", note: "Upper contrast session logged · 42 min", by: "athlete" },
  { time: "Mon 09:12", note: "Trap-bar pull reviewed — tighter lat engagement on rep 3.", by: "coach" },
  { time: "Tue 12:30", note: "Sleep 6.2h · HRV down 9% from baseline", by: "athlete" },
  { time: "Tue 13:05", note: "PM volume cut 15%. Recovery-led decision.", by: "coach" },
  { time: "Wed 18:22", note: "Nice intent on pulls today. Hold that.", by: "coach" },
]

export default function OnlinePage() {
  return (
    <>
      <JsonLd data={serviceSchema} />

      {/* ===================== HERO · PERFORMANCE FLOOR ===================== */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(0deg, transparent calc(100% - 1px), rgba(255,255,255,0.9) calc(100% - 1px)), linear-gradient(90deg, transparent calc(100% - 1px), rgba(255,255,255,0.9) calc(100% - 1px))",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 85% 20%, oklch(0.70 0.08 60 / 0.28), transparent 50%), radial-gradient(circle at 10% 100%, oklch(0.70 0.08 60 / 0.16), transparent 45%)",
          }}
        />

        <div className="relative mx-auto max-w-7xl px-4 pt-28 pb-16 md:px-6 md:pt-36 md:pb-20">
          <FadeIn>
            <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-14 items-end">
              {/* Left — editorial */}
              <div>
                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-primary-foreground/70">
                  <span className="h-px w-10 bg-accent" />
                  <span>Online coaching</span>
                </div>

                <h1 className="mt-6 font-heading text-[40px] leading-[0.95] tracking-tight font-semibold sm:text-6xl md:text-7xl lg:text-[88px]">
                  Remote by <span className="italic font-normal text-accent">design.</span>
                  <br />
                  Not by <span className="italic font-normal text-accent">default.</span>
                </h1>

                <p className="mt-7 max-w-xl text-base leading-7 text-primary-foreground/75 md:text-lg md:leading-8">
                  A coach-led online performance system for serious athletes. Programmed, monitored, and
                  adjusted in real time — built on assessment, not guesswork.
                </p>

                <div className="mt-10 flex flex-wrap gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full bg-accent text-primary hover:bg-accent/90 shadow-lg"
                  >
                    <Link href="#apply">
                      Apply for coaching
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="rounded-full border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/5"
                  >
                    <Link href="#components">See what's inside</Link>
                  </Button>
                </div>

                {/* Athletic stat strip */}
                <div className="mt-14 grid grid-cols-3 max-w-md border-y border-primary-foreground/15 divide-x divide-primary-foreground/15">
                  {[
                    { v: "Selective", l: "Application" },
                    { v: "1-on-1", l: "Direct coaching" },
                    { v: "Data-led", l: "Decisions" },
                  ].map((s) => (
                    <div key={s.l} className="py-4 px-3 first:pl-0 last:pr-0">
                      <div className="font-heading text-lg font-semibold">{s.v}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.25em] text-primary-foreground/55">
                        {s.l}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right — Pit-wall style performance panel */}
              <div className="relative">
                {/* Small caption above */}
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-primary-foreground/55 pb-3">
                  <span>A week in the system</span>
                  <span className="flex items-center gap-2 text-accent">
                    <span className="relative flex size-1.5">
                      <span className="absolute inset-0 rounded-full bg-accent/60 animate-ping" />
                      <span className="relative size-1.5 rounded-full bg-accent" />
                    </span>
                    Live
                  </span>
                </div>

                <div className="rounded-2xl border border-primary-foreground/15 bg-primary/60 backdrop-blur-sm shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] overflow-hidden ring-1 ring-inset ring-primary-foreground/5">
                  {/* Header row */}
                  <div className="flex items-center justify-between border-b border-primary-foreground/10 px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-xs font-heading text-accent">
                        A
                      </div>
                      <div>
                        <div className="font-heading text-sm font-semibold">Athlete profile</div>
                        <div className="text-[10px] uppercase tracking-[0.25em] text-primary-foreground/50">
                          Field sport · Wk 07 of 12
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-heading text-xl font-semibold tabular-nums">94</div>
                      <div className="text-[9px] uppercase tracking-[0.25em] text-primary-foreground/50">
                        Readiness
                      </div>
                    </div>
                  </div>

                  {/* Load vs. readiness trace */}
                  <div className="px-5 pt-5">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-primary-foreground/55">
                      <span>Load vs. readiness · 14 days</span>
                      <span className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5">
                          <span className="h-[2px] w-3.5 bg-accent" /> Load
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-[2px] w-3.5"
                            style={{
                              background:
                                "repeating-linear-gradient(to right, rgba(255,255,255,0.7) 0 2px, transparent 2px 5px)",
                            }}
                          />
                          Readiness
                        </span>
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 400 120"
                      className="mt-3 w-full h-[130px]"
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                      {[0, 1, 2, 3].map((i) => (
                        <line
                          key={i}
                          x1="0"
                          x2="400"
                          y1={25 + i * 24}
                          y2={25 + i * 24}
                          stroke="rgba(255,255,255,0.06)"
                          strokeDasharray="2 4"
                        />
                      ))}
                      <path
                        d="M0,82 L30,76 L60,70 L90,58 L120,62 L150,52 L180,46 L210,50 L240,40 L270,44 L300,34 L330,38 L360,30 L400,24 L400,120 L0,120 Z"
                        fill="oklch(0.70 0.08 60 / 0.16)"
                      />
                      <polyline
                        points="0,82 30,76 60,70 90,58 120,62 150,52 180,46 210,50 240,40 270,44 300,34 330,38 360,30 400,24"
                        fill="none"
                        stroke="oklch(0.70 0.08 60)"
                        strokeWidth="1.8"
                      />
                      <polyline
                        points="0,72 40,64 80,68 120,54 160,50 200,58 240,48 280,42 320,52 360,46 400,40"
                        fill="none"
                        stroke="rgba(255,255,255,0.7)"
                        strokeWidth="1.4"
                        strokeDasharray="4 4"
                      />
                      <line
                        x1="330"
                        x2="330"
                        y1="0"
                        y2="120"
                        stroke="oklch(0.70 0.08 60 / 0.6)"
                        strokeWidth="0.8"
                      />
                      <circle cx="330" cy="38" r="4" fill="oklch(0.70 0.08 60)" />
                      <circle cx="330" cy="38" r="8" fill="oklch(0.70 0.08 60 / 0.3)" />
                    </svg>
                  </div>

                  {/* Coach notes */}
                  <div className="px-5 pt-4 pb-5">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-primary-foreground/55 mb-3">
                      <span>This week's notes</span>
                      <span>{coachNotes.length} entries</span>
                    </div>
                    <ul className="space-y-2.5">
                      {coachNotes.slice(0, 4).map((n, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span
                            className={`mt-1 size-1.5 rounded-full shrink-0 ${
                              n.by === "coach" ? "bg-accent" : "bg-primary-foreground/40"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.25em] text-primary-foreground/50">
                              <span>{n.time}</span>
                              <span>·</span>
                              <span className={n.by === "coach" ? "text-accent" : ""}>
                                {n.by === "coach" ? "Coach" : "Athlete"}
                              </span>
                            </div>
                            <div className="mt-0.5 text-sm leading-6 text-primary-foreground/85 truncate">
                              {n.note}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Caption below */}
                <p className="mt-4 text-[11px] leading-5 text-primary-foreground/50 italic max-w-[22rem]">
                  Representative. Real athlete data stays with the athlete.
                </p>
              </div>
            </div>
          </FadeIn>
        </div>

        {/* Capability strip — replaces the brand marquee; reads as pro-sport focus areas */}
        <div className="relative border-t border-primary-foreground/10 bg-primary/85 backdrop-blur-sm">
          <div className="flex overflow-hidden py-4">
            <div className="marquee-track-slow flex shrink-0 gap-12 whitespace-nowrap pr-12 items-center">
              {[
                "Programming",
                "Video review",
                "Diagnostics",
                "Load & wellness",
                "Direct coaching",
                "Return-to-play",
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-12">
                  <span className="font-heading text-2xl md:text-3xl font-semibold uppercase tracking-tight text-primary-foreground/85">
                    {s}
                  </span>
                  <span className="text-accent text-xl md:text-2xl leading-none">◆</span>
                </div>
              ))}
            </div>
            <div
              className="marquee-track-slow flex shrink-0 gap-12 whitespace-nowrap pr-12 items-center"
              aria-hidden
            >
              {[
                "Programming",
                "Video review",
                "Diagnostics",
                "Load & wellness",
                "Direct coaching",
                "Return-to-play",
              ].map((s, i) => (
                <div key={`b-${i}`} className="flex items-center gap-12">
                  <span className="font-heading text-2xl md:text-3xl font-semibold uppercase tracking-tight text-primary-foreground/85">
                    {s}
                  </span>
                  <span className="text-accent text-xl md:text-2xl leading-none">◆</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===================== WHY MOST FAIL · EDITORIAL LIST ===================== */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 bg-background">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-accent">01 · The problem</div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] text-primary">
                  Why most online programs{" "}
                  <span className="italic font-normal text-accent">fall short.</span>
                </h2>
                <p className="mt-5 text-muted-foreground leading-7 max-w-md">
                  Performance isn't built on exercises alone. It's built on informed progression — and these
                  are the five places most online programs quietly break down.
                </p>
              </div>

              <ol className="divide-y divide-border border-y border-border">
                {failures.map((f) => (
                  <li
                    key={f.n}
                    className="grid grid-cols-[60px_1fr] sm:grid-cols-[80px_1fr_1.2fr] gap-4 sm:gap-8 items-baseline py-6"
                  >
                    <span className="font-heading text-3xl font-semibold tabular-nums text-accent">
                      {f.n}
                    </span>
                    <span className="font-heading text-xl md:text-2xl font-semibold tracking-tight text-primary">
                      {f.headline}
                    </span>
                    <span className="col-span-2 sm:col-span-1 text-base md:text-lg leading-7 text-muted-foreground">
                      {f.detail}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== POSITIONING STATEMENT ===================== */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-[11px] uppercase tracking-[0.3em] text-accent">02 · Positioning</div>
            <h2 className="mt-4 font-heading text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.02] text-primary max-w-4xl">
              This is not a self-service product.
              <br />
              <span className="text-muted-foreground font-normal">It is a</span>{" "}
              <span className="italic text-accent font-normal">supervised system.</span>
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 max-w-3xl">
              <p className="text-lg text-foreground leading-8">
                Built for athletes who value structure, oversight, and long-term performance. Standards are
                high. Capacity is limited. Entry is selective.
              </p>
              <p className="text-lg text-foreground leading-8">
                If you want automated workouts, this isn't for you. If you want expert-guided performance
                development, you may qualify.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== COMPONENTS · INSIDE THE SYSTEM ===================== */}
      <section
        id="components"
        className="relative py-24 lg:py-32 px-4 sm:px-8 bg-primary text-primary-foreground overflow-hidden"
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(0deg, transparent calc(100% - 1px), rgba(255,255,255,0.9) calc(100% - 1px)), linear-gradient(90deg, transparent calc(100% - 1px), rgba(255,255,255,0.9) calc(100% - 1px))",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative max-w-7xl mx-auto">
          <FadeIn>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-8 mb-14">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-accent">03 · Inside the system</div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.02]">
                  Five parts.
                  <br />
                  <span className="italic font-normal text-accent">One feedback loop.</span>
                </h2>
              </div>
              <p className="text-primary-foreground/70 leading-7 max-w-md">
                Integrated pieces that separate this from other online coaching. Each one feeds the next —
                what you train, what you report, what we adjust.
              </p>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="grid gap-px bg-primary-foreground/10 rounded-2xl overflow-hidden border border-primary-foreground/10 sm:grid-cols-2 lg:grid-cols-5">
              {components.map((c) => {
                const Icon = c.icon
                return (
                  <div
                    key={c.n}
                    className="group relative bg-primary p-7 transition-all ring-1 ring-inset ring-transparent hover:ring-accent/40"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-2xl font-semibold tabular-nums text-accent">
                        {c.n}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.25em] text-primary-foreground/55">
                        {c.tag}
                      </span>
                    </div>
                    <Icon className="mt-10 size-7 text-primary-foreground" strokeWidth={1.5} />
                    <h3 className="mt-5 font-heading text-xl font-semibold tracking-tight">{c.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-primary-foreground/70">{c.description}</p>
                  </div>
                )
              })}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===================== APPLY ===================== */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 bg-surface" id="apply">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-10 lg:gap-16">
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="lg:sticky lg:top-28">
                <div className="text-[11px] uppercase tracking-[0.3em] text-accent">04 · Apply</div>
                <h2 className="mt-4 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-primary leading-[1.05]">
                  Apply for
                  <br />
                  <span className="italic font-normal">online coaching.</span>
                </h2>
                <p className="mt-5 text-muted-foreground leading-7">
                  Not open enrolment. Every application is reviewed personally within 48 hours.
                </p>
                <div className="mt-8 border-l-2 border-accent pl-5 py-2">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-accent mb-1.5">
                    Selective entry
                  </p>
                  <p className="text-sm text-muted-foreground leading-6">
                    We only take on athletes we can genuinely help. Fit is mutual.
                  </p>
                </div>
                <div className="mt-10 flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  <ArrowUpRight className="size-3.5 text-accent" />
                  <span>Response within 48h</span>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.15} className="lg:col-span-3">
              <div className="bg-background rounded-2xl border border-border p-6 sm:p-8 shadow-sm">
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

      <FAQSection title="Online Coaching FAQ" faqs={onlineFAQs} />
    </>
  )
}
