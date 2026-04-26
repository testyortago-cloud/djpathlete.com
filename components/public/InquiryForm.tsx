"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CheckCircle2 } from "lucide-react"
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

interface InquiryFormProps {
  /** Pre-select the service type based on which page the form is on */
  defaultService?: ServiceType
  /** Heading to show above the form */
  heading?: string
  /** Description below the heading */
  description?: string
}

export function InquiryForm({
  defaultService,
  heading = "Apply Now",
  description = "Tell us about yourself and your goals. We review every application and respond within 48 hours.",
}: InquiryFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
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

      setIsSubmitted(true)
      toast.success("Application submitted!")
    } catch {
      const message = "We couldn't reach our server. Please check your connection and try again."
      setFormError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSubmitted) {
    return (
      <div className="text-center py-12">
        <div className="flex size-16 items-center justify-center rounded-full bg-success/10 mx-auto mb-4">
          <CheckCircle2 className="size-8 text-success" />
        </div>
        <h3 className="text-xl font-heading font-semibold text-primary mb-2">Application Received</h3>
        <p className="text-muted-foreground max-w-md mx-auto">
          Thank you for your interest. We review every application personally and will be in touch within 48 hours.
        </p>
      </div>
    )
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
