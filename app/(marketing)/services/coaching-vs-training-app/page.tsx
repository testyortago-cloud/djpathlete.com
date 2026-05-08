import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, X, Smartphone, UserCheck } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { TrustStrip } from "@/components/public/TrustStrip"

export const metadata: Metadata = {
  title: "Sports Performance Coaching vs Training Apps",
  description:
    "Coach-supervised sports performance coaching vs subscription training apps (Future, TrainHeroic, Whoop Coach). What you actually get, how decisions are made, and which fits which athlete.",
  alternates: { canonical: "/services/coaching-vs-training-app" },
  openGraph: {
    title: "Sports Performance Coaching vs Training Apps | DJP Athlete",
    description:
      "Coach-supervised performance coaching vs subscription training apps — what each delivers, how decisions are made, and which fits which athlete.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Performance Coaching vs Training Apps | DJP Athlete",
    description:
      "Coach-supervised coaching vs subscription training apps — what each delivers and which fits which athlete.",
  },
}

interface Row {
  criterion: string
  app: string
  coach: string
  appPositive?: boolean
  coachPositive?: boolean
}

const ROWS: Row[] = [
  {
    criterion: "Programming source",
    app: "Pre-built templates assigned algorithmically. Same plans rotated across many users.",
    coach: "Built from a personal assessment. No template ever applied without modification.",
    coachPositive: true,
  },
  {
    criterion: "Decision-maker",
    app: "Algorithm. No human reviews your week before it lands.",
    coach: "Darren J Paul, PhD (CSCS, NASM, USAW Level 2). A coach who reviews your data weekly.",
    coachPositive: true,
  },
  {
    criterion: "Adjustment to your fatigue",
    app: "Limited — most apps don't change volume when wellness drops.",
    coach: "Standard practice — volume is cut, modalities swapped, or recovery sessions inserted when readiness markers fall.",
    coachPositive: true,
  },
  {
    criterion: "Video review of technique",
    app: "Rare. A few apps offer occasional human video review at higher tiers.",
    coach: "Standard. Weekly video review with frame-by-frame technique notes.",
    coachPositive: true,
  },
  {
    criterion: "Sport-specific qualities",
    app: "Generic strength + conditioning by category. Sport-specific demands rarely modeled in detail.",
    coach: "Programmed against the actual demands of the athlete's sport — tested and reassessed.",
    coachPositive: true,
  },
  {
    criterion: "Travel & competition windows",
    app: "Manual reschedules. The plan continues regardless of where you are.",
    coach: "Plan adjusts automatically to travel days, time zones, and competition windows.",
    coachPositive: true,
  },
  {
    criterion: "Post-injury / return-to-performance",
    app: "Generally not appropriate — apps cannot interpret rehab milestones or detect re-injury risk.",
    coach: "A core service line at DJP Athlete. Force-platform testing, asymmetry detection, and progression management.",
    coachPositive: true,
  },
  {
    criterion: "Accountability",
    app: "Push notification reminders.",
    coach: "Direct coach messaging. Real conversation. Weekly cadence.",
    coachPositive: true,
  },
  {
    criterion: "Cost",
    app: "$10–$80/month, depending on tier and human-coaching add-ons.",
    coach: "Higher — pricing shared after application review. The work is structurally different from an app.",
    appPositive: true,
  },
  {
    criterion: "Time investment",
    app: "Open the app, do the workout. Minimal logging.",
    coach: "Daily wellness check-ins, weekly video upload, weekly coaching call as scheduled.",
    appPositive: true,
  },
  {
    criterion: "Best fit",
    app: "Generally healthy adults wanting a structured workout plan, basic strength + conditioning, lifestyle fitness.",
    coach: "Serious athletes — competitive, return-to-performance, elite youth, high-performing professionals — where the goal is performance development, not workouts.",
  },
  {
    criterion: "Who decides if a movement is safe today",
    app: "You do. The app doesn't know your sleep, your sRPE, or that you tweaked something yesterday.",
    coach: "The coach does. Decisions are made on the data the athlete logs and the video the coach reviews.",
    coachPositive: true,
  },
]

