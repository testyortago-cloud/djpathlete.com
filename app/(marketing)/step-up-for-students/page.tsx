import type { Metadata } from "next"
import {
  ArrowRight,
  BarChart3,
  Dumbbell,
  MonitorSmartphone,
  Zap,
  Tent,
  GraduationCap,
  Home,
  Trophy,
  Accessibility,
  TrendingUp,
  RefreshCcw,
  Wallet,
  BadgeCheck,
  CheckCircle2,
  Phone,
  ShieldCheck,
} from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { FadeIn } from "@/components/shared/FadeIn"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { StepUpInquiryForm } from "@/components/public/StepUpInquiryForm"

export const metadata: Metadata = {
  title: "Step Up For Students Approved Provider | Sports Performance Training",
  description:
    "Use your Step Up For Students scholarship (FES-EO, FES-UA, FTC, PEP) for sports performance training, athletic assessments, agility clinics, and performance camps with Darren J Paul, PhD. Approved provider serving Tampa Bay, FL.",
  alternates: { canonical: "/step-up-for-students" },
  openGraph: {
    title: "Step Up For Students Approved Provider | DJP Athlete",
    description:
      "Eligible Florida families can direct Step Up scholarship funds toward sports performance training, assessments, agility clinics, and camps with Darren J Paul, PhD.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Step Up For Students Approved Provider | DJP Athlete",
    description:
      "Use FES-EO, FES-UA, FTC, or PEP scholarship funds for sports performance training with Darren J Paul, PhD — Tampa Bay, FL.",
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
  serviceType: "Sports Performance Training — Step Up For Students Approved Provider",
  areaServed: "Tampa Bay, Florida",
  description:
    "Sports performance training, athletic assessments, agility clinics, and performance camps that eligible Florida families can fund through Step Up For Students scholarships (FES-EO, FES-UA, FTC, PEP). Delivered by Darren J Paul, PhD (CSCS, NASM) in the Tampa Bay area and online across Florida.",
  url: "https://www.darrenjpaul.com/step-up-for-students",
}

const heroStats = [
  { num: "20+", label: "Years Experience" },
  { num: "500+", label: "Athletes Coached" },
  { num: "PhD", label: "CSCS · NASM Certified" },
  { num: "4", label: "Scholarship Programs Accepted" },
]

const sufsCards = [
  {
    icon: Wallet,
    tag: "How Funds Work",
    title: "Education Savings Account",
    body: "Scholarship funds are deposited into your child's account each quarter. You direct those funds to approved providers — like DJP Athlete — through the EMA portal. Providers can receive direct payment, so families typically pay nothing upfront.",
  },
  {
    icon: Dumbbell,
    tag: "Physical Education",
    title: "Sports Training Is Covered",
    body: "Under Step Up's Physical Education (P.E.) category, scholarship funds can be used for sports lessons, training fees, and athletic equipment. Sports performance training, agility, and assessments all qualify.",
  },
  {
    icon: BadgeCheck,
    tag: "Already Approved",
    title: "DJP Athlete Is Listed in EMA",
    body: "You don't need to navigate the approval process alone. DJP Athlete is an approved provider — once you confirm your scholarship type, we handle the rest, including EMA billing.",
  },
]

const scholarships = [
  {
    name: "FES-EO",
    full: "Family Empowerment Scholarship — Educational Options",
    who: "Private school students in Florida grades K–12. One of the most widely held scholarships — families often have funds remaining after tuition.",
    coverage: "Sports training, assessments, agility, camps",
  },
  {
    name: "FES-UA",
    full: "Family Empowerment Scholarship — Unique Abilities",
    who: "Students ages 3–21 with a qualifying disability or active IEP. The most flexible scholarship, with the highest annual funding.",
    coverage: "All services + specialized summer programs",
  },
  {
    name: "PEP",
    full: "Personalized Education Program",
    who: "Homeschool and microschool families in Florida — a segment that actively needs structured PE providers and trains year-round.",
    coverage: "Sports training, PE programs, agility, camps",
  },
  {
    name: "FTC",
    full: "Florida Tax Credit Scholarship",
    who: "Income-based scholarship for K–12 private school students. Funds can be used for P.E. and educational enrichment beyond tuition.",
    coverage: "Sports lessons, training fees, equipment",
  },
]

const services = [
  {
    icon: BarChart3,
    title: "Athletic Performance Assessment",
    body: "Comprehensive diagnostic testing — speed, power, agility, movement quality, and readiness. Every program begins here. Data-driven, not guesswork.",
    tag: "PE Eligible",
  },
  {
    icon: Dumbbell,
    title: "In-Person Performance Training",
    body: "Individualized, assessment-led training at our Zephyrhills, FL facility in the Tampa Bay area. Built around your athlete's sport, position, and goals.",
    tag: "PE Eligible",
  },
  {
    icon: MonitorSmartphone,
    title: "Online Performance Program",
    body: "High-touch remote programming for athletes anywhere in Florida — individualized plans, video analysis, and ongoing coaching through the app. Not generic templates.",
    tag: "PE Eligible · structured instruction",
  },
  {
    icon: Zap,
    title: "Agility Clinic",
    body: "Sport-specific agility and change-of-direction training in a clinic format. Group and semi-private options, run in blocks aligned to each funding quarter.",
    tag: "PE / Electives Eligible",
  },
  {
    icon: Tent,
    title: "Performance Camps",
    body: "Intensive multi-day training covering speed, strength, agility, and sport-specific movement. FES-UA families may also qualify under Specialized Summer Programs.",
    tag: "PE / Summer Programs",
  },
  {
    icon: GraduationCap,
    title: "Homeschool PE Program",
    body: "Structured athletic development for homeschool athletes — fulfils physical education requirements while building real athletic capacity. Year-round enrollment.",
    tag: "PE Eligible · PEP Families",
  },
]

const audiences = [
  {
    icon: Home,
    title: "Homeschool Athletes",
    body: "PEP families who need structured PE, a social training environment, and real athletic development year-round.",
  },
  {
    icon: Trophy,
    title: "Youth Sport Athletes",
    body: "Travel, club, and rec athletes ages 8–18 looking for the edge that team practice doesn't provide.",
  },
  {
    icon: GraduationCap,
    title: "Private School Students",
    body: "FES-EO / FTC families with scholarship funds remaining after tuition, ready to put them to work.",
  },
  {
    icon: Accessibility,
    title: "Unique Abilities Athletes",
    body: "FES-UA students who benefit from structured, adaptive athletic development — movement, confidence, and physical competence.",
  },
  {
    icon: TrendingUp,
    title: "Performance-Focused Athletes",
    body: "Athletes who want measurable results: speed, power output, agility scores, and documented progress reports.",
  },
  {
    icon: RefreshCcw,
    title: "Return-to-Sport Athletes",
    body: "Athletes coming back from injury who need a structured, science-based return-to-performance pathway before competing again.",
  },
]

const packages = [
  {
    badge: "Entry Point · One-Time",
    title: "Athletic Performance Assessment",
    desc: "The diagnostic foundation. Understand exactly where your athlete is — and where they need to go — before committing to a program.",
    items: [
      "Speed & acceleration testing (10/40-yard)",
      "Vertical jump & power output",
      "Agility & change-of-direction testing",
      "Movement quality & mobility screen",
      "Personalized performance report",
      "30-min parent consultation",
    ],
    cta: "Book Assessment",
    featured: false,
  },
  {
    badge: "★ Most Popular",
    title: "Hybrid Performance Package",
    desc: "A hybrid of in-person sessions, small-group training, and online app-based programming — built around your athlete's goals, sport, and competition schedule. Aligns with quarterly scholarship disbursements.",
    items: [
      "In-person performance sessions",
      "Small-group training",
      "Online app-based sessions & programming",
      "Individualized program design",
      "Monthly progress re-testing",
      "Parent progress updates",
      "Direct EMA billing available",
    ],
    cta: "Get Started",
    featured: true,
  },
  {
    badge: "Clinic · Aligned to Funding Quarter",
    title: "Agility Clinic",
    desc: "A structured agility clinic to develop speed, reaction, and movement confidence — run in blocks that line up with each scholarship disbursement.",
    items: [
      "Pre- and post-clinic agility testing",
      "Sport-specific change-of-direction drills",
      "Reaction & decision-making work",
      "Runs as a clinic aligned to each funding quarter",
      "Small-group or individual format",
    ],
    cta: "Enquire",
    featured: false,
  },
  {
    badge: "Homeschool · Year-Round",
    title: "Homeschool Athlete PE Program",
    desc: "Structured athletic development designed specifically for homeschool families. Fulfils PE requirements with measurable, documented progress.",
    items: [
      "Weekly structured training sessions",
      "PE-standard documentation & reporting",
      "Athletic skill progression tracking",
      "Year-round enrollment available",
      "Social group training environment",
      "PEP scholarship-aligned billing",
    ],
    cta: "Book a Spot",
    featured: false,
  },
]

const steps = [
  {
    num: "01",
    title: "Confirm Your Scholarship Eligibility",
    body: "Log into your EMA portal or contact Step Up For Students at (877) 735-7837 to confirm your child's active scholarship and available balance, and check which quarter funds are available.",
    note: {
      lead: "Which scholarships work?",
      rest: "FES-EO, FES-UA, FTC, and PEP all cover Physical Education (sports training). If your child holds any of these, you're eligible.",
    },
  },
  {
    num: "02",
    title: "Book a Free Step Up Consultation",
    body: "Tell us about your athlete's goals, sport, and needs. We'll confirm which services apply to your scholarship type, walk you through the options, and answer any questions before anything is booked or billed.",
    note: {
      lead: "No commitment required.",
      rest: "The consultation is free. We make sure it's the right fit before any funds are directed.",
    },
  },
  {
    num: "03",
    title: "Select Your Package — We Handle the EMA Billing",
    body: "Choose the package that fits your athlete. For direct payment through EMA we submit our service offering through the portal and you approve it — no cash changes hands. Families can also pay out of pocket and submit a reimbursement request.",
    note: {
      lead: "Quarterly timing matters.",
      rest: "Funds drop in August, November, February, and April. We'll structure packages around those dates to maximise your available balance.",
    },
  },
  {
    num: "04",
    title: "Training Begins — Results Are Documented",
    body: "Training starts on schedule. Every athlete is tested at intake and re-tested regularly so progress is measurable and documented — not just felt. Parents receive regular updates, and formal PE reporting is available for homeschool families on request.",
    note: null,
  },
]

const eyebrowLeft = (label: string) => (
  <div className="flex items-center gap-3 mb-4">
    <div className="h-px w-8 bg-accent" />
    <p className="text-sm font-medium text-accent uppercase tracking-widest">{label}</p>
  </div>
)

export default function StepUpForStudentsPage() {
  return (
    <>
      <JsonLd data={serviceSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Step Up For Students", url: "/step-up-for-students" },
        ]}
      />

      {/* Approved-provider announcement banner */}
      <div className="bg-accent/10 border-b border-accent/20 px-4 py-3 text-center">
        <p className="text-sm font-medium text-primary">
          <span className="font-semibold">Approved provider:</span> eligible families can direct Step Up For Students
          scholarship funds toward sports performance training.
        </p>
      </div>

      {/* Hero */}
      <section className="relative bg-primary px-4 sm:px-8 pt-24 pb-20 lg:pt-32 lg:pb-28 overflow-hidden">
        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-success/40 bg-success/10 px-4 py-2 text-sm font-medium text-success mb-8">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Official Step Up For Students Approved Provider
          </div>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-heading font-semibold text-white tracking-tight leading-[1.05] mb-6">
            Use Your Step Up Scholarship for <span className="text-accent">Sports Performance</span> Training.
          </h1>
          <p className="text-lg sm:text-xl text-white/80 max-w-2xl leading-relaxed mb-10">
            Eligible families on FES-EO, FES-UA, FTC, and PEP scholarships can direct funds toward athletic assessments,
            in-person and online training, agility clinics, and performance camps with Darren J Paul, PhD — at no
            out-of-pocket cost.
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href="#apply"
              className="group inline-flex items-center gap-2 bg-accent text-primary px-8 py-4 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all hover:shadow-md"
            >
              Book a Free Consultation
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 border border-white/30 text-white px-8 py-4 rounded-full text-sm font-semibold hover:border-white/70 transition-colors"
            >
              See How It Works
            </a>
          </div>

          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-8 border-t border-white/15 pt-10">
            {heroStats.map((s) => (
              <div key={s.label}>
                <div className="text-2xl sm:text-3xl font-heading font-bold text-white">{s.num}</div>
                <div className="text-xs sm:text-sm text-white/60 mt-1 leading-snug">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What is Step Up For Students */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            {eyebrowLeft("Program Overview")}
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-semibold text-primary tracking-tight mb-5">
              What Is Step Up For Students?
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
              Step Up For Students is a Florida state-approved nonprofit that administers education-choice scholarship
              programs for PreK–12 students. These programs work like education savings accounts — families receive
              funds that can be directed toward approved educational expenses, including physical education, sports
              lessons, and athletic development.
            </p>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
              Over 200,000 Florida students currently participate. If your child holds an active scholarship, you may be
              able to use those funds directly with DJP Athlete — with no money out of your pocket.
            </p>
          </FadeIn>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {sufsCards.map((card, i) => {
              const Icon = card.icon
              return (
                <FadeIn key={card.title} delay={i * 0.08} direction="up">
                  <div className="h-full bg-white rounded-2xl border border-border p-6 sm:p-7">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 mb-4">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-accent mb-2">{card.tag}</p>
                    <h3 className="text-lg font-semibold text-primary mb-2">{card.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{card.body}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* Eligibility */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            {eyebrowLeft("Eligibility")}
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-semibold text-primary tracking-tight mb-5">
              Which Scholarships Qualify?
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
              All four major Step Up For Students scholarship programs cover Physical Education expenses — including
              sports performance training, assessments, agility, and camps. If your child holds any of the scholarships
              below, they&apos;re eligible.
            </p>
          </FadeIn>

          <div className="mt-12 grid sm:grid-cols-2 gap-5">
            {scholarships.map((s, i) => (
              <FadeIn key={s.name} delay={i * 0.08} direction="up">
                <div className="h-full bg-white rounded-2xl border border-border p-6 sm:p-7">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-xl font-heading font-bold text-primary">{s.name}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.full}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-4">{s.who}</p>
                  <p className="mt-4 inline-flex items-start gap-2 text-sm font-medium text-success">
                    <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                    {s.coverage}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>

          {/* Single soft funding note (replaces per-scholarship dollar figures) */}
          <FadeIn delay={0.1}>
            <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-6 sm:p-7">
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                <span className="font-semibold text-primary">How much funding do families have?</span> It varies by
                scholarship type and family — annual awards typically range from several thousand dollars up to $10,000+
                for the most flexible scholarships, and many families have funds left after tuition. During your free
                consultation we&apos;ll review your child&apos;s actual available balance and build a plan that fits it.
              </p>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Not sure which scholarship your child holds? Check your EMA portal or contact Step Up For Students at{" "}
                <span className="font-medium text-primary">(877) 735-7837</span> — then reach out and we&apos;ll confirm
                eligibility with you before your first session.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Proof strip */}
      <section className="py-14 px-4 sm:px-8 bg-primary">
        <div className="max-w-5xl mx-auto flex flex-col lg:flex-row items-center gap-10">
          <blockquote className="flex-1 min-w-0">
            <p className="text-lg sm:text-xl italic text-white leading-relaxed">
              &ldquo;He initiates a unique approach to his work and the training he provides, which complements what I do
              and makes me feel right at home as I train towards performance.&rdquo;
            </p>
            <cite className="block mt-4 not-italic text-sm font-medium text-white/60">
              — Wayde van Niekerk, 400m World Record Holder
            </cite>
          </blockquote>
          <div className="flex gap-8 sm:gap-10 shrink-0">
            {[
              { num: "5.0", label: "Google Rating" },
              { num: "49", label: "Verified Reviews" },
              { num: "15+", label: "Sports Covered" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-heading font-bold text-accent leading-none">{s.num}</div>
                <div className="text-xs text-white/60 mt-2">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What your scholarship covers — Services */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            {eyebrowLeft("Covered Services")}
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-semibold text-primary tracking-tight mb-5">
              What Your Scholarship Covers With DJP Athlete
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
              Every service below falls under the Physical Education or Electives category recognized by Step Up For
              Students. Eligible families can direct scholarship funds toward any of the following.
            </p>
          </FadeIn>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map((service, i) => {
              const Icon = service.icon
              return (
                <FadeIn key={service.title} delay={i * 0.06} direction="up">
                  <div className="group relative h-full overflow-hidden bg-white rounded-2xl border border-border p-6 hover:shadow-md transition-shadow">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                    <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 mb-4">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <h3 className="text-base font-semibold text-primary mb-2">{service.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{service.body}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-success/25 bg-success/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-success">
                      <CheckCircle2 className="size-3" />
                      {service.tag}
                    </span>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            {eyebrowLeft("Who It's For")}
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-semibold text-primary tracking-tight mb-5">
              Built for Scholarship Athletes at Every Level
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
              You don&apos;t have to be a Division I recruit to train like one. DJP Athlete works with athletes across
              every stage — from youth athletes building a foundation to competitors chasing their next level.
            </p>
          </FadeIn>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {audiences.map((a, i) => {
              const Icon = a.icon
              return (
                <FadeIn key={a.title} delay={i * 0.06} direction="up">
                  <div className="h-full bg-white rounded-2xl border border-border p-6 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                      <Icon className="size-6 text-primary" />
                    </div>
                    <h3 className="text-base font-semibold text-primary mb-2">{a.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{a.body}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* Packages */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            {eyebrowLeft("Scholarship-Ready Packages")}
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-semibold text-primary tracking-tight mb-5">
              Packages Designed for Step Up Families
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
              Every package is structured to align with Step Up&apos;s quarterly funding cycle and can be billed directly
              through the EMA portal — no out-of-pocket payment required for eligible families.
            </p>
          </FadeIn>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {packages.map((pkg, i) => (
              <FadeIn key={pkg.title} delay={i * 0.06} direction="up">
                <div
                  className={`flex h-full flex-col rounded-2xl border p-6 ${
                    pkg.featured ? "border-accent bg-accent/5 shadow-sm" : "border-border bg-white"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-accent mb-3">{pkg.badge}</p>
                  <h3 className="text-lg font-semibold text-primary mb-2">{pkg.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-5">{pkg.desc}</p>
                  <ul className="space-y-2.5 flex-1">
                    {pkg.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <ArrowRight className="size-4 mt-0.5 shrink-0 text-accent" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href="#apply"
                    className={`mt-6 block rounded-full px-5 py-3 text-center text-sm font-semibold transition-all ${
                      pkg.featured
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border border-border text-primary hover:border-accent hover:text-accent"
                    }`}
                  >
                    {pkg.cta}
                  </a>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface" id="how-it-works">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            {eyebrowLeft("The Process")}
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-semibold text-primary tracking-tight mb-5">
              How to Use Your Scholarship — Step by Step
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
              Most families don&apos;t know this is possible. The ones who figure it out win. Here&apos;s exactly how the
              process works — simplified so there&apos;s no confusion.
            </p>
          </FadeIn>

          <div className="mt-12 space-y-10">
            {steps.map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.08} direction="up">
                <div className="flex gap-5">
                  <div className="text-3xl font-heading font-bold text-accent/40 leading-none shrink-0 w-12">
                    {step.num}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-primary mb-2">{step.title}</h3>
                    <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{step.body}</p>
                    {step.note && (
                      <div className="mt-4 rounded-xl border border-border bg-white p-4 text-sm text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-primary">{step.note.lead}</span> {step.note.rest}
                      </div>
                    )}
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ — CMS-managed. Edit at /admin/marketing/faqs → "Step Up For Students".
          Renders nothing + emits FAQPage/speakable JSON-LD only when published
          FAQs exist for this page key. */}
      <ManagedFaqSection
        pageKey="step-up-for-students"
        variant="cards"
        eyebrow="FAQ"
        title="Common Questions From Scholarship Families"
      />

      {/* Apply / Contact */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface" id="apply">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-12">
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="lg:sticky lg:top-32">
                {eyebrowLeft("Book Your Consultation")}
                <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                  Ready to Use Your Scholarship? Let&apos;s Talk.
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Book a free Step Up For Students consultation. We&apos;ll confirm your eligibility, walk you through the
                  right package for your athlete, and handle the EMA process from there.
                </p>
                <div className="space-y-3">
                  <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="size-4 text-accent shrink-0" />
                    Step Up For Students: (877) 735-7837
                  </p>
                  <p className="inline-flex items-start gap-2 text-sm text-muted-foreground">
                    <ShieldCheck className="size-4 text-accent mt-0.5 shrink-0" />
                    No obligation and no upfront payment for eligible families.
                  </p>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.15} className="lg:col-span-3">
              <div className="bg-white rounded-2xl border border-border p-6 sm:p-8">
                <StepUpInquiryForm />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Compliance note */}
      <section className="px-4 sm:px-8 pb-16">
        <div className="max-w-5xl mx-auto rounded-2xl border border-border bg-white p-6">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-primary">DJP Athlete</span> — Darren J Paul, PhD · CSCS · NASM · 6585
            Simons Rd, Zephyrhills, FL 33541 · Tampa Bay Area. Approved Step Up For Students service provider. Eligible
            families may use FES-EO, FES-UA, FTC, or PEP scholarship funds for approved sports performance, physical
            education, and athletic development services. Confirm eligibility and coverage details with Step Up For
            Students before booking.
          </p>
        </div>
      </section>
    </>
  )
}
