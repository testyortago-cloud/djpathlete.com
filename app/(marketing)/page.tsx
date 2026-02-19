import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import {
  ArrowRight,
  Dumbbell,
  Activity,
  Monitor,
  Quote,
  Mail,
  ChevronRight,
} from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export const metadata: Metadata = {
  title: "DJP Athlete | Elite Performance Coaching",
  description:
    "Elite performance coaching by Darren J Paul. In-person training, online coaching, and return-to-performance assessment for serious athletes.",
  openGraph: {
    title: "DJP Athlete | Elite Performance Coaching",
    description:
      "Elite performance coaching by Darren J Paul. In-person training, online coaching, and return-to-performance assessment for serious athletes.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DJP Athlete | Elite Performance Coaching",
    description:
      "Elite performance coaching by Darren J Paul. In-person training, online coaching, and return-to-performance assessment for serious athletes.",
  },
}

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "DJP Athlete",
  url: "https://djpathlete.com",
  logo: "https://djpathlete.com/og-image.png",
  description:
    "DJP Athlete provides elite performance coaching by Darren J Paul. In-person training, online coaching, and return-to-performance assessment for serious athletes.",
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

const testimonials = [
  {
    name: "Abigail Rencheli",
    title: "WTA Professional Tennis Player",
    quote:
      "What sets him apart is how much he genuinely cares about you as a person first. The Online Program is so easy to navigate and thoroughly explains how to perform the exercises.",
  },
  {
    name: "Ganna Poznikhierenko",
    title: "WTA Professional Tennis Player",
    quote:
      "He's truly the best coach I've ever worked with. The Online Program helps me stay connected even though I am training independently.",
  },
  {
    name: "Tina Pisnik",
    title: "Professional Pickleball Player",
    quote:
      "Darren understands performance & injury prevention at a very high level. The Online program is seamless and allows me to train from anywhere.",
  },
]

const stats = [
  { value: "20+", label: "Years Experience" },
  { value: "500+", label: "Athletes Coached" },
  { value: "15+", label: "Sports Covered" },
  { value: "3", label: "Continents" },
]

