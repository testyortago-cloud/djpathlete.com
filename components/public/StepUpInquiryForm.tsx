"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"
import { inquiryFormSchema, type ServiceType } from "@/lib/validators/inquiry"

/** Read a single cookie by name. Returns "" when absent. */
function readCookie(name: string): string {
  if (typeof document === "undefined") return ""
  const match = document.cookie.split("; ").find((r) => r.startsWith(name + "="))
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : ""
}

/**
 * Friendly Step Up service options mapped onto the existing inquiry service
 * enum. The true selection (the friendly label) is also written into the
 * structured `goals` text so nothing is lost when several options share an
 * enum value (e.g. Hybrid + Homeschool both route as `in_person`).
 */
const SUFS_SERVICES = [
  { key: "assessment", label: "Athletic Performance Assessment", service: "assessment" },
  { key: "hybrid", label: "Hybrid Performance Package (in-person + online)", service: "in_person" },
  { key: "online", label: "Online Performance Program", service: "online" },
  { key: "clinic", label: "Agility Clinic", service: "clinic" },
  { key: "camp", label: "Performance Camp", service: "camp" },
  { key: "homeschool", label: "Homeschool Athlete PE Program", service: "in_person" },
  { key: "unsure", label: "Not sure — I'd like guidance", service: "assessment" },
] as const satisfies ReadonlyArray<{ key: string; label: string; service: ServiceType }>

const SCHOLARSHIPS = ["FES-EO", "FES-UA", "PEP (Homeschool)", "FTC", "Not sure"] as const

const STEP_UP_FIELD_LABELS: Record<string, string> = {
  name: "Parent / Guardian name",
  email: "Email",
  phone: "Phone",
  service: "Service",
  sport: "Sport",
  goals: "Details",
}

const selectClass =
  "flex h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

const textareaClass =
  "flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"

export function StepUpInquiryForm() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrors>({})

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setServerFieldErrors({})

    const formData = new FormData(e.currentTarget)
    const name = (formData.get("name") as string)?.trim() ?? ""
    const email = (formData.get("email") as string)?.trim() ?? ""
    const phone = (formData.get("phone") as string)?.trim() ?? ""
    const athleteAge = (formData.get("athlete_age") as string)?.trim() ?? ""
    const sport = (formData.get("sport") as string)?.trim() ?? ""
    const scholarship = (formData.get("scholarship") as string)?.trim() ?? ""
    const serviceKey = (formData.get("service_key") as string) ?? ""
    const message = (formData.get("message") as string)?.trim() ?? ""

    const selected = SUFS_SERVICES.find((s) => s.key === serviceKey)
    if (!selected) {
      setFormError("Please select what you're interested in.")
      setServerFieldErrors({ service: ["Please select a service."] })
      return
    }

    // Compose a structured, human-readable summary so the coach sees the
    // scholarship type + true intent in the admin notification / email.
    const summaryLines = [
      "[Step Up For Students inquiry]",
      `Scholarship: ${scholarship || "Not specified"}`,
      athleteAge ? `Athlete age: ${athleteAge}` : null,
      `Interested in: ${selected.label}`,
    ].filter(Boolean) as string[]
    const goals = message ? `${summaryLines.join("\n")}\n\n${message}` : summaryLines.join("\n")

    const data = {
      name,
      email,
      phone,
      service: selected.service,
      sport,
      experience: "",
      goals,
      injuries: "",
      how_heard: "Step Up For Students page",
      gclid: readCookie("gclid"),
    }

    const result = inquiryFormSchema.safeParse(data)
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors
      setServerFieldErrors(flat as FieldErrors)
      setFormError("Please fix the highlighted fields below.")
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const { message: msg, fieldErrors: fe } = summarizeApiError(
          response,
          body,
          "We couldn't submit your enquiry. Please try again.",
        )
        setFormError(msg)
        setServerFieldErrors(fe)
        toast.error(msg)
        setIsSubmitting(false)
        return
      }

      // Conversion fires on the thank-you page (matches InquiryForm), so we
      // only count confirmed submissions.
      router.push("/application-received")
    } catch {
      const msg = "We couldn't reach our server. Please check your connection and try again."
      setFormError(msg)
      toast.error(msg)
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FormErrorBanner message={formError} fieldErrors={serverFieldErrors} labels={STEP_UP_FIELD_LABELS} />

      {/* Parent name + Email */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label htmlFor="sufs-name" className="text-sm font-medium text-primary">
            Parent / Guardian Name *
          </Label>
          <Input id="sufs-name" name="name" placeholder="Your name" required disabled={isSubmitting} className="h-11 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sufs-email" className="text-sm font-medium text-primary">
            Email *
          </Label>
          <Input
            id="sufs-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            disabled={isSubmitting}
            className="h-11 rounded-lg"
          />
        </div>
      </div>

      {/* Phone + Athlete age */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label htmlFor="sufs-phone" className="text-sm font-medium text-primary">
            Phone <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id="sufs-phone" name="phone" type="tel" placeholder="(555) 000-0000" disabled={isSubmitting} className="h-11 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sufs-age" className="text-sm font-medium text-primary">
            Athlete&apos;s Age <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id="sufs-age" name="athlete_age" placeholder="e.g. 14" disabled={isSubmitting} className="h-11 rounded-lg" />
        </div>
      </div>

      {/* Sport + Scholarship */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label htmlFor="sufs-sport" className="text-sm font-medium text-primary">
            Athlete&apos;s Sport <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id="sufs-sport" name="sport" placeholder="e.g. Soccer, Basketball" disabled={isSubmitting} className="h-11 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sufs-scholarship" className="text-sm font-medium text-primary">
            Scholarship Type <span className="text-muted-foreground font-normal">(if known)</span>
          </Label>
          <select id="sufs-scholarship" name="scholarship" disabled={isSubmitting} defaultValue="" className={selectClass}>
            <option value="">Select if known</option>
            {SCHOLARSHIPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Service */}
      <div className="space-y-2">
        <Label htmlFor="sufs-service" className="text-sm font-medium text-primary">
          What are you interested in? *
        </Label>
        <select id="sufs-service" name="service_key" required disabled={isSubmitting} defaultValue="" className={selectClass}>
          <option value="" disabled>
            Select a service
          </option>
          {SUFS_SERVICES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Message */}
      <div className="space-y-2">
        <Label htmlFor="sufs-message" className="text-sm font-medium text-primary">
          Anything else we should know? <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <textarea
          id="sufs-message"
          name="message"
          rows={4}
          placeholder="Goals, injury history, scheduling needs, questions about the scholarship process…"
          disabled={isSubmitting}
          className={textareaClass}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-primary px-8 py-3.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        {isSubmitting ? "Submitting…" : "Book My Free Step Up Consultation →"}
      </button>

      <p className="text-xs text-muted-foreground text-center leading-relaxed">
        No obligation, no upfront payment. We&apos;ll confirm your eligibility and walk you through every step before
        anything is booked. Coverage should be confirmed with Step Up For Students before booking.
      </p>
    </form>
  )
}
