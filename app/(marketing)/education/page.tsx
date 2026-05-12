import type { Metadata } from "next"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { WaitlistForm } from "./WaitlistForm"

export const metadata: Metadata = {
  title: "Sports Education",
  description:
    "Sports education from DJP Athlete to help athletes and coaches understand performance, readiness, and smarter training decisions.",
  alternates: { canonical: "/education" },
  openGraph: {
    title: "Sports Education | DJP Athlete",
    description:
      "Sports education from DJP Athlete to help athletes and coaches understand performance, readiness, and smarter training decisions.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Education | DJP Athlete",
    description:
      "Sports education from DJP Athlete — helping athletes and coaches understand performance, readiness, and smarter training decisions.",
  },
}

const educationSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Education — DJP Athlete",
  description: "A new standard for performance. A structured system for operating when certainty disappears.",
  url: "https://www.darrenjpaul.com/education",
  publisher: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://www.darrenjpaul.com",
  },
}

export default function EducationPage() {
  return (
    <>
      <JsonLd data={educationSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Education", url: "/education" },
        ]}
      />

      {/* Full-page dark hero */}
      <section className="min-h-screen flex items-center justify-center bg-primary px-4 sm:px-8">
        <div className="max-w-3xl mx-auto text-center py-32 lg:py-40">
          {/* Overline */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="h-px w-8 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">Coming Soon</p>
            <div className="h-px w-8 bg-accent" />
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary-foreground tracking-tight mb-4">
            Sports Education for Athletes and Coaches
          </h1>
          <p className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-heading font-semibold text-primary-foreground/85 tracking-tight mb-10">
            A New Standard
            <br className="hidden sm:block" /> for Performance
          </p>

          {/* Body copy */}
          <div className="space-y-6 mb-14">
            <p className="text-lg sm:text-xl text-primary-foreground/80 leading-relaxed">
              Built for the moments that destabilize careers, teams, and identities.
            </p>
            <p className="text-lg sm:text-xl text-primary-foreground font-medium leading-relaxed">
              Not another course.
            </p>
            <p className="text-lg sm:text-xl text-primary-foreground/80 leading-relaxed">
              A structured system for operating when certainty disappears.
            </p>
            <p className="text-base text-primary-foreground/60 leading-relaxed max-w-xl mx-auto">
              Designed for high-performance sport environments, teams, and competitive leaders navigating instability.
            </p>
          </div>

          {/* Waitlist CTA */}
          <WaitlistForm />
        </div>
      </section>
    </>
  )
}