export default function HomePage() {
  return (
    <>
      <JsonLd data={organizationSchema} />
      <JsonLd data={webSiteSchema} />

      {/* ─── Hero Section ─── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-primary" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_20%_60%,_rgba(196,155,122,0.1),_transparent)]" />

        {/* Coach photo (left half on desktop) */}
        <div className="absolute inset-y-0 left-0 w-full lg:w-[45%]">
          <Image
            src="/images/darrenpaul.png"
            alt="Darren J Paul — Performance Coach"
            fill
            className="object-cover object-top"
            priority
            sizes="(max-width: 1024px) 100vw, 45vw"
          />
          {/* Gradient fade from image into content area */}
          <div className="absolute inset-y-0 right-0 w-2/3 bg-gradient-to-r from-transparent to-primary hidden lg:block" />
          {/* Bottom fade */}
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-primary to-transparent hidden lg:block" />
          {/* Mobile: overlay so text is readable */}
          <div className="absolute inset-0 bg-primary/60 lg:hidden" />
        </div>

        {/* Content */}
        <div className="relative z-10 w-full px-4 sm:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="lg:ml-auto lg:w-[55%] lg:pl-16">
              {/* Overline */}
              <div className="flex items-center gap-3 mb-8">
                <div className="h-px w-12 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">
                  DJP Athlete
                </p>
              </div>

              {/* Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-heading font-bold text-primary-foreground tracking-tight leading-[1.08] mb-8">
                Elite Performance
                <br />
                is Not Trained.
                <br />
                <span className="text-accent">It Is Engineered.</span>
              </h1>

              {/* Sub copy */}
              <p className="text-lg sm:text-xl text-primary-foreground/70 leading-relaxed max-w-xl mb-12">
                Performance strategist. Coach. Researcher.
                <br className="hidden sm:block" />
                Two decades of elite-level experience.
              </p>

              {/* CTA row */}
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <Link
                  href="/in-person"
                  className="inline-flex items-center gap-3 bg-accent text-primary px-8 py-4 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all hover:shadow-lg group"
                >
                  Explore Services
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-3 border border-white/20 text-primary-foreground px-8 py-4 rounded-full text-sm font-medium hover:bg-white/10 transition-all group"
                >
                  Book a Consultation
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom accent line */}
        <div className="absolute bottom-0 left-0 right-0">
          <div className="h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        </div>
      </section>

      {/* ─── Stats Bar ─── */}
      <section className="py-12 lg:py-16 px-4 sm:px-8 bg-surface border-b border-border">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl lg:text-4xl font-heading font-bold text-primary mb-1">
                  {stat.value}
                </p>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wide">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Services Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">
                What We Do
              </p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight">
              Training &mdash; Testing &mdash; Coaching
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {services.map((service) => {
              const Icon = service.icon
              return (
                <Link
                  key={service.title}
                  href={service.href}
                  className="group relative bg-white rounded-2xl border border-border p-8 hover:shadow-lg transition-all duration-300 overflow-hidden"
                >
                  {/* Hover accent line */}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-accent scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />

                  <div className="flex size-14 items-center justify-center rounded-xl bg-primary/10 mb-6 group-hover:bg-accent/15 transition-colors">
                    <Icon className="size-7 text-primary group-hover:text-accent transition-colors" />
                  </div>
                  <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-2">
                    {service.title}
                  </p>
                  <h3 className="text-xl font-heading font-semibold text-primary mb-3">
                    {service.subtitle}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                    {service.description}
                  </p>
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-primary group-hover:text-accent transition-colors">
                    Learn more
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
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
            <div className="lg:col-span-2">
              <div className="relative">
                <div className="aspect-[3/4] rounded-2xl overflow-hidden">
                  <Image
                    src="/images/darrenpaul.png"
                    alt="Darren J Paul"
                    fill
                    className="object-cover object-top"
                    sizes="(max-width: 1024px) 100vw, 40vw"
                  />
                </div>
                {/* Decorative accent block */}
                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-accent/20 rounded-2xl -z-10" />
              </div>
            </div>

            {/* Bio copy */}
            <div className="lg:col-span-3">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px w-12 bg-accent" />
                <p className="text-sm font-medium text-accent uppercase tracking-widest">
                  About Me
                </p>
              </div>
              <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight mb-8">
                Darren J Paul
              </h2>

              <div className="space-y-5">
                <p className="text-lg text-foreground font-medium leading-relaxed">
                  I&apos;m a performance strategist, coach, researcher, and
                  advisor.
                </p>
                <p className="text-base text-muted-foreground leading-relaxed">
                  I&apos;ve spent over two decades working inside
                  high-performance environments, studying how athletes adapt, how
                  they break down, and why most systems fail them at critical
                  moments.
                </p>
                <p className="text-base text-muted-foreground leading-relaxed">
                  I think in systems, not exercises. I look for patterns, not
                  shortcuts. I question assumptions that are widely accepted but
                  rarely examined. I use lateral thinking to connect the dots
                  between performance, injury, behaviour, load, movement, and
                  context.
                </p>
                <p className="text-base text-muted-foreground leading-relaxed">
                  I don&apos;t chase fatigue. I don&apos;t chase trends. I
                  don&apos;t sell certainty where none exists. I build structure.
                  I manage risk. I help athletes develop capacity they can trust.
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
            </div>
          </div>
        </div>
      </section>

      {/* ─── Testimonials Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">
                Testimonials
              </p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight">
              Trusted by elite athletes.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial) => (
              <div
                key={testimonial.name}
                className="bg-white rounded-2xl border border-border p-8 flex flex-col"
              >
                <Quote className="size-8 text-accent/30 mb-4" />
                <blockquote className="flex-1 mb-6">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    &ldquo;{testimonial.quote}&rdquo;
                  </p>
                </blockquote>
                <div className="flex items-center gap-3 pt-4 border-t border-border">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <span className="text-sm font-semibold">
                      {testimonial.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {testimonial.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {testimonial.title}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8 bg-surface">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight mb-4">
            Ready to elevate your performance?
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed mb-10">
            Whether you&apos;re recovering from injury, training for
            competition, or seeking a higher standard of coaching — the first
            step is a conversation.
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
              href="/programs"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-accent transition-colors group"
            >
              Browse Programs
              <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Newsletter Section ─── */}
      <section className="py-20 lg:py-32 px-4 sm:px-8 bg-primary">
        <div className="max-w-2xl mx-auto text-center">
          <Mail className="size-10 text-accent mx-auto mb-6" />
          <h2 className="text-3xl sm:text-4xl font-heading font-semibold text-primary-foreground tracking-tight mb-4">
            Stay in the loop.
          </h2>
          <p className="text-primary-foreground/70 leading-relaxed mb-8">
            Get insights on performance, training philosophy, and program
            updates. No spam. No fluff. Just the work.
          </p>
          <form
            className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
            action="#"
          >
            <Input
              type="email"
              placeholder="Your email address"
              className="h-12 bg-white/10 border-white/20 text-primary-foreground placeholder:text-primary-foreground/50 focus-visible:border-accent focus-visible:ring-accent/30"
              required
            />
            <Button
              type="submit"
              className="h-12 px-8 bg-accent text-primary hover:bg-accent/90 rounded-md font-semibold shrink-0"
            >
              Subscribe
            </Button>
          </form>
          <p className="text-xs text-primary-foreground/40 mt-4">
            We respect your privacy. Unsubscribe at any time.
          </p>
        </div>
      </section>
    </>
  )
}
