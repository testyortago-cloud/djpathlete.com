import type { Metadata } from "next"
import {
  Award,
  GraduationCap,
  Heart,
  Target,
  Trophy,
  Users,
  ArrowRight,
} from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"

export const metadata: Metadata = {
  title: "About",
  description:
    "Meet the coach behind DJP Athlete. Learn about our training philosophy, credentials, and commitment to helping athletes at every level reach their full potential.",
  openGraph: {
    title: "About | DJP Athlete",
    description:
      "Meet the coach behind DJP Athlete. Learn about our training philosophy and commitment to athlete development.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "About | DJP Athlete",
    description:
      "Meet the coach behind DJP Athlete. Learn about our training philosophy and commitment to athlete development.",
  },
}

const personSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Darren Paul",
  jobTitle: "Head Coach & Founder",
  worksFor: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
  },
  description:
    "Elite sports coach and founder of DJP Athlete, specializing in personalized athletic performance training.",
  url: "https://djpathlete.com/about",
}

const credentials = [
  { icon: GraduationCap, title: "Certified Strength & Conditioning Specialist (CSCS)" },
  { icon: Award, title: "NASM Certified Personal Trainer" },
  { icon: Trophy, title: "USA Weightlifting Level 2 Coach" },
  { icon: GraduationCap, title: "B.S. in Exercise Science & Kinesiology" },
  { icon: Award, title: "Precision Nutrition Level 1 Certified" },
  { icon: Trophy, title: "10+ Years Coaching Experience" },
]

const values = [
  {
    icon: Target,
    title: "Personalized Approach",
    description:
      "No two athletes are the same. Every program is built around your unique goals, sport, and body.",
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
    description:
      "Training is better together. Our athletes support and push each other to be their best.",
  },
]

export default function AboutPage() {
  return (
    <>
      <JsonLd data={personSchema} />

      {/* Hero Section */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Photo placeholder */}
            <div className="relative">
              <div className="aspect-[4/5] rounded-2xl bg-surface border border-border overflow-hidden flex items-center justify-center">
                <div className="text-center">
                  <div className="size-32 rounded-full bg-primary/10 mx-auto flex items-center justify-center mb-4">
                    <span className="text-5xl font-heading font-semibold text-primary">
                      DP
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Coach Photo</p>
                </div>
              </div>
              {/* Decorative accent */}
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-accent/20 rounded-2xl -z-10" />
            </div>

            {/* Bio */}
            <div>
              <p className="text-sm font-medium text-accent uppercase tracking-wide mb-3">
                Meet Your Coach
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
                Darren Paul
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                With over a decade of experience coaching athletes from youth
                sports through professional competition, I founded DJP Athlete to
                make elite-level coaching accessible to everyone.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed">
                My approach combines science-backed training methods with
                individualized attention — because the best program is one that is
                built specifically for you. Whether you are chasing a scholarship,
                preparing for competition, or simply want to move and feel better,
                I am here to help you get there.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Credentials Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Credentials & Certifications
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Backed by education and industry-recognized certifications to
              deliver world-class coaching.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {credentials.map((cred) => {
              const Icon = cred.icon
              return (
                <div
                  key={cred.title}
                  className="flex items-center gap-4 p-4 rounded-xl bg-white border border-border"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {cred.title}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Training Philosophy
            </h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Great coaching is not about pushing harder — it is about training
              smarter. I believe in building athletes from the ground up:
              mastering movement quality, developing sport-specific strength, and
              creating sustainable habits that carry through an entire career.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {values.map((value) => {
              const Icon = value.icon
              return (
                <div key={value.title} className="text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 mx-auto mb-4">
                    <Icon className="size-7 text-accent" />
                  </div>
                  <h3 className="text-lg font-semibold text-primary mb-2">
                    {value.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {value.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Story Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-8 text-center">
            The Journey
          </h2>
          <div className="prose prose-lg max-w-none text-muted-foreground">
            <p className="leading-relaxed mb-6">
              I grew up as a multi-sport athlete — competing in track and field,
              football, and basketball through college. Along the way, I
              experienced firsthand what it is like to train without proper
              guidance. Nagging injuries, plateaus, and burnout were constant
              companions.
            </p>
            <p className="leading-relaxed mb-6">
              When I discovered the science of athletic performance — periodization,
              biomechanics, sport psychology, and nutrition — everything changed. I
              realized that with the right approach, athletes could train harder
              while staying healthier and performing at levels they never thought
              possible.
            </p>
            <p className="leading-relaxed">
              That realization became my mission. I went back to school for
              Exercise Science, earned my certifications, and started coaching.
              DJP Athlete is the culmination of everything I have learned — a
              platform where every athlete, regardless of level, can access the
              coaching and tools they need to reach their full potential.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            Ready to start training?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Whether you are an aspiring athlete or a seasoned competitor, there
            is a place for you here.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full text-sm font-medium hover:bg-primary/90 transition-all hover:shadow-md"
            >
              Get in Touch
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/#pricing"
              className="inline-flex items-center gap-2 border border-border text-primary px-6 py-3 rounded-full text-sm font-medium hover:bg-surface transition-colors"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
