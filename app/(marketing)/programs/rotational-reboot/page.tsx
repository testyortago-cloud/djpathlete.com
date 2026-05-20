import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  Target,
  CalendarDays,
  Dumbbell,
  ShieldCheck,
  Repeat,
} from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { TrustStrip } from "@/components/public/TrustStrip"
import { AuthorCard } from "@/components/shared/AuthorCard"
import { FadeIn } from "@/components/shared/FadeIn"
import { Button } from "@/components/ui/button"
import { InquiryForm } from "@/components/public/InquiryForm"
import { SITE_URL } from "@/lib/constants"
import { DJP_AUTHOR_PERSON } from "@/lib/brand/author"

const PAGE_URL = `${SITE_URL}/programs/rotational-reboot`
const PRICE = "79.00"
const REGULAR_PRICE = "249.00"

export const metadata: Metadata = {
  // Layout template appends " | DJP Athlete", so keep the brand out of the title here.
  title: "Rotational Reboot: 6-Week Rotational Power Program",
  description:
    "A 6-week rotational power program for athletes in rotational sports (tennis, golf, baseball, lacrosse, hockey). Core-led, beginner to moderate, by Darren J Paul, PhD. $79, usually $249.",
  alternates: { canonical: "/programs/rotational-reboot" },
  openGraph: {
    title: "Rotational Reboot: 6-Week Rotational Power Program | DJP Athlete",
    description:
      "A 6-week rotational power program for tennis, golf, baseball, lacrosse and hockey athletes. Core-led, by Darren J Paul, PhD. $79.",
    type: "website",
    url: PAGE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Rotational Reboot: 6-Week Rotational Power Program | DJP Athlete",
    description:
      "A 6-week rotational power program for rotational-sport athletes. Core-led, by Darren J Paul, PhD. $79, usually $249.",
  },
}

// ── Content ───────────────────────────────────────────────────────────────

const SPORTS = [
  "Tennis",
  "Golf",
  "Baseball",
  "Softball",
  "Lacrosse",
  "Ice & field hockey",
  "Soccer",
  "Throwing events",
  "Boxing & MMA",
  "Cricket",
  "Volleyball",
  "Squash & padel",
]

const WEEKS = [
  {
    n: "Weeks 1 to 2",
    label: "Re-pattern",
    body: "Rebuild the foundation: anti-rotation control, rib-cage and pelvis positioning, and clean rotational mechanics at low intensity. You earn the right to produce power before you chase it.",
  },
  {
    n: "Weeks 3 to 4",
    label: "Build",
    body: "Load the pattern: heavier anti-rotation work, controlled rotational strength, and the first low-volume power exposures. Intensity climbs from beginner toward moderate.",
  },
  {
    n: "Weeks 5 to 6",
    label: "Express",
    body: "Turn strength into speed: rotational power, throws, and faster, more sport-like expression, still inside a controlled, moderate-intensity ceiling. You finish moving better and producing more.",
  },
]

const INSIDE = [
  "24 sessions (6 weeks, 4 sessions per week) laid out day by day",
  "A core-led build (~70% rotational core and trunk, ~30% legs and arms support work)",
  "A clear beginner to moderate intensity progression, week over week",
  "Every exercise mapped to a coaching cue and a demonstration from the DJP video library",
  "Warm-up and movement-prep sequences built into each session, so there's no guesswork",
  "Regressions and progressions so the work fits where you actually are right now",
  "Trains on a full gym or a basic home setup, with minimal equipment required",
  "Built and programmed by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2)",
]

const WHO = [
  "Athletes in rotational sports like tennis, golf, baseball, lacrosse, hockey and soccer",
  "Players who feel their racket-, club- or stick-speed has plateaued",
  "Athletes who are 'strong in the gym' but don't feel it transfer to rotation on the field",
  "Off-season and pre-season athletes who want a structured block, not random workouts",
  "Coaches and parents who want a properly programmed plan instead of YouTube roulette",
]

// ── Schema ────────────────────────────────────────────────────────────────

const productSchema = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Rotational Reboot: 6-Week Rotational Power Training Program",
  description:
    "A 6-week, 4-sessions-per-week rotational power training program for athletes in rotational sports (tennis, golf, baseball, lacrosse, hockey, soccer). Core-led, beginner-to-moderate progression. Designed by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2).",
  url: PAGE_URL,
  category: "Sports performance training program",
  brand: { "@type": "Brand", name: "DJP Athlete" },
  image: `${SITE_URL}/images/professionalheadshot.jpg`,
  audience: {
    "@type": "PeopleAudience",
    audienceType:
      "Athletes in rotational sports like tennis, golf, baseball, softball, lacrosse, hockey, soccer, and throwing events",
  },
  offers: {
    "@type": "Offer",
    price: PRICE,
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: PAGE_URL,
    seller: { "@type": "Organization", name: "DJP Athlete", url: SITE_URL },
  },
}

