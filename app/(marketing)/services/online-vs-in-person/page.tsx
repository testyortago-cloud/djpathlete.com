import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, Minus, MapPin, Globe } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { TrustStrip } from "@/components/public/TrustStrip"

export const metadata: Metadata = {
  title: "Online vs In-Person Sports Performance Coaching",
  description:
    "Online vs in-person sports performance coaching, compared. Methodology, equipment, supervision, fit by athlete type, and pricing — at DJP Athlete in Tampa Bay, FL.",
  alternates: { canonical: "/services/online-vs-in-person" },
  openGraph: {
    title: "Online vs In-Person Sports Performance Coaching | DJP Athlete",
    description:
      "Side-by-side comparison of online and in-person sports performance coaching: methodology, who each fits, equipment, and outcomes.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Online vs In-Person Sports Performance Coaching | DJP Athlete",
    description:
      "Side-by-side comparison of online and in-person sports performance coaching: methodology, who each fits, and outcomes.",
  },
}

interface ComparisonRow {
  criterion: string
  inPerson: string
  online: string
  inPersonHighlighted?: boolean
  onlineHighlighted?: boolean
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    criterion: "Location",
    inPerson: "On-site at 6585 Simons Rd, Zephyrhills, FL 33541 (Tampa Bay).",
    online: "Anywhere with a well-equipped gym and a smartphone.",
  },
  {
    criterion: "Methodology",
    inPerson: "Same diagnostic-driven Five Pillar Framework.",
    online: "Same diagnostic-driven Five Pillar Framework.",
  },
  {
    criterion: "Initial assessment",
    inPerson: "On-site movement, force-platform, and reactive testing in a single visit.",
    online: "Remote assessment over video — movement quality, training history, sport demand, and a sport-specific qualities battery.",
  },
  {
    criterion: "Coaching cadence",
    inPerson: "Weekly to multi-weekly in-person sessions.",
    online: "Weekly programming, weekly video review, daily wellness check-ins, direct messaging.",
    inPersonHighlighted: true,
  },
  {
    criterion: "Real-time feedback",
    inPerson: "Live cueing, hands-on adjustments, immediate exercise substitution.",
    online: "Asynchronous video review with frame-by-frame technique notes; same-day feedback.",
    inPersonHighlighted: true,
  },
  {
    criterion: "Equipment available",
    inPerson: "Full performance facility — racks, free weights, force plates, sprint timing, plyo boxes.",
    online: "Whatever the athlete has access to (commercial gym recommended); programming adapts to environment.",
    inPersonHighlighted: true,
  },
  {
    criterion: "Travel & competition support",
    inPerson: "Limited — sessions assume local presence.",
    online: "Built for it — programs adjust automatically to travel days, time zones, and competition windows.",
    onlineHighlighted: true,
  },
  {
    criterion: "Post-injury / return-to-performance",
    inPerson: "Strongest fit — assessment instruments + hands-on supervision close the gap from clearance to competition.",
    online: "Available with prerequisites: cleared by physio, access to a credible local clinician for in-person retesting milestones.",
    inPersonHighlighted: true,
  },
  {
    criterion: "Best for",
    inPerson: "Tampa Bay-area athletes; high-volume training blocks; return-to-performance phases; youth athletes whose families want supervised work.",
    online: "Touring pros; collegiate athletes balancing in-season travel; athletes outside Florida; high-performing professionals with demanding schedules.",
  },
  {
    criterion: "Application process",
    inPerson: "Inquiry → consultation → on-site assessment → program build.",
    online: "Application → 48h review → remote assessment → Performance Blueprint → coaching begins.",
  },
  {
    criterion: "Selectivity",
    inPerson: "Capacity-limited; in-person spots fill seasonally.",
    online: "Selective entry; application-only.",
  },
  {
    criterion: "Coach",
    inPerson: "Darren J Paul, PhD (CSCS, NASM, USAW Level 2).",
    online: "Darren J Paul, PhD (CSCS, NASM, USAW Level 2).",
  },
]

interface ScenarioFit {
  scenario: string
  recommendation: "in-person" | "online" | "either"
  reasoning: string
}