const APPS_FAQ = [
  {
    question: "Is sports performance coaching worth it over a $30/month app?",
    answer:
      "It depends on the athlete's goal. For lifestyle fitness, an app is often enough — and is the right product. For performance development, return-to-performance after injury, or sport-specific preparation, an app is structurally not the same product as supervised coaching. Apps deliver a workout. Coaching delivers an adjusted, individualized plan with weekly video review, daily wellness-driven decisions, and direct messaging with the coach who built it. The cost difference reflects the work difference, not the brand difference.",
  },
  {
    question: "Will I get the same results from a training app as from a coach?",
    answer:
      "For general fitness goals, modern training apps can drive meaningful results. For performance goals — measurable strength, speed, power, capacity gains tied to a sport or competition — supervised coaching outperforms because programming responds to your actual data (sleep, HRV, sRPE, video review). An app cannot cut volume on the day your HRV drops 9% or substitute a movement when the coach sees a knee valgus collapse on rep 3. A coach can.",
  },
  {
    question: "Why does coach-supervised coaching cost more than apps?",
    answer:
      "Different product. Apps charge for software access; the marginal cost of one more user is near zero. Supervised coaching charges for the coach's time — a coach who reviews your video each week, reads your wellness data daily, builds and adjusts your specific program, and answers your messages directly. We do not benchmark price against apps because the work being delivered is structurally different.",
  },
  {
    question: "Can I use both a coach and a training app?",
    answer:
      "Most of our athletes do — but not for the same purpose. Apps are useful as logging tools, for cardio prescriptions, or for travel-day fallback when the gym situation is uncertain. The coaching program is the source of truth for programming and progression. We integrate with whatever tracking tools the athlete already uses (Whoop, Garmin, AppleHealth, sRPE diaries) without forcing a single platform.",
  },
  {
    question: "When is a training app the right choice?",
    answer:
      "When the athlete's goal is general fitness, weight loss, or unstructured strength training and budget is the deciding factor. When there is no injury history that requires programming care. When the athlete does not need sport-specific qualities developed. When self-discipline and consistency are the primary obstacles, not programming quality. In those cases, a quality app is the right product and we will tell you so.",
  },
]

const comparePageSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Sports Performance Coaching vs Training Apps",
  url: "https://www.darrenjpaul.com/services/coaching-vs-training-app",
  description:
    "Side-by-side comparison of coach-supervised sports performance coaching and subscription training apps. Programming source, decision-making, fatigue adjustment, sport-specific qualities, cost, and best fit by athlete type.",
  about: [
    { "@type": "Service", name: "Sports Performance Coaching" },
    { "@type": "Thing", name: "Subscription training app" },
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
  mainEntity: APPS_FAQ.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
}

