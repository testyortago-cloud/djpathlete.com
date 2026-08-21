"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"
import {
  inquiryFormSchema,
  SERVICE_LABELS,
  SERVICE_TYPES,
  type InquiryFormData,
  type ServiceType,
} from "@/lib/validators/inquiry"

/** Read a single cookie by name. Returns "" when absent. */
function readCookie(name: string): string {
  if (typeof document === "undefined") return ""
  const match = document.cookie.split("; ").find((r) => r.startsWith(name + "="))
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : ""
}

const INQUIRY_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  service: "Service",
  sport: "Sport",
  experience: "Experience",
  goals: "Goals",
  injuries: "Injuries",
  how_heard: "How heard",
}

const EXPERIENCE_OPTIONS = [
  { value: "beginner", label: "Less than 1 year" },
  { value: "intermediate", label: "1-3 years" },
  { value: "advanced", label: "3-10 years" },
  { value: "elite", label: "10+ years" },
]

const selectClass =
  "flex h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

const textareaClass =
  "flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"

interface InquiryFormClientProps {
  /** Pre-select the service type based on which page the form is on */
  defaultService?: ServiceType
  /** Heading to show above the form */
  heading?: string
  /** Description below the heading */
  description?: string
  /**
   * The SMS opt-in sentence, already rendered server-side (`renderSmsConsentWording`
   * fed `business_settings.display_name`) by the `InquiryForm` server wrapper
   * — never built here, so the wording the visitor ticks against is the exact
   * string the route re-renders into `contact_consents.wording_shown`.
   *
   * `undefined` whenever the business has no usable name — a failed settings
   * read or a blank `display_name` (`hasSmsConsentDisplayName` in
   * sms-consent-wording.ts) both collapse to the same "no wording" outcome
   * rather than one of them rendering a checkbox over a sentence with a hole
   * in it. Either way this renders no checkbox at all — the same "no pixel,
   * no prop" contract the funnel form island's `smsConsentWording` follows.
   */
  smsConsentWording?: string
}

