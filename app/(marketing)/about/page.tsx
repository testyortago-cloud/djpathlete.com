import type { Metadata } from "next"
import Image from "next/image"
import { Award, GraduationCap, Heart, Target, Trophy, Users, ArrowRight } from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { GoogleReviewsSection } from "@/components/public/GoogleReviewsSection"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { buildAboutPersonSchema } from "@/lib/brand/author"
import { getAboutPageContent } from "@/lib/db/about-page"
import type { Credential, CredentialIcon } from "@/lib/validators/about-page"

/** Meta title + description are CMS-managed via /admin/marketing/about. */
export async function generateMetadata(): Promise<Metadata> {
  const content = await getAboutPageContent()
  const ogTitle = `${content.meta_title} | DJP Athlete`
  return {
    title: content.meta_title,
    description: content.meta_description,
    alternates: { canonical: "/about" },
    openGraph: {
      title: ogTitle,
      description: content.meta_description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: content.meta_description,
    },
  }
}

/**
 * Lucide icon picker for the credential card grid. Keep this in sync with
 * CREDENTIAL_ICONS in lib/validators/about-page.ts — adding an icon there
 * means adding a row here too.
 */
const CREDENTIAL_ICON_MAP: Record<CredentialIcon, typeof GraduationCap> = {
  graduation_cap: GraduationCap,
  award: Award,
  trophy: Trophy,
}

const values = [
  {
    icon: Target,
    title: "Personalized Approach",
    description: "No two athletes are the same. Every program is built around your unique goals, sport, and body.",
  },
  {
    icon: Heart,
    title: "Athlete-First Mindset",
    description:
      "Your health and longevity come first. We build performance on a foundation of injury prevention and recovery.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description: "Training is better together. Our athletes support and push each other to be their best.",
  },
]

export default async function AboutPage() {
  const content = await getAboutPageContent()
  const personSchema = buildAboutPersonSchema(content.credentials)

  return (
    <>
      <JsonLd data={personSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "About", url: "/about" },
        ]}
      />

      {/* Hero Section */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Coach Photo */}
            <FadeIn direction="left">
              <div className="relative">
                <div className="aspect-[4/5] rounded-2xl overflow-hidden relative">
                  <Image
                    src="/images/professionalheadshot.jpg"
                    alt="Darren J Paul"
                    width={1067}
                    height={1600}
                    sizes="(max-width: 1024px) 100vw, 40vw"
                    className="h-full w-full object-cover object-top"
                  />
                </div>
                {/* Decorative accent */}
                <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-accent/20 rounded-2xl -z-10" />
              </div>
            </FadeIn>

            {/* Bio — copy is editable via /admin/marketing/about */}
            <FadeIn delay={0.15}>
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-12 bg-accent" />
                  <p className="text-sm font-medium text-accent uppercase tracking-widest">
                    {content.hero_eyebrow}
                  </p>
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-3">
                  {content.hero_heading}
                </h1>
                <p className="text-base font-medium text-accent uppercase tracking-widest mb-6">
                  {content.hero_credentials_line}
                </p>
                {content.hero_bio_paragraphs.map((paragraph, i) => (
                  <p
                    key={i}
                    className={`text-lg text-muted-foreground leading-relaxed ${
                      i < content.hero_bio_paragraphs.length - 1 ? "mb-4" : ""
                    }`}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* AEO answer block — extractable entity definition (editable via CMS) */}
      <SemanticAnswerBlock
        eyebrow={content.aeo_eyebrow}
        question={content.aeo_question}
        answer={content.aeo_answer}
      />

      {/* Credentials Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">
                  Credentials & Certifications
                </p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                Credentials & Certifications
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Backed by education and industry-recognized certifications to deliver world-class coaching.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.credentials.map((cred: Credential, i) => {
              const Icon = CREDENTIAL_ICON_MAP[cred.icon]
              return (
                <FadeIn key={`${cred.title}-${i}`} delay={i * 0.06}>
                  <div className="group relative overflow-hidden flex items-center gap-4 p-4 rounded-xl bg-white border border-border">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{cred.title}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* Google Reviews — renders only when GOOGLE_PLACES_API_KEY + GOOGLE_BUSINESS_PLACE_ID are set.
          Hidden visually (boss flagged this block as too noisy on About) but kept in the DOM via
          sr-only so the review snippets still register as on-page entities for SEO/AEO. ─── */}
      <div className="sr-only" aria-hidden="false">
        <GoogleReviewsSection />
      </div>

      {/* Philosophy Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">Training Philosophy</p>
                <div className="h-px w-8 bg-accent" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
                Training Philosophy
              </h2>
              <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                Great coaching is not about pushing harder — it is about training smarter. I believe in building
                athletes from the ground up: mastering movement quality, developing sport-specific strength, and
                creating sustainable habits that carry through an entire career.
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8">
            {values.map((value, i) => {
              const Icon = value.icon
              return (
                <FadeIn key={value.title} delay={i * 0.1}>
                  <div className="text-center">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 mx-auto mb-4">
                      <Icon className="size-7 text-accent" />
                    </div>
                    <h3 className="text-lg font-semibold text-primary mb-2">{value.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{value.description}</p>
                  </div>
                </FadeIn>
              )
            })}
          </div>
        </div>
      </section>

      {/* Story Section — copy is editable via /admin/marketing/about */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-8 text-center">
              {content.story_heading}
            </h2>
            <div className="prose prose-lg max-w-none text-muted-foreground">
              {content.story_paragraphs.map((paragraph, i) => (
                <p
                  key={i}
                  className={`leading-relaxed ${
                    i < content.story_paragraphs.length - 1 ? "mb-6" : ""
                  }`}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* FAQ (managed via CMS) — renders only when published FAQs exist for /about */}
      <ManagedFaqSection
        pageKey="about"
        variant="cards"
        eyebrow="Common questions"
        title="Questions about Darren and DJP Athlete."
        className="bg-surface"
      />

      {/* CTA Section — copy is editable via /admin/marketing/about */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">
                {content.cta_eyebrow}
              </p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              {content.cta_heading}
            </h2>
            <p className="text-lg text-muted-foreground mb-8">{content.cta_description}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href={content.cta_button_href}
                className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
              >
                {content.cta_button_label}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </FadeIn>
      </section>
    </>
  )
}
