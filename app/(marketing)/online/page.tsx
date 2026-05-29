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
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { InquiryForm } from "@/components/public/InquiryForm"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Online Sports Performance Training",
  description:
    "Online sports performance training programs for serious athletes: individualized, coach-led, with video feedback. By Darren J Paul, PhD (Tampa Bay, FL).",
  alternates: { canonical: "/online" },
  openGraph: {
    title: "Online Sports Performance Training | DJP Athlete",
    description:
      "Online sports performance training programs for serious athletes: individualized, coach-led, with video feedback. By Darren J Paul, PhD.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Online Sports Performance Training | DJP Athlete",
    description:
      "Online sports performance training for serious athletes: individualized, coach-led, with video feedback. By Darren J Paul, PhD.",
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
  serviceType: "Online Sports Performance Training",
  description:
    "Online sports performance training for serious athletes. Online sports training programs led by an online personal trainer for athletes — sports performance coach support, sports training online, individualized programming, video feedback, and direct coaching access.",
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

export default function OnlinePage() {
  return (
    <>
      <JsonLd data={serviceSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Services", url: "/services" },
          { name: "Online Coaching", url: "/online" },
        ]}
      />

      {/* ===================== HERO · PERFORMANCE FLOOR ===================== */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="relative mx-auto max-w-7xl px-4 pt-28 pb-16 md:px-6 md:pt-36 md:pb-20">
          <FadeIn>
            <div className="max-w-3xl">
              {/* Editorial */}
              <div>
                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-primary-foreground/70">
                  <span className="h-px w-10 bg-accent" />
                  <span>Online coaching</span>
                </div>

                <h1 className="mt-6 font-heading text-[40px] leading-[0.95] tracking-tight font-semibold sm:text-5xl md:text-6xl lg:text-7xl">
                  Online Sports Performance Training for Athletes
                </h1>
                <p className="mt-4 font-heading text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-primary-foreground/85">
                  Remote by <span className="italic font-normal text-accent">design.</span>{" "}
                  Not by <span className="italic font-normal text-accent">default.</span>
                </p>

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

      <ManagedFaqSection
        pageKey="online"
        variant="cards"
        eyebrow="Common questions"
        title="Online Coaching FAQ"
      />

    </>
  )
}
