import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { Clock, CalendarDays, BarChart3, ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { getActiveProgramById } from "@/lib/db/programs"
import { JsonLd } from "@/components/shared/JsonLd"
import { BuyButton } from "./BuyButton"

interface Props {
  params: Promise<{ id: string }>
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  conditioning: "Conditioning",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
  nutrition: "Nutrition",
  hybrid: "Hybrid",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-success/10 text-success",
  intermediate: "bg-warning/10 text-warning",
  advanced: "bg-destructive/10 text-destructive",
  elite: "bg-primary/10 text-primary",
}

function formatPrice(cents: number | null): string {
  if (cents == null) return "Free"
  return `$${(cents / 100).toFixed(2)}`
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  try {
    const program = await getActiveProgramById(id)
    return {
      title: program.name,
      description:
        program.description ??
        `${program.name} — a ${program.difficulty} ${program.category} program by DJP Athlete.`,
      openGraph: {
        title: `${program.name} | DJP Athlete`,
        description:
          program.description ??
          `${program.name} — a ${program.difficulty} ${program.category} program.`,
        type: "website",
      },
    }
  } catch {
    return { title: "Program Not Found" }
  }
}

export default async function ProgramDetailPage({ params }: Props) {
  const { id } = await params

  // Logged-in users should use the client program page
  const session = await auth()
  if (session?.user) {
    redirect(`/client/programs/${id}`)
  }

  let program
  try {
    program = await getActiveProgramById(id)
  } catch {
    notFound()
  }

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: program.name,
    description: program.description,
    url: `https://djpathlete.com/programs/${program.id}`,
    brand: { "@type": "Organization", name: "DJP Athlete" },
    ...(program.price_cents && {
      offers: {
        "@type": "Offer",
        price: (program.price_cents / 100).toFixed(2),
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    }),
  }

  return (
    <>
      <JsonLd data={productSchema} />

      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Back link */}
          <Link
            href="/programs"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-8"
          >
            <ArrowLeft className="size-4" />
            All Programs
          </Link>

          {/* Badges */}
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary">
              {CATEGORY_LABELS[program.category] ?? program.category}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}
            >
              {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight mb-4">
            {program.name}
          </h1>

          {/* Description */}
          {program.description && (
            <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-3xl">
              {program.description}
            </p>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 max-w-md mb-10">
            <div className="rounded-xl border border-border bg-white p-4 text-center">
              <Clock className="size-5 text-accent mx-auto mb-2" />
              <p className="text-xl font-semibold text-primary">
                {program.duration_weeks}
              </p>
              <p className="text-xs text-muted-foreground">Weeks</p>
            </div>
            <div className="rounded-xl border border-border bg-white p-4 text-center">
              <CalendarDays className="size-5 text-accent mx-auto mb-2" />
              <p className="text-xl font-semibold text-primary">
                {program.sessions_per_week}
              </p>
              <p className="text-xs text-muted-foreground">Sessions/Week</p>
            </div>
            <div className="rounded-xl border border-border bg-white p-4 text-center">
              <BarChart3 className="size-5 text-accent mx-auto mb-2" />
              <p className="text-xl font-semibold text-primary capitalize">
                {program.difficulty}
              </p>
              <p className="text-xs text-muted-foreground">Level</p>
            </div>
          </div>

          {/* Price + CTA */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            {program.price_cents && (
              <p className="text-3xl font-heading font-semibold text-primary">
                {formatPrice(program.price_cents)}
              </p>
            )}

            {program.price_cents ? (
              <BuyButton
                programId={program.id}
                isLoggedIn={false}
              />
            ) : (
              <Link
                href="/contact"
                className="inline-flex items-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Contact Us
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