const courseSchema = {
  "@context": "https://schema.org",
  "@type": "Course",
  name: "Rotational Reboot: 6-Week Rotational Power Training Program",
  description:
    "A structured 6-week rotational power training program for rotational-sport athletes. Four sessions per week, core-led, with a deliberate beginner-to-moderate intensity progression.",
  url: PAGE_URL,
  provider: { "@type": "Organization", name: "DJP Athlete", url: SITE_URL },
  hasCourseInstance: {
    "@type": "CourseInstance",
    courseMode: "online",
    courseWorkload: "P6W",
    instructor: DJP_AUTHOR_PERSON,
  },
  offers: {
    "@type": "Offer",
    price: PRICE,
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: PAGE_URL,
  },
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function RotationalRebootPage() {
  return (
    <>
      <JsonLd data={productSchema} />
      <JsonLd data={courseSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Programs", url: "/resources" },
          { name: "Rotational Reboot", url: "/programs/rotational-reboot" },
        ]}
      />

      {/* ───────────────── Hero ───────────────── */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 80% 15%, oklch(0.70 0.08 60 / 0.4), transparent 45%), linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "auto, 72px 72px, 72px 72px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-32 sm:px-8 lg:pb-24 lg:pt-40">
          <FadeIn>
            <div className="flex items-center gap-3">
              <RotateCcw className="size-4 text-accent" aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
                Evergreen program · 6 weeks
              </span>
            </div>
            <h1 className="mt-6 font-heading text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Rotational Reboot
            </h1>
            <p className="mt-4 font-heading text-xl font-medium text-primary-foreground/85 sm:text-2xl lg:text-3xl">
              A 6-week rotational power program for athletes whose sport turns on a fast,
              well-sequenced rotation.
            </p>
            <p className="mt-6 max-w-2xl text-base leading-7 text-primary-foreground/70 sm:text-lg">
              In tennis, golf, baseball, lacrosse, hockey and soccer, performance comes from rotating
              the body through your core and hips into the racket, club, stick, bat or ball. This is
              the block built for exactly that: core-led, deliberately progressed from beginner to
              moderate intensity, programmed by Darren J Paul, PhD.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="rounded-full bg-accent text-primary hover:bg-accent/90">
                <Link href="#get-the-program">
                  Get the program · ${PRICE.replace(".00", "")}
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
              <div className="flex items-center gap-3 text-sm text-primary-foreground/70">
                <span className="font-heading text-lg text-primary-foreground/40 line-through">
                  ${REGULAR_PRICE.replace(".00", "")}
                </span>
                <span className="rounded-full bg-primary-foreground/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest">
                  One payment · lifetime access
                </span>
              </div>
            </div>

            <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-primary-foreground/15 pt-8 sm:grid-cols-4">
              {[
                { k: "Length", v: "6 weeks" },
                { k: "Per week", v: "4 sessions" },
                { k: "Focus", v: "~70% core" },
                { k: "Intensity", v: "Beginner to moderate" },
              ].map((s) => (
                <div key={s.k}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/50">
                    {s.k}
                  </dt>
                  <dd className="mt-2 font-heading text-lg font-semibold sm:text-xl">{s.v}</dd>
                </div>
              ))}
            </dl>
          </FadeIn>
        </div>
      </section>

      {/* ───────────────── AEO answer block ───────────────── */}
      <SemanticAnswerBlock
        eyebrow="What this is"
        question="What is the Rotational Reboot program?"
        answer="Rotational Reboot is a 6-week training program of 4 sessions per week (24 sessions in total) built to develop rotational power for athletes in rotational sports such as tennis, golf, baseball, lacrosse, hockey and soccer. It is core-led: roughly 70% of the work targets the rotational core and trunk, with the remaining 30% supporting legs and arms. The program runs a deliberate progression from beginner to moderate intensity, so athletes earn rotational control before chasing rotational speed. Every session is laid out day by day, every exercise is mapped to a coaching cue and a video demonstration, and the work scales to a full gym or a basic home setup. It was designed and programmed by Darren J Paul, PhD (CSCS, NASM, USA Weightlifting Level 2), who has coached 500+ athletes across 15+ sports including WTA professionals. Price: $79 (usually $249), one payment, lifetime access."
      />

      {/* ───────────────── Who it's for ───────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">Who it's for</span>
              </div>
              <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
                Built for rotational sport, professional and aspiring.
              </h2>
              <p className="mt-5 max-w-md leading-7 text-muted-foreground">
                If your sport rewards a faster, better-sequenced turn, your training should be built
                around rotation, not have it bolted on at the end.
              </p>
              <ul className="mt-8 flex flex-wrap gap-2">
                {SPORTS.map((s) => (
                  <li
                    key={s}
                    className="rounded-full bg-primary/10 px-3.5 py-1.5 text-sm font-medium text-primary"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <ul className="space-y-4">
              {WHO.map((line) => (
                <li key={line} className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                  <span className="text-muted-foreground">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </FadeIn>
      </section>

      {/* ───────────────── The 6-week build ───────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
          <FadeIn>
            <div className="max-w-2xl">
              <div className="flex items-center gap-3">
                <CalendarDays className="size-4 text-accent" aria-hidden />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">The build</span>
              </div>
              <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
                Control first. Strength next. Speed last.
              </h2>
              <p className="mt-5 leading-7 text-muted-foreground">
                Six weeks, three phases. Each one earns the next: you build the pattern before you
                load it, and load it before you ask it to move fast.
              </p>
            </div>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {WEEKS.map((w, i) => (
                <li key={w.n} className="relative rounded-2xl border border-border bg-white p-6">
                  <div className="absolute right-5 top-5 font-heading text-3xl font-semibold tabular-nums text-accent/30">
                    0{i + 1}
                  </div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{w.n}</p>
                  <h3 className="mt-2 font-heading text-xl font-semibold text-primary">{w.label}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{w.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
              <Repeat className="size-4 text-accent" aria-hidden />
              Roughly 70% of every week is rotational core and trunk work; the other 30% is the legs
              and arms strength that supports it.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ───────────────── What's inside ───────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <FadeIn>
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <div>
              <div className="flex items-center gap-3">
                <Dumbbell className="size-4 text-accent" aria-hidden />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">What's inside</span>
              </div>
              <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
                Everything laid out. No guesswork.
              </h2>
              <ul className="mt-8 space-y-3">
                {INSIDE.map((line) => (
                  <li key={line} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Why it works */}
            <div className="rounded-3xl border border-border bg-primary p-8 text-primary-foreground sm:p-10">
              <div className="flex items-center gap-3">
                <Target className="size-4 text-accent" aria-hidden />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">Why it works</span>
              </div>
              <p className="mt-5 leading-7 text-primary-foreground/80">
                Power in rotational sport isn&apos;t made in your arms. It&apos;s made in the floor,
                routed through your hips and trunk, and delivered late. Most programs train the body
                in straight lines and hope rotation turns up on its own. It usually doesn&apos;t.
              </p>
              <p className="mt-4 leading-7 text-primary-foreground/80">
                Rotational Reboot puts the core and the rotational pattern at the center. It builds
                anti-rotation control first, then rotational strength, then speed: the same order
                rotational athletes are coached in high-performance settings, written down as a plan
                you can actually run.
              </p>
              <blockquote className="mt-6 border-l-2 border-accent pl-5 font-heading text-lg leading-snug text-primary-foreground">
                &ldquo;Cleared is not the same as ready, and strong is not the same as fast. You build
                the pattern, you load the pattern, then you let it fly.&rdquo;
              </blockquote>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.22em] text-primary-foreground/55">
                Darren J Paul, PhD
              </p>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ───────────────── Coach ───────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-20">
          <FadeIn>
            <div className="mb-6 flex items-center gap-3">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">Who built it</span>
            </div>
            <AuthorCard variant="full" />
            <TrustStrip variant="full" className="mt-6" />
          </FadeIn>
        </div>
      </section>

      {/* ───────────────── FAQ (CMS-managed) ───────────────── */}
      <ManagedFaqSection
        pageKey="programs/rotational-reboot"
        variant="list"
        eyebrow="Questions"
        title="Rotational Reboot, answered"
        className="max-w-4xl"
      />

      {/* ───────────────── Get the program ───────────────── */}
      <section id="get-the-program" className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-8 lg:py-24">
          <FadeIn>
            <div className="text-center">
              <div className="flex items-center justify-center gap-3">
                <div className="h-px w-8 bg-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">Get started</span>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                Rotational Reboot · ${PRICE.replace(".00", "")}
                <span className="ml-3 align-middle font-heading text-xl text-primary-foreground/40 line-through">
                  ${REGULAR_PRICE.replace(".00", "")}
                </span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl leading-7 text-primary-foreground/75">
                One payment, lifetime access to the full 6-week program. Leave your details and we&apos;ll
                send you everything you need to start, including the secure payment link and your
                access.
              </p>
            </div>
            <div className="mt-10 rounded-3xl bg-background p-2 text-foreground sm:p-3">
              <InquiryForm
                defaultService="online"
                heading="Get the Rotational Reboot program"
                description="Tell us your sport and where you train. We'll send your access and the secure payment link, and Darren can answer anything first if you'd like."
              />
            </div>
            <p className="mt-6 text-center text-sm text-primary-foreground/60">
              Prefer to ask first?{" "}
              <Link href="/contact" className="font-medium text-accent underline underline-offset-4">
                Contact Darren directly
              </Link>
              .
            </p>
          </FadeIn>
        </div>
      </section>
    </>
  )
}
