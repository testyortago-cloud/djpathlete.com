import type { Metadata } from "next"
import { Dumbbell } from "lucide-react"
import { getPrograms } from "@/lib/db/programs"
import { ProgramCard } from "@/components/public/ProgramCard"
import { EmptyState } from "@/components/ui/empty-state"
import { JsonLd } from "@/components/shared/JsonLd"

export const metadata: Metadata = {
  title: "Programs",
  description:
    "Browse DJP Athlete training programs. Strength, conditioning, sport-specific, and recovery programs for every level.",
  openGraph: {
    title: "Programs | DJP Athlete",
    description:
      "Browse expert-designed training programs for strength, conditioning, sport performance, and recovery.",
    type: "website",
  },
}

const storeSchema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "DJP Athlete Training Programs",
  description:
    "Browse expert-designed training programs for strength, conditioning, sport performance, and recovery.",
  url: "https://djpathlete.com/programs",
  provider: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
  },
}

export default async function ProgramsPage() {
  const programs = await getPrograms()

  return (
    <>
      <JsonLd data={storeSchema} />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm font-medium text-accent uppercase tracking-wide mb-3">
            Training Programs
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
            Programs built for
            <br className="hidden sm:block" /> serious athletes.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Expert-designed training programs to help you build strength, improve
            conditioning, and reach peak performance — no matter your level.
          </p>
        </div>
      </section>

      {/* Program Grid */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          {programs.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {programs.map((program) => (
                <ProgramCard key={program.id} program={program} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Dumbbell}
              heading="No programs available yet"
              description="We're building new training programs. Check back soon or contact us for a custom plan."
              ctaLabel="Contact Us"
              ctaHref="/contact"
            />
          )}
        </div>
      </section>
    </>
  )
}
