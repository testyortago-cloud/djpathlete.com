import type { Metadata } from "next"
import { Mail, Phone, MapPin } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { FadeIn } from "@/components/shared/FadeIn"
import { ContactForm } from "./ContactForm"
import { BookACallButton } from "@/components/public/BookACallButton"
import { readCalendlySchedulingUrl } from "@/lib/calendly/env"

export const metadata: Metadata = {
  title: "Contact Darren J Paul — Book a Consultation",
  description:
    "Contact Darren J Paul Sports Performance in Zephyrhills, FL. Book a free consultation about in-person, online, or return-to-performance coaching.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact Darren J Paul — Book a Consultation | DJP Athlete",
    description:
      "Contact Darren J Paul Sports Performance in Zephyrhills, FL. Book a free consultation about in-person, online, or return-to-performance coaching.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact Darren J Paul — Book a Consultation | DJP Athlete",
    description:
      "Contact Darren J Paul Sports Performance in Zephyrhills, FL. Book a free consultation.",
  },
}

const contactPageSchema = {
  "@context": "https://schema.org",
  "@type": "ContactPage",
  name: "Contact DJP Athlete",
  description:
    "Contact DJP Athlete for sports performance training and sports performance coach inquiries. Book a consultation or send us a message about coaching programs.",
  url: "https://www.darrenjpaul.com/contact",
  mainEntity: {
    "@type": "Organization",
    name: "DJP Athlete",
    email: "info@darrenjpaul.com",
    url: "https://www.darrenjpaul.com",
  },
}

const contactInfo = [
  {
    icon: Mail,
    label: "Email",
    value: "info@darrenjpaul.com",
    href: "mailto:info@darrenjpaul.com",
  },
  {
    icon: Phone,
    label: "Phone",
    value: "(813) 397-8461",
    href: "tel:+18133978461",
  },
  {
    icon: MapPin,
    label: "Location",
    value: "Available worldwide — remote coaching",
    href: null,
  },
]

export default function ContactPage() {
  // Read on the server so the page ships nothing about Calendly when it is not
  // configured -- and so the value comes from one place, the same one the chat
  // assistant reads.
  const schedulingUrl = readCalendlySchedulingUrl()
  return (
    <>
      <JsonLd data={contactPageSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Contact", url: "/contact" },
        ]}
      />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-20 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-5xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Get In Touch</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
              Let&apos;s talk about your goals.
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Whether you are ready to start training or just have questions, we would love to hear from you. Fill out
              the form below and we will get back to you within 24 hours.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* Contact Grid */}
      <section className="pb-16 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-12">
            {/* Form */}
            <FadeIn direction="left" className="lg:col-span-2">
              <div className="bg-white rounded-2xl border border-border p-6 sm:p-8">
                <ContactForm />
              </div>
            </FadeIn>

            {/* Sidebar */}
            <FadeIn delay={0.15}>
              <div className="space-y-6">
                <div className="bg-surface rounded-2xl border border-border p-6">
                  <h2 className="text-lg font-semibold text-primary mb-4">Contact Information</h2>
                  <div className="space-y-4">
                    {contactInfo.map((item) => {
                      const Icon = item.icon
                      return (
                        <div key={item.label} className="flex items-start gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Icon className="size-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{item.label}</p>
                            {item.href ? (
                              <a
                                href={item.href}
                                className="text-sm text-muted-foreground hover:text-primary transition-colors"
                              >
                                {item.value}
                              </a>
                            ) : (
                              <p className="text-sm text-muted-foreground">{item.value}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="bg-primary rounded-2xl p-6 text-primary-foreground">
                  <h3 className="text-lg font-semibold mb-2">Free Consultation</h3>
                  <p className="text-sm text-primary-foreground/80 leading-relaxed">
                    Not sure where to start? Book a free 15-minute consultation and we will help you find the right
                    program for your goals.
                  </p>
                  {/* This card promised a booking and offered no way to make one
                      until 2026-09-05. The button belongs HERE, beside the words
                      that make the offer, rather than in a second block competing
                      with it -- one ask, in one voice. It renders nothing until a
                      coach connects a calendar, which returns the card to exactly
                      the copy it had before. */}
                  <div className="mt-4">
                    <BookACallButton schedulingUrl={schedulingUrl} />
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>
    </>
  )
}
