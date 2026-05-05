import type { Metadata } from "next"
import { JsonLd } from "@/components/shared/JsonLd"
import { WaitlistForm } from "./WaitlistForm"

export const metadata: Metadata = {
  title: "Education",
  description:
    "A new standard for performance. A structured system for operating when certainty disappears. Coming soon from DJP Athlete.",
  alternates: { canonical: "/education" },
  openGraph: {
    title: "Education | DJP Athlete",
    description:
      "A new standard for performance. A structured system for operating when certainty disappears. Coming soon from DJP Athlete.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Education | DJP Athlete",
    description:
      "A new standard for performance. A structured system for operating when certainty disappears. Coming soon from DJP Athlete.",
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
          <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-heading font-semibold text-primary-foreground tracking-tight mb-10">
            A New Standard
            <br className="hidden sm:block" /> for Performance
          </h1>

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
