import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { ArrowRight, Dumbbell, Activity, Monitor, Mail, ChevronRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { HeroContent } from "@/components/public/HeroContent"
import { AnimatedStats } from "@/components/public/AnimatedStats"
import { TestimonialCarousel } from "@/components/public/TestimonialCarousel"
import { GoogleReviewThemes } from "@/components/public/GoogleReviewThemes"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { NewsletterForm } from "@/components/public/NewsletterForm"
import { GoogleReviewsBadge } from "@/components/public/GoogleReviewsBadge"
import { TrustStrip } from "@/components/public/TrustStrip"
import { getFeaturedTestimonials } from "@/lib/db/testimonials"
import { BUSINESS_INFO, GOOGLE_MAPS_URL, postalAddressSchema } from "@/lib/business-info"

export const revalidate = 3600 // revalidate every hour

export const metadata: Metadata = {
  title: { absolute: "Sports Performance Training for Elite Athletes | DJP Athlete" },
  description:
    "Sports performance training by Darren J Paul, PhD. In-person training (Tampa Bay, FL), online training, and return-to-performance testing for serious athletes. Strength training, speed training, and sport-specific training.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sports Performance Training for Elite Athletes | DJP Athlete",
    description:
      "Sports performance training by Darren J Paul, PhD. In-person training (Tampa Bay, FL), online training, and return-to-performance testing for serious athletes.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Performance Training for Elite Athletes | DJP Athlete",
    description:
      "Sports performance training by Darren J Paul, PhD. In-person (Tampa Bay), online training, and return-to-performance testing for serious athletes.",
  },
}

const SAME_AS = [
  "https://www.linkedin.com/in/darren-paul-phd-b022a213b",
  "https://www.instagram.com/darrenjpaul/",
  "https://www.tiktok.com/@darrenpaul_coach",
  "https://www.facebook.com/share/1BwzDFUg66/?mibextid=wwXIfr",
]

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  // @id matches the worksFor target shape used by other schemas — keeping the
  // organization entity addressable for cross-schema references.
  "@id": "https://www.darrenjpaul.com/#organization",
  name: BUSINESS_INFO.brand,
  legalName: BUSINESS_INFO.legalName,
  // Same alternateName set as LocalBusiness so the brand, founder, and
  // domain queries all resolve to the same organization entity.
  alternateName: [
    BUSINESS_INFO.legalName,
    "Darren J Paul",
    "Darren J Paul Athlete",
    "darrenjpaul.com",
  ],
  url: "https://www.darrenjpaul.com",
  logo: "https://www.darrenjpaul.com/logos/logo-dark.png",
  description:
    "DJP Athlete provides sports performance coaching by Darren J Paul. Elite athlete coaching, elite sports performance training, athletic performance coach services, and performance coaching for athletes — in-person training, online coaching, and return-to-performance assessment for serious athletes.",
  address: postalAddressSchema,
  areaServed: BUSINESS_INFO.serviceAreas.map((name) => ({ "@type": "Place", name })),
  // GBP URL included alongside the social profiles so the Organization entity
  // also binds to the verified Google Business Profile in the knowledge graph.
  sameAs: [...SAME_AS, GOOGLE_MAPS_URL],
}

// LocalBusiness — drives Google Business Profile / Map Pack visibility for local searches
// like "sports performance coach Zephyrhills" or "athletic performance coach Tampa".
const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "SportsActivityLocation",
  "@id": "https://www.darrenjpaul.com/#localbusiness",
  name: BUSINESS_INFO.legalName,
  // Multiple alternate names so Google resolves brand, founder, and domain
  // searches all to this LocalBusiness. Without "Darren J Paul" here, the
  // GBP only shows up for the full legal-name search; with it, the entity
  // also binds to the personal-brand and domain queries the boss actually
  // sees most.
  alternateName: [
    BUSINESS_INFO.brand,
    "Darren J Paul",
    "Darren J Paul Athlete",
    "darrenjpaul.com",
  ],
  url: "https://www.darrenjpaul.com",
  image: "https://www.darrenjpaul.com/images/gym-training-01.jpg",
  address: postalAddressSchema,
  hasMap: GOOGLE_MAPS_URL,
  identifier: {
    "@type": "PropertyValue",
    propertyID: "googlePlaceId",
    value: BUSINESS_INFO.googlePlaceId,
  },
  priceRange: "$$$",
  areaServed: BUSINESS_INFO.serviceAreas.map((name) => ({ "@type": "Place", name })),
  sameAs: [...SAME_AS, GOOGLE_MAPS_URL],
}

const webSiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "DJP Athlete",
  url: "https://www.darrenjpaul.com",
}

const services = [
  {
    icon: Dumbbell,
    title: "Training",
    subtitle: "In-Person Performance Coaching",
    description:
      "Advanced assessment-led coaching with individualized programming. Every decision is diagnostic-driven. Every session has intent.",
    href: "/in-person",
  },
  {
    icon: Activity,
    title: "Testing",
    subtitle: "Return-to-Performance Testing",
    description:
      "A structured rebuild process for athletes beyond rehab. Restore capacity. Reintegrate speed and power. Return to dominance with confidence.",
    href: "/assessment",
  },
  {
    icon: Monitor,
    title: "Coaching",
    subtitle: "Online Performance Coaching",
    description:
      "High-touch performance support built on individualized data, structured progressions, and ongoing oversight. No templates. No generic plans.",
    href: "/online",
  },
]

