import type { Metadata } from "next"
import Image from "next/image"
import { Award, GraduationCap, Heart, Target, Trophy, Users, ArrowRight } from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"

export const metadata: Metadata = {
  title: "Darren J Paul — Athletic Performance Coach",
  description:
    "Meet Darren J Paul — athletic performance coach and sports performance coach behind DJP Athlete. Two decades coaching elite athletes across football, rugby, athletics, and court sports.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "Darren J Paul — Athletic Performance Coach | DJP Athlete",
    description:
      "Meet Darren J Paul — athletic performance coach and sports performance coach behind DJP Athlete. Two decades coaching elite athletes across multiple sports.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Darren J Paul — Athletic Performance Coach | DJP Athlete",
    description:
      "Meet Darren J Paul — athletic performance coach and sports performance coach behind DJP Athlete. Two decades coaching elite athletes.",
  },
}

const personSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Darren Paul",
  alternateName: "Darren J Paul",
  jobTitle: "Athletic Performance Coach",
  worksFor: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://www.darrenjpaul.com",
  },
  description:
    "Darren J Paul — athletic performance coach and sports performance coach behind DJP Athlete. Two decades coaching elite athletes across football, rugby, athletics, and court sports.",
  knowsAbout: [
    "athletic performance coach",
    "sports performance coach",
    "sports performance training",
    "strength and conditioning",
    "return to sport assessment",
  ],
  url: "https://www.darrenjpaul.com/about",
}

const credentials = [
  { icon: GraduationCap, title: "Certified Strength & Conditioning Specialist (CSCS)" },
  { icon: Award, title: "NASM Certified Personal Trainer" },
  { icon: Trophy, title: "USA Weightlifting Level 2 Coach" },
  { icon: GraduationCap, title: "B.S. in Exercise Science & Kinesiology" },
  { icon: Trophy, title: "10+ Years Coaching Experience" },
]

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

export default function AboutPage() {
  return (
    <>
      <JsonLd data={personSchema} />

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

            {/* Bio */}
            <FadeIn delay={0.15}>
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-12 bg-accent" />
                  <p className="text-sm font-medium text-accent uppercase tracking-widest">Meet Your Coach</p>
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
                  Darren Paul
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                  With over a decade of experience coaching athletes from youth sports through professional competition,
                  I founded DJP Athlete to make elite-level coaching accessible to everyone.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  My approach combines science-backed training methods with individualized attention — because the best
                  program is one that is built specifically for you. Whether you are chasing a scholarship, preparing
                  for competition, or simply want to move and feel better, I am here to help you get there.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

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
            {credentials.map((cred, i) => {
              const Icon = cred.icon
              return (
                <FadeIn key={cred.title} delay={i * 0.06}>
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

      {/* Story Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">The Journey</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-8 text-center">
              The Journey
            </h2>
            <div className="prose prose-lg max-w-none text-muted-foreground">
              <p className="leading-relaxed mb-6">
                I grew up as a multi-sport athlete — competing in track and field, football, and basketball through
                college. Along the way, I experienced firsthand what it is like to train without proper guidance.
                Nagging injuries, plateaus, and burnout were constant companions.
              </p>
              <p className="leading-relaxed mb-6">
                When I discovered the science of athletic performance — periodization, biomechanics, and sport
                psychology — everything changed. I realized that with the right approach, athletes could train harder
                while staying healthier and performing at levels they never thought possible.
              </p>
              <p className="leading-relaxed">
                That realization became my mission. I went back to school for Exercise Science, earned my
                certifications, and started coaching. DJP Athlete is the culmination of everything I have learned — a
                platform where every athlete, regardless of level, can access the coaching and tools they need to reach
                their full potential.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Ready to start training?</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Ready to start training?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Whether you are an aspiring athlete or a seasoned competitor, there is a place for you here.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/contact"
                className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
              >
                Get in Touch
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/#pricing"
                className="inline-flex items-center gap-2 border border-border text-primary px-8 py-4 rounded-full text-sm font-semibold hover:bg-surface transition-colors"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </FadeIn>
      </section>
    </>
  )
}
