import { ProductTeaserCard } from "@/components/ProductTeaserCard"
import { ProductShowcase } from "@/components/ProductShowcase"
import { BankingScaleHero } from "@/components/BankingScaleHero"
import { FeaturesGrid } from "@/components/FeaturesGrid"
import { WhoItsFor } from "@/components/WhoItsFor"
import { IntegrationCarousel } from "@/components/IntegrationCarousel"
import { CustomerReviews } from "@/components/CustomerReviews"
import { PricingSection } from "@/components/PricingSection"
import { FAQSection } from "@/components/FAQSection"
import { CTABanner } from "@/components/CTABanner"
import { JsonLd } from "@/components/shared/JsonLd"

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "DJP Athlete",
  url: "https://djpathlete.com",
  logo: "https://djpathlete.com/og-image.png",
  description:
    "DJP Athlete provides elite sports coaching and athletic performance training. Personalized training plans, performance tracking, video analysis, and nutrition guidance for athletes at every level.",
  sameAs: [
    "https://twitter.com/djpathlete",
    "https://facebook.com/djpathlete",
    "https://instagram.com/djpathlete",
  ],
}

const webSiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "DJP Athlete",
  url: "https://djpathlete.com",
}

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is DJP Athlete and how does the coaching program work?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "DJP Athlete is an elite sports coaching platform that provides personalized training plans, performance tracking, video analysis, and nutrition guidance. We work with athletes at every level — from youth sports to professional competition — to help them reach their full potential through structured, science-backed coaching.",
      },
    },
    {
      "@type": "Question",
      name: "What types of athletes does DJP Athlete work with?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "We work with athletes across all levels and sports — youth athletes developing foundational skills, college athletes competing at the collegiate level, professional athletes optimizing peak performance, and recreational athletes pursuing personal fitness goals.",
      },
    },
    {
      "@type": "Question",
      name: "How does performance tracking work?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Our performance tracking system monitors key metrics like speed, strength, endurance, and sport-specific skills over time. Athletes and coaches can review progress through dashboards, identify areas for improvement, and adjust training plans based on real data.",
      },
    },
    {
      "@type": "Question",
      name: "Do you offer nutrition coaching as part of the program?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Every coaching tier includes nutrition guidance tailored to your sport, training load, and goals. Our Performance and Elite plans include personalized meal plans and ongoing nutrition adjustments as your training evolves.",
      },
    },
    {
      "@type": "Question",
      name: "How do I get started and what does pricing look like?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Getting started is simple — book a free consultation to discuss your goals, and we will match you with the right coaching plan. DJP Athlete offers three tiers: Foundation at $99/month, Performance at $199/month, and Elite at $349/month, each with increasing levels of personalized coaching and support.",
      },
    },
  ],
}

export default function Page() {
  return (
    <>
      <JsonLd data={organizationSchema} />
      <JsonLd data={webSiteSchema} />
      <JsonLd data={faqSchema} />
      <ProductTeaserCard />
      <ProductShowcase />
      <BankingScaleHero />
      <FeaturesGrid />
      <WhoItsFor />
      <IntegrationCarousel />
      <CustomerReviews />
      <PricingSection />
      <FAQSection />
      <CTABanner />
    </>
  )
}