const SCENARIOS: ScenarioFit[] = [
  {
    scenario: "Pro tennis or pickleball player on tour 8+ months/year",
    recommendation: "online",
    reasoning:
      "Online coaching travels with the athlete, adapts programs around match schedules and time zones, and reviews technique via video.",
  },
  {
    scenario: "Post-ACL athlete cleared by surgeon but not match-fit",
    recommendation: "in-person",
    reasoning:
      "Force-platform testing, on-site reactive testing, and hands-on supervision close the rehab-to-performance gap most efficiently.",
  },
  {
    scenario: "Tampa Bay collegiate athlete with off-season at home",
    recommendation: "in-person",
    reasoning:
      "Local proximity unlocks the deepest coaching relationship — multi-weekly sessions and in-person reassessment.",
  },
  {
    scenario: "Youth athlete (14–17) in long-term development",
    recommendation: "in-person",
    reasoning:
      "Movement quality benefits most from real-time cueing at this stage; parents value supervised, age-appropriate programming.",
  },
  {
    scenario: "High-performing professional in a different state",
    recommendation: "online",
    reasoning:
      "Online program structures performance training around demanding schedules; weekly video review keeps technique honest.",
  },
  {
    scenario: "Athlete recovering from a recent injury, low-volume return phase",
    recommendation: "either",
    reasoning:
      "If geography allows, in-person is preferred for early stages. Once weight-room work resumes confidently, online can take over.",
  },
]

const VS_FAQS = [
  {
    question: "Is online sports performance coaching as effective as in-person?",
    answer:
      "For most athletes outside the Tampa Bay area, online coaching delivers near-equivalent outcomes when the athlete has access to a well-equipped gym and engages with the wellness logging, video review, and weekly programming. The methodology — diagnostic-driven, individually programmed, continuously adjusted — is identical between the two formats. In-person is preferred when real-time cueing, on-site instrumentation (force plates, sprint timing), or post-injury supervision is the deciding factor. For touring professionals or athletes whose schedules disqualify regular in-person sessions, online is structurally a better fit than splitting time.",
  },
  {
    question: "Can I switch from online to in-person (or vice versa)?",
    answer:
      "Yes. Athletes regularly start in one format and shift to the other based on life or competitive circumstances — for example, an athlete moving back to Florida for an off-season block, or a touring athlete starting in-person and transitioning to online when the season begins. The Performance Blueprint travels across formats; the underlying assessment data, programming history, and coaching relationship continue uninterrupted.",
  },
  {
    question: "Which is better for return-to-performance after surgery?",
    answer:
      "In-person is structurally preferred for the early-to-mid return-to-performance phase because instrumented testing (force plates, motion capture, reactive testing) and hands-on supervision close the gap from medical clearance to competition readiness most efficiently. Online return-to-performance work is possible later in the phase, when the athlete is past the highest-risk window and has access to a credible local clinician for in-person retesting milestones.",
  },
  {
    question: "Do online and in-person athletes train differently?",
    answer:
      "Within the same Performance Blueprint, no — the program structure, exercise selection logic, autoregulation rules, and coaching feedback follow the same Five Pillar Framework. Differences are operational: online athletes log wellness daily and submit weekly video, in-person athletes are observed live. The output of either path is the same: an athlete with measurable, durable performance qualities who knows what they can trust under competition stress.",
  },
  {
    question: "Which is more expensive?",
    answer:
      "In-person and online have different cost structures. Pricing is shared after application review and depends on coaching depth, frequency, and program length. We do not benchmark against $20–30/month training apps; the work is structurally different. A free 15-minute consultation determines fit before any commitment.",
  },
]

const comparePageSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Online vs In-Person Sports Performance Coaching",
  url: "https://www.darrenjpaul.com/services/online-vs-in-person",
  description:
    "Side-by-side comparison of online and in-person sports performance coaching at DJP Athlete: methodology, equipment, supervision, fit by athlete type, and outcomes.",
  about: [
    { "@type": "Service", name: "Online Sports Performance Coaching" },
    { "@type": "Service", name: "In-Person Sports Performance Coaching" },
  ],
  isPartOf: {
    "@type": "WebSite",
    name: "DJP Athlete",
    url: "https://www.darrenjpaul.com",
  },
}

const compareFAQSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: VS_FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
}

export default function OnlineVsInPersonPage() {
  return (
    <>
      <JsonLd data={comparePageSchema} />
      <JsonLd data={compareFAQSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Services", url: "/services" },
          { name: "Online vs In-Person", url: "/services/online-vs-in-person" },
        ]}
      />

      {/* Hero */}
      <section className="pt-32 pb-12 lg:pt-40 lg:pb-16 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Compare</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              Online vs In-Person Coaching, Compared.
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Same methodology. Different delivery. Below is a direct comparison so athletes (and parents, agents, and
              physiotherapists) can pick the right path.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Semantic Answer Block (AEO) */}
      <SemanticAnswerBlock
        eyebrow="Quick answer"
        question="Online vs in-person sports performance coaching — which is better?"
        answer="Both formats deliver the same diagnostic-driven Five Pillar Framework methodology under Darren J Paul, PhD. In-person coaching at our Zephyrhills, Florida facility is preferred when real-time cueing, on-site instrumentation (force plates, motion capture, sprint timing), or post-injury supervision is the deciding factor — and is the strongest fit for return-to-performance phases and Tampa Bay-area youth athletes. Online coaching is preferred for touring professionals, collegiate athletes balancing in-season travel, athletes outside Florida, and high-performing professionals with demanding schedules. Outcomes converge when the online athlete has access to a well-equipped gym and engages with daily wellness logging, weekly video review, and direct messaging. Athletes routinely switch between formats as life and competition circumstances change."
      />

      {/* Format-at-a-glance */}
      <section className="py-16 lg:py-20 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-6">
            <FadeIn direction="left">
              <div className="rounded-2xl border border-border bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="size-5 text-accent" aria-hidden />
                  <p className="text-xs font-medium text-accent uppercase tracking-widest">In-Person</p>
                </div>
                <h2 className="text-xl font-heading font-semibold text-primary mb-2">
                  Tampa Bay, Florida.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Coach-led, on-site, instrumented. Best for return-to-performance, youth long-term development, and
                  athletes within driving range of Zephyrhills.
                </p>
                <Link
                  href="/in-person"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
                >
                  See in-person coaching
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </FadeIn>

            <FadeIn direction="right">
              <div className="rounded-2xl border border-border bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="size-5 text-accent" aria-hidden />
                  <p className="text-xs font-medium text-accent uppercase tracking-widest">Online</p>
                </div>
                <h2 className="text-xl font-heading font-semibold text-primary mb-2">
                  Worldwide. Coach-led.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Application-only, supervised remote system. Best for touring pros, traveling athletes, collegiates in
                  season, and high-performing professionals.
                </p>
                <Link
                  href="/online"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
                >
                  See online coaching
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-12 lg:py-16 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-10">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">Side by Side</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight">
                The full comparison
              </h2>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            {/* Mobile-friendly: stack on small screens */}
            <div className="hidden md:block overflow-hidden rounded-2xl border border-border bg-white">
              <table className="w-full">
                <thead className="bg-primary text-primary-foreground">
                  <tr>
                    <th scope="col" className="px-6 py-4 text-left text-sm font-heading font-semibold w-1/4">
                      Criterion
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-sm font-heading font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-4" aria-hidden /> In-Person (Tampa Bay)
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-sm font-heading font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <Globe className="size-4" aria-hidden /> Online
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr key={row.criterion} className={i % 2 === 0 ? "bg-white" : "bg-surface/50"}>
                      <th scope="row" className="px-6 py-4 text-left text-sm font-medium text-foreground align-top">
                        {row.criterion}
                      </th>
                      <td
                        className={`px-6 py-4 text-sm leading-relaxed align-top ${
                          row.inPersonHighlighted ? "bg-accent/10 text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        {row.inPerson}
                      </td>
                      <td
                        className={`px-6 py-4 text-sm leading-relaxed align-top ${
                          row.onlineHighlighted ? "bg-accent/10 text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        {row.online}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked view */}
            <div className="md:hidden space-y-4">
              {COMPARISON_ROWS.map((row) => (
                <div key={row.criterion} className="rounded-2xl border border-border bg-white p-5">
                  <p className="text-xs font-medium text-accent uppercase tracking-widest mb-3">{row.criterion}</p>
                  <div className="space-y-3">
                    <div>
                      <div className="inline-flex items-center gap-1.5 mb-1">
                        <MapPin className="size-3.5 text-accent" aria-hidden />
                        <span className="text-xs font-semibold text-primary">In-Person</span>
                      </div>
                      <p className={`text-sm leading-relaxed ${row.inPersonHighlighted ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {row.inPerson}
                      </p>
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-1.5 mb-1">
                        <Globe className="size-3.5 text-accent" aria-hidden />
                        <span className="text-xs font-semibold text-primary">Online</span>
                      </div>
                      <p className={`text-sm leading-relaxed ${row.onlineHighlighted ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {row.online}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Scenario fit */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">Pick by scenario</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                Which format is right for your situation?
              </h2>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-4">
            {SCENARIOS.map((s, i) => {
              const recLabel =
                s.recommendation === "in-person" ? "In-Person" : s.recommendation === "online" ? "Online" : "Either"
              const Icon =
                s.recommendation === "in-person" ? MapPin : s.recommendation === "online" ? Globe : Check
              return (
                <FadeIn key={s.scenario} delay={i * 0.05}>
                  <div className="rounded-2xl border border-border bg-white p-5 h-full flex flex-col">
                    <p className="text-base font-medium text-foreground mb-3">{s.scenario}</p>
                    <div className="inline-flex items-center gap-1.5 self-start mb-3 rounded-full bg-accent/15 px-3 py-1">
                      <Icon className="size-3.5 text-accent" aria-hidden />
                      <span className="text-xs font-semibold text-primary uppercase tracking-wider">→ {recLabel}</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed flex-1">{s.reasoning}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* Methodology shared block */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto text-center">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Same methodology</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-6">
              Both formats run the Five Pillar Framework.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8">
              Assessment & diagnostics → individualized programming → load & readiness monitoring → technical coaching →
              long-term athlete development. The framework does not change because the delivery channel does.
            </p>
            <Link
              href="/philosophy"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-accent transition-colors"
            >
              Read the Grey Zone philosophy
              <ArrowRight className="size-3.5" />
            </Link>
          </FadeIn>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">Common questions</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight">
                Frequently asked
              </h2>
            </div>
          </FadeIn>

          <div className="space-y-3">
            {VS_FAQS.map((faq, i) => (
              <FadeIn key={faq.question} delay={i * 0.04}>
                <details className="group rounded-2xl border border-border bg-white p-6 transition-shadow hover:shadow-sm open:shadow-sm">
                  <summary className="flex items-start justify-between gap-4 cursor-pointer list-none">
                    <h3 className="text-base sm:text-lg font-heading font-semibold text-primary">{faq.question}</h3>
                    <ArrowRight className="size-5 text-accent shrink-0 mt-0.5 transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted-foreground">{faq.answer}</p>
                </details>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Trust strip + CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <FadeIn>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold tracking-tight mb-4">
              Still deciding? Apply once — we&apos;ll recommend the right path.
            </h2>
            <p className="text-lg text-primary-foreground/80 leading-relaxed mb-8">
              The application asks the questions we use to recommend in-person, online, or a hybrid path. No commitment
              until we&apos;ve agreed on fit.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
              <Link
                href="/online#apply"
                className="inline-flex items-center gap-2 bg-accent text-primary px-8 py-4 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all hover:shadow-md group"
              >
                Apply for coaching
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 border border-primary-foreground/30 text-primary-foreground px-8 py-4 rounded-full text-sm font-medium hover:bg-primary-foreground/5 transition-all"
              >
                Book free 15-min consultation
              </Link>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <TrustStrip variant="compact" className="text-primary-foreground/70" />
          </FadeIn>
        </div>
      </section>
    </>
  )
}
