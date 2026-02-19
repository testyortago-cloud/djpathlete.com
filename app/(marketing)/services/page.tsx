import type { Metadata } from "next"
import {
  ClipboardList,
  BarChart3,
  Video,
  Apple,
  Dumbbell,
  Heart,
  ArrowRight,
  CheckCircle,
} from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { PricingSection } from "@/components/PricingSection"

export const metadata: Metadata = {
  title: "Services",
  description:
    "Explore DJP Athlete's coaching services: personalized training plans, performance tracking, video analysis, nutrition coaching, strength & conditioning, and recovery programs.",
  openGraph: {
    title: "Services | DJP Athlete",
    description:
      "Personalized training plans, video analysis, nutrition coaching, and more. Explore the full range of DJP Athlete coaching services.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Services | DJP Athlete",
    description:
      "Personalized training plans, video analysis, nutrition coaching, and more. Explore the full range of DJP Athlete coaching services.",
  },
}

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
  },
  serviceType: "Athletic Performance Coaching",
  areaServed: "Worldwide",
  description:
    "Elite sports coaching services including personalized training plans, performance tracking, video analysis, nutrition coaching, and recovery programs.",
  url: "https://djpathlete.com/services",
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Coaching Plans",
    itemListElement: [
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Foundation Plan",
          description: "Core training plan with performance tracking",
        },
        price: "99.00",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Performance Plan",
          description: "Advanced coaching with video analysis and nutrition",
        },
        price: "199.00",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Elite Plan",
          description: "Full-service coaching with unlimited support",
        },
        price: "349.00",
        priceCurrency: "USD",
      },
    ],
  },
}

const services = [
  {
    icon: ClipboardList,
    title: "Training Plans",
    description:
      "Fully customized programs designed around your sport, schedule, and goals. Periodized for progressive overload and peak performance timing.",
    features: [
      "Sport-specific programming",
      "Weekly plan updates",
      "Progressive overload tracking",
    ],
  },
  {
    icon: BarChart3,
    title: "Performance Tracking",
    description:
      "Monitor your progress with detailed metrics. Track strength, speed, endurance, and sport-specific benchmarks over time.",
    features: [
      "Real-time progress dashboards",
      "Benchmark comparisons",
      "Trend analysis and insights",
    ],
  },
  {
    icon: Video,
    title: "Video Analysis",
    description:
      "Upload training footage and receive frame-by-frame coaching feedback. Identify technical improvements and track form over time.",
    features: [
      "Frame-by-frame breakdown",
      "Annotated coach feedback",
      "Before/after comparisons",
    ],
  },
  {
    icon: Apple,
    title: "Nutrition Coaching",
    description:
      "Fuel your performance with nutrition plans tailored to your training load, body composition goals, and sport demands.",
    features: [
      "Personalized meal plans",
      "Macro tracking guidance",
      "Pre/post workout nutrition",
    ],
  },
  {
    icon: Dumbbell,
    title: "Strength & Conditioning",
    description:
      "Build the raw power and endurance your sport demands. Science-backed S&C programs designed for athletic transfer.",
    features: [
      "Olympic lifting coaching",
      "Plyometric training",
      "Sport-specific conditioning",
    ],
  },
  {
    icon: Heart,
    title: "Recovery & Mobility",
    description:
      "Optimize rest and flexibility to prevent injuries and extend your career. Active recovery protocols and mobility routines.",
    features: [
      "Active recovery protocols",
      "Mobility programming",
      "Sleep and stress management",
    ],
  },
]

const processSteps = [
  {
    step: "01",
    title: "Free Consultation",
    description:
      "We start with a conversation about your goals, training history, and what success looks like for you.",
  },
  {
    step: "02",
    title: "Assessment & Planning",
    description:
      "A thorough movement and fitness assessment to identify strengths, weaknesses, and the right starting point.",
  },
  {
    step: "03",
    title: "Custom Programming",
    description:
      "Your coach builds a personalized program tailored to your sport, schedule, and goals — updated as you progress.",
  },
  {
    step: "04",
    title: "Train & Track",
    description:
      "Execute your program with full coaching support. Track every session, log progress, and get real-time feedback.",
  },
]

export default function ServicesPage() {
  return (
    <>
      <JsonLd data={serviceSchema} />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm font-medium text-accent uppercase tracking-wide mb-3">
            What We Offer
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
            Coaching services built for
            <br className="hidden sm:block" /> serious athletes.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            From personalized training plans to video analysis and nutrition
            guidance — everything you need to train smarter, recover faster, and
            perform at your best.
          </p>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {services.map((service) => {
              const Icon = service.icon
              return (
                <div
                  key={service.title}
                  className="bg-white rounded-2xl border border-border p-6 hover:shadow-md transition-shadow"
                >
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                    <Icon className="size-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-primary mb-2">
                    {service.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {service.description}
                  </p>
                  <ul className="space-y-2">
                    {service.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-2 text-sm text-foreground"
                      >
                        <CheckCircle className="size-4 text-accent shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Process Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Getting started is simple. Here is what to expect when you join
              DJP Athlete.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {processSteps.map((step) => (
              <div key={step.step} className="relative">
                <div className="text-4xl font-heading font-bold text-accent/30 mb-3">
                  {step.step}
                </div>
                <h3 className="text-base font-semibold text-primary mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* CTA */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            Ready to elevate your game?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Book a free consultation and let us build your path to peak
            performance.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full text-sm font-medium hover:bg-primary/90 transition-all hover:shadow-md"
          >
            Book Free Consultation
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </>
  )
}