export function InquiryFormClient({
  defaultService,
  heading = "Apply Now",
  description = "Tell us about yourself and your goals. We review every application and respond within 48 hours.",
  smsConsentWording,
}: InquiryFormClientProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof InquiryFormData, string[]>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrors>({})

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    setFormError(null)
    setServerFieldErrors({})

    const formData = new FormData(e.currentTarget)
    const data = {
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      phone: formData.get("phone") as string,
      service: formData.get("service") as string,
      sport: formData.get("sport") as string,
      experience: formData.get("experience") as string,
      goals: formData.get("goals") as string,
      injuries: formData.get("injuries") as string,
      how_heard: formData.get("how_heard") as string,
      gclid: readCookie("gclid"),
      // Unchecked boxes are simply absent from FormData, so the literal "on"
      // (the browser default value for a checkbox with no `value` attribute)
      // is what a tick actually posts — never truthiness of the raw string,
      // since a present-but-empty entry would otherwise read as true.
      sms_consent: formData.get("sms_consent") === "on",
    }

    const result = inquiryFormSchema.safeParse(data)
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors
      setErrors(flat)
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
        const { message, fieldErrors: fe } = summarizeApiError(
          response,
          body,
          "We couldn't submit your application. Please try again.",
        )
        setFormError(message)
        setServerFieldErrors(fe)
        toast.error(message)
        setIsSubmitting(false)
        return
      }

      // Send the user to the dedicated thank-you page. The conversion event
      // fires there (via ConversionTracker), not here — so we only count
      // successful submissions, not optimistic button clicks.
      router.push("/application-received")
    } catch {
      const message = "We couldn't reach our server. Please check your connection and try again."
      setFormError(message)
      toast.error(message)
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-xl font-heading font-semibold text-primary mb-1">{heading}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <FormErrorBanner message={formError} fieldErrors={serverFieldErrors} labels={INQUIRY_FIELD_LABELS} />
        {/* Name + Email */}
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="inq-name" className="text-sm font-medium text-primary">
              Full Name *
            </Label>
            <Input
              id="inq-name"
              name="name"
              placeholder="Your full name"
              required
              disabled={isSubmitting}
              className="h-11 rounded-lg"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name[0]}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="inq-email" className="text-sm font-medium text-primary">
              Email *
            </Label>
            <Input
              id="inq-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              disabled={isSubmitting}
              className="h-11 rounded-lg"
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email[0]}</p>}
          </div>
        </div>

        {/* Phone + Service */}
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="inq-phone" className="text-sm font-medium text-primary">
              Phone <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="inq-phone"
              name="phone"
              type="tel"
              placeholder="+1 (555) 000-0000"
              disabled={isSubmitting}
              className="h-11 rounded-lg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inq-service" className="text-sm font-medium text-primary">
              Service *
            </Label>
            <select
              id="inq-service"
              name="service"
              required
              disabled={isSubmitting}
              defaultValue={defaultService ?? ""}
              className={selectClass}
            >
              <option value="" disabled>
                Select a service
              </option>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABELS[s]}
                </option>
              ))}
            </select>
            {errors.service && <p className="text-xs text-destructive">{errors.service[0]}</p>}
          </div>
        </div>

        {/* SMS opt-in checkbox, under the phone field, UNCHECKED by default.
            `smsConsentWording` is undefined whenever the `InquiryForm` server
            wrapper found no usable business name to fetch — a failed
            settings read and a blank display_name both collapse to no prop,
            so this renders no checkbox at all rather than one over a
            sentence with a hole in it. */}
        {smsConsentWording ? (
          <label
            htmlFor="inq-sms-consent"
            className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed cursor-pointer"
          >
            <input
              id="inq-sms-consent"
              name="sms_consent"
              type="checkbox"
              disabled={isSubmitting}
              defaultChecked={false}
              className="mt-0.5 size-4 accent-primary shrink-0"
            />
            <span>{smsConsentWording}</span>
          </label>
        ) : null}

        {/* Sport + Experience */}
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="inq-sport" className="text-sm font-medium text-primary">
              Sport / Activity <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="inq-sport"
              name="sport"
              placeholder="e.g. Tennis, CrossFit, Soccer"
              disabled={isSubmitting}
              className="h-11 rounded-lg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inq-experience" className="text-sm font-medium text-primary">
              Training Experience
            </Label>
            <select
              id="inq-experience"
              name="experience"
              disabled={isSubmitting}
              defaultValue=""
              className={selectClass}
            >
              <option value="">Select experience level</option>
              {EXPERIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Goals */}
        <div className="space-y-2">
          <Label htmlFor="inq-goals" className="text-sm font-medium text-primary">
            Goals & What You Are Looking For *
          </Label>
          <textarea
            id="inq-goals"
            name="goals"
            rows={4}
            required
            placeholder="Tell us about your training goals, current situation, and what you hope to achieve..."
            disabled={isSubmitting}
            className={textareaClass}
          />
          {errors.goals && <p className="text-xs text-destructive">{errors.goals[0]}</p>}
        </div>

        {/* Injuries */}
        <div className="space-y-2">
          <Label htmlFor="inq-injuries" className="text-sm font-medium text-primary">
            Injuries or Limitations <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <textarea
            id="inq-injuries"
            name="injuries"
            rows={2}
            placeholder="Any current or past injuries we should know about..."
            disabled={isSubmitting}
            className={textareaClass}
          />
        </div>

        {/* How heard */}
        <div className="space-y-2">
          <Label htmlFor="inq-how-heard" className="text-sm font-medium text-primary">
            How did you hear about us? <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="inq-how-heard"
            name="how_heard"
            placeholder="e.g. Instagram, referral, Google"
            disabled={isSubmitting}
            className="h-11 rounded-lg"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full bg-primary px-8 py-3.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          {isSubmitting ? "Submitting..." : "Submit Application"}
        </button>

        <p className="text-xs text-muted-foreground text-center">
          We review every application personally. Expect a response within 48 hours.
        </p>
      </form>
    </div>
  )
}
