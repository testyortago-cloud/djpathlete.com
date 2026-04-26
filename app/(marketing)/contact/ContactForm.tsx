"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"
import { contactFormSchema, type ContactFormData } from "@/lib/validators/contact"

const CONTACT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  subject: "Subject",
  message: "Message",
}

export function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof ContactFormData, string[]>>>({})
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
      subject: formData.get("subject") as string,
      message: formData.get("message") as string,
    }

    // Client-side validation
    const result = contactFormSchema.safeParse(data)
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors
      setErrors(flat)
      setServerFieldErrors(flat as FieldErrors)
      setFormError("Please fix the highlighted fields below.")
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(
          response,
          body,
          "We couldn't send your message. Please try again.",
        )
        setFormError(message)
        setServerFieldErrors(fe)
        toast.error(message)
        setIsSubmitting(false)
        return
      }

      toast.success("Message sent! We'll get back to you within 24 hours.")
      ;(e.target as HTMLFormElement).reset()
    } catch {
      const message = "We couldn't reach our server. Please check your connection and try again."
      setFormError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FormErrorBanner message={formError} fieldErrors={serverFieldErrors} labels={CONTACT_FIELD_LABELS} />
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium text-primary">
            Name
          </Label>
          <Input
            id="name"
            name="name"
            placeholder="Your name"
            required
            disabled={isSubmitting}
            className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name[0]}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-primary">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            disabled={isSubmitting}
            className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email[0]}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject" className="text-sm font-medium text-primary">
          Subject
        </Label>
        <Input
          id="subject"
          name="subject"
          placeholder="What can we help you with?"
          required
          disabled={isSubmitting}
          className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
        />
        {errors.subject && <p className="text-xs text-destructive">{errors.subject[0]}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="message" className="text-sm font-medium text-primary">
          Message
        </Label>
        <textarea
          id="message"
          name="message"
          rows={5}
          placeholder="Tell us about your goals, experience, and what you're looking for..."
          required
          disabled={isSubmitting}
          className="flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
        />
        {errors.message && <p className="text-xs text-destructive">{errors.message[0]}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full sm:w-auto rounded-full bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        {isSubmitting ? "Sending..." : "Send Message"}
      </button>
    </form>
  )
}