const fallbackTestimonials: {
  name: string
  title: string
  quote: string
  avatarUrl: string | null
  rating: number
}[] = [
  {
    name: "Abigail Rencheli",
    title: "WTA Professional Tennis Player",
    quote:
      "What sets him apart is how much he genuinely cares about you as a person first. The Online Program is so easy to navigate and thoroughly explains how to perform the exercises.",
    avatarUrl: null,
    rating: 5,
  },
  {
    name: "Ganna Poznikhierenko",
    title: "WTA Professional Tennis Player",
    quote:
      "He's truly the best coach I've ever worked with. The Online Program helps me stay connected even though I am training independently.",
    avatarUrl: null,
    rating: 5,
  },
  {
    name: "Tina Pisnik",
    title: "Professional Pickleball Player",
    quote:
      "Darren understands performance & injury prevention at a very high level. The Online program is seamless and allows me to train from anywhere.",
    avatarUrl: null,
    rating: 5,
  },
]

const stats = [
  { value: "20+", label: "Years Experience" },
  { value: "500+", label: "Athletes Coached" },
  { value: "15+", label: "Sports Covered" },
  { value: "3", label: "Continents" },
]

export default async function HomePage() {
  let testimonials = fallbackTestimonials
  try {
    const dbTestimonials = await getFeaturedTestimonials()
    if (dbTestimonials.length > 0) {
      testimonials = dbTestimonials.map((t) => ({
        name: t.name,
        title: [t.role, t.sport].filter(Boolean).join(" · "),
        quote: t.quote,
        avatarUrl: t.avatar_url,
        rating: t.rating ?? 5,
      }))
    }
  } catch {
    // Fall back to hardcoded testimonials if DB fetch fails
  }

  return (
    <>
      <JsonLd data={organizationSchema} />
      <JsonLd data={localBusinessSchema} />
      <JsonLd data={webSiteSchema} />

      {/* ─── Hero Section ─── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-primary" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_20%_60%,_rgba(196,155,122,0.1),_transparent)]" />

        {/* Coach photo (left half on desktop) */}
        <div className="absolute inset-y-0 left-0 w-full lg:w-[45%]">
          <Image
            src="/images/professionalheadshot.jpg"
            alt="Darren J Paul — Performance Coach"
            width={1067}
            height={1600}
            priority
            sizes="(max-width: 1024px) 100vw, 45vw"
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
          {/* Gradient fade from image into content area */}
          <div className="absolute inset-y-0 right-0 w-2/3 bg-gradient-to-r from-transparent to-primary hidden lg:block" />
          {/* Bottom fade */}
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-primary to-transparent hidden lg:block" />
          {/* Mobile: overlay so text is readable */}
          <div className="absolute inset-0 bg-primary/60 lg:hidden" />
        </div>

        {/* Animated hero content + scroll indicator */}
        <HeroContent />

        {/* Bottom accent line */}
        <div className="absolute bottom-0 left-0 right-0">
          <div className="h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        </div>
      </section>

      {/* ─── Stats Bar (Animated Counter) ─── */}
      <AnimatedStats stats={stats} />

      {/* ─── AEO answer block — extractable "what is sports performance coaching"
            Visually hidden via sr-only (boss wants less on-screen noise) but kept in
            the DOM and accessibility tree so Google AI Overviews and LLM crawlers
            can still extract it. ─── */}
      <div className="sr-only" aria-hidden="false">
        <SemanticAnswerBlock
          eyebrow="In short"
          question="What is sports performance training?"
          answer="Sports performance training is the structured development of how an athlete moves, produces force, and recovers, built around a specific sport rather than general fitness. Unlike a personal trainer, a sports performance coach starts with diagnostics (testing speed, strength, power, movement quality and readiness), then designs an individualized training program, monitors training load, coaches technique, and adjusts in real time as the athlete adapts. At DJP Athlete, this is delivered by Darren J Paul, PhD (CSCS, NASM), who has coached 500+ athletes across 15+ sports including WTA professionals. Three formats are available: in-person training at the Zephyrhills, Florida facility in the Tampa Bay area; online training with individualized programming and video feedback for athletes anywhere; and return-to-performance testing for athletes coming back from injury. Every decision is diagnostic-driven and individualized: systems over exercises, patterns over shortcuts."
        />
      </div>

      {/* ─── Services Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-16">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">What We Do</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight">
              Training &mdash; Testing &mdash; Coaching
            </h2>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8">
            {services.map((service, i) => {
              const Icon = service.icon
              return (
                <FadeIn key={service.title} delay={i * 0.12}>
                  <Link
                    href={service.href}
                    className="group relative block bg-white rounded-2xl border border-border p-8 hover:shadow-lg transition-all duration-300 overflow-hidden h-full"
                  >
                    {/* Hover accent line */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />

                    <div className="flex size-14 items-center justify-center rounded-xl bg-primary/10 mb-6 group-hover:bg-accent/15 transition-colors">
                      <Icon className="size-7 text-primary group-hover:text-accent transition-colors" />
                    </div>
                    <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-2">{service.title}</p>
                    <h3 className="text-xl font-heading font-semibold text-primary mb-3">{service.subtitle}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-6">{service.description}</p>
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-primary group-hover:text-accent transition-colors">
                      Learn more
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </Link>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── About Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-12 lg:gap-16 items-start">
            {/* Coach photo */}
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="relative">
                <div className="aspect-[3/4] rounded-2xl overflow-hidden">
                  <Image
                    src="/images/professionalheadshot.jpg"
                    alt="Darren J Paul"
                    width={1067}
                    height={1600}
                    sizes="(max-width: 1024px) 100vw, 40vw"
                    className="h-full w-full object-cover object-top"
                  />
                </div>
                {/* Decorative accent block */}
                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-accent/20 rounded-2xl -z-10" />
              </div>
            </FadeIn>

            {/* Bio copy */}
            <FadeIn delay={0.15} className="lg:col-span-3">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px w-12 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">About Me</p>
              </div>
              <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight mb-8">
                Darren J Paul
              </h2>

              <div className="space-y-5">
                <p className="text-lg text-foreground font-medium leading-relaxed">
                  I&apos;m a performance strategist, coach, researcher, and advisor.
                </p>
                <p className="text-base text-muted-foreground leading-relaxed">
                  I&apos;ve spent over two decades working inside high-performance environments, studying how athletes
                  adapt, how they break down, and why most systems fail them at critical moments.
                </p>
                <p className="text-base text-muted-foreground leading-relaxed">
                  I think in systems, not exercises. I look for patterns, not shortcuts. I question assumptions that are
                  widely accepted but rarely examined. I use lateral thinking to connect the dots between performance,
                  injury, behaviour, load, movement, and context.
                </p>
                <p className="text-base text-muted-foreground leading-relaxed">
                  I don&apos;t chase fatigue. I don&apos;t chase trends. I don&apos;t sell certainty where none exists.
                  I build structure. I manage risk. I help athletes develop capacity they can trust.
                </p>
                <p className="text-lg text-foreground font-medium leading-relaxed">
                  That&apos;s the work. Everything else is just delivery.
                </p>
              </div>

              <Link
                href="/contact"
                className="inline-flex items-center gap-2 mt-8 text-sm font-medium text-primary hover:text-accent transition-colors group"
              >
                Work with me
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ─── Testimonials Section (Carousel) ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Testimonials</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight mb-8">
              Trusted by elite athletes.
            </h2>

            {/* E-E-A-T trust block: Google Reviews badge stays visible.
                Credentials strip (PhD, CSCS · NASM, 500+ athletes, location,
                response time) is kept in the DOM via sr-only — preserves E-E-A-T
                signals for crawlers/LLMs while removing the on-screen "noise"
                the boss flagged. ─── */}
            <div className="flex flex-col items-center gap-6">
              <GoogleReviewsBadge />
              <div className="sr-only" aria-hidden="false">
                <TrustStrip variant="compact" />
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <TestimonialCarousel testimonials={testimonials} />
          </FadeIn>
        </div>
      </section>

      {/* ─── Google review themes — customer-validated keywords.
            Hidden visually (boss wants less on-screen noise) but kept in the DOM
            so the keyword chips still register as on-page entities for SEO/AEO. ─── */}
      <div className="sr-only" aria-hidden="false">
        <GoogleReviewThemes className="bg-surface" />
      </div>

      {/* ─── FAQ (managed via CMS) — renders only when published FAQs exist for the home page ─── */}
      <ManagedFaqSection
        pageKey="home"
        variant="cards"
        eyebrow="Common questions"
        title="Frequently asked questions."
      />

      {/* ─── CTA Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8 bg-surface">
        <FadeIn className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight mb-4">
            Ready to elevate your performance?
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed mb-10">
            Whether you&apos;re recovering from injury, training for competition, or seeking a higher standard of
            coaching — the first step is a conversation.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/contact"
              className="inline-flex items-center gap-3 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-lg group"
            >
              Book Free Consultation
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-accent transition-colors group"
            >
              Read the journal
              <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </FadeIn>
      </section>

      {/* ─── Newsletter Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8 bg-primary">
        <FadeIn className="max-w-2xl mx-auto text-center">
          <Mail className="size-10 text-accent mx-auto mb-6" />
          <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary-foreground tracking-tight mb-4">
            Stay in the loop.
          </h2>
          <p className="text-primary-foreground/70 leading-relaxed mb-8">
            Get insights on performance, training philosophy, and program updates. No spam. No fluff. Just the work.
          </p>
          <NewsletterForm />
          <p className="text-xs text-primary-foreground/40 mt-4">We respect your privacy. Unsubscribe at any time.</p>
        </FadeIn>
      </section>
    </>
  )
}