export default function CoachingVsTrainingAppPage() {
  return (
    <>
      <JsonLd data={comparePageSchema} />
      <JsonLd data={compareFAQSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Services", url: "/services" },
          { name: "Coaching vs Training App", url: "/services/coaching-vs-training-app" },
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
              Sports Performance Coaching vs Training Apps.
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              An honest comparison. Apps deliver a workout. Coach-supervised coaching delivers an adjusted, individualized
              plan with weekly video review and direct coach messaging. They are different products.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Semantic Answer Block (AEO) */}
      <SemanticAnswerBlock
        eyebrow="Quick answer"
        question="What's the difference between sports performance coaching and a training app?"
        answer="A subscription training app delivers pre-built workout templates assigned algorithmically — useful for general fitness, structured strength, and lifestyle goals at $10–$80 per month. Coach-supervised sports performance coaching delivers an individualized program built from a personal assessment, adjusted weekly through video review, daily wellness data, and direct coach messaging. At DJP Athlete, the coach is Darren J Paul, PhD (CSCS, NASM, USAW Level 2). Apps cannot adjust volume when readiness markers drop, swap movements based on observed technique, or interpret return-to-performance milestones; coaching can. The cost difference reflects a difference in product, not in brand. Apps are the right choice for general fitness; coaching is the right choice for performance development and post-injury return-to-sport phases."
      />

      {/* Format-at-a-glance */}
      <section className="py-16 lg:py-20 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-6">
            <FadeIn direction="left">
              <div className="rounded-2xl border border-border bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Smartphone className="size-5 text-muted-foreground" aria-hidden />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Training App</p>
                </div>
                <h2 className="text-xl font-heading font-semibold text-primary mb-2">
                  Workouts on demand.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Algorithm-driven, template-based, $10–$80/month. Best for general fitness, structured strength, and
                  lifestyle goals where self-direction is enough.
                </p>
                <p className="text-xs text-muted-foreground italic">Examples: Future, TrainHeroic, Whoop Coach, Fitbod</p>
              </div>
            </FadeIn>

            <FadeIn direction="right">
              <div className="rounded-2xl border-2 border-accent bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <UserCheck className="size-5 text-accent" aria-hidden />
                  <p className="text-xs font-medium text-accent uppercase tracking-widest">Coach-Supervised</p>
                </div>
                <h2 className="text-xl font-heading font-semibold text-primary mb-2">
                  Programs adjusted for you.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Application-only, individualized, coach-led. Best for performance development, sport-specific
                  preparation, and return-to-performance phases.
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
                What you actually get.
              </h2>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="hidden md:block overflow-hidden rounded-2xl border border-border bg-white">
              <table className="w-full">
                <thead className="bg-primary text-primary-foreground">
                  <tr>
                    <th scope="col" className="px-6 py-4 text-left text-sm font-heading font-semibold w-1/4">
                      Criterion
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-sm font-heading font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <Smartphone className="size-4" aria-hidden /> Training App
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-sm font-heading font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <UserCheck className="size-4" aria-hidden /> Coach-Supervised (DJP Athlete)
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, i) => (
                    <tr key={row.criterion} className={i % 2 === 0 ? "bg-white" : "bg-surface/50"}>
                      <th scope="row" className="px-6 py-4 text-left text-sm font-medium text-foreground align-top">
                        {row.criterion}
                      </th>
                      <td
                        className={`px-6 py-4 text-sm leading-relaxed align-top ${
                          row.appPositive ? "bg-accent/10 text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        <span className="inline-flex gap-1.5">
                          {row.appPositive ? (
                            <Check className="size-4 text-accent shrink-0 mt-0.5" aria-hidden />
                          ) : (
                            <X className="size-4 text-muted-foreground/50 shrink-0 mt-0.5" aria-hidden />
                          )}
                          <span>{row.app}</span>
                        </span>
                      </td>
                      <td
                        className={`px-6 py-4 text-sm leading-relaxed align-top ${
                          row.coachPositive ? "bg-accent/10 text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        <span className="inline-flex gap-1.5">
                          {row.coachPositive ? (
                            <Check className="size-4 text-accent shrink-0 mt-0.5" aria-hidden />
                          ) : (
                            <X className="size-4 text-muted-foreground/50 shrink-0 mt-0.5" aria-hidden />
                          )}
                          <span>{row.coach}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked view */}
            <div className="md:hidden space-y-4">
              {ROWS.map((row) => (
                <div key={row.criterion} className="rounded-2xl border border-border bg-white p-5">
                  <p className="text-xs font-medium text-accent uppercase tracking-widest mb-3">{row.criterion}</p>
                  <div className="space-y-3">
                    <div>
                      <div className="inline-flex items-center gap-1.5 mb-1">
                        <Smartphone className="size-3.5 text-muted-foreground" aria-hidden />
                        <span className="text-xs font-semibold text-primary">Training App</span>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{row.app}</p>
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-1.5 mb-1">
                        <UserCheck className="size-3.5 text-accent" aria-hidden />
                        <span className="text-xs font-semibold text-primary">Coach-Supervised</span>
                      </div>
                      <p className={`text-sm leading-relaxed ${row.coachPositive ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {row.coach}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* When apps are right */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="text-center mb-10">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">Honest take</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                When a training app is the right call.
              </h2>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <ul className="space-y-3 text-base text-muted-foreground leading-relaxed">
              {[
                "The goal is general fitness, weight management, or unstructured strength training.",
                "Budget is the deciding factor and a $10–$80/month tier fits.",
                "There is no injury history requiring programming care or rehab integration.",
                "Sport-specific qualities (e.g., reactive strength, repeated-sprint capacity) are not the focus.",
                "Self-discipline is the primary gap, not programming quality.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check className="size-5 text-accent shrink-0 mt-0.5" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-muted-foreground italic">
              In any of the above cases, an app is the right product and we&apos;ll tell you so.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
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
            {APPS_FAQ.map((faq, i) => (
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

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <FadeIn>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold tracking-tight mb-4">
              Coaching is for serious athletes. If that&apos;s you, apply.
            </h2>
            <p className="text-lg text-primary-foreground/80 leading-relaxed mb-8">
              The application asks the questions we use to determine fit. If a training app is the better product for
              your situation, we&apos;ll say so directly.
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
                href="/services/online-vs-in-person"
                className="inline-flex items-center gap-2 border border-primary-foreground/30 text-primary-foreground px-8 py-4 rounded-full text-sm font-medium hover:bg-primary-foreground/5 transition-all"
              >
                Compare online vs in-person
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
