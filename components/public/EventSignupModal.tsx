"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

const SIGNUP_FIELD_LABELS: Record<string, string> = {
  parent_name: "Parent name",
  parent_email: "Parent email",
  parent_phone: "Parent phone",
  athlete_name: "Athlete name",
  athlete_age: "Athlete age",
  sport: "Sport",
  notes: "Notes",
  waiver_accepted: "Liability waiver",
}

export interface EventSignupModalEvent {
  id: string
  title: string
  type: "clinic" | "camp"
  capacity: number
  signup_count: number
  stripe_price_id?: string | null
  price_cents?: number | null
}

interface EventSignupModalProps {
  event: EventSignupModalEvent
  open: boolean
  onOpenChange: (open: boolean) => void
  isWaitlist?: boolean
  /** Which path the user picked from the card. Defaults to "paid" when the
   *  event has a stripe_price_id; otherwise "interest". */
  intent?: "paid" | "interest"
  /** Pre-rendered HTML of the active liability waiver. When null, we fall
   *  back to a short notice and still require the parent to acknowledge — the
   *  server records the consent regardless of which document was shown. */
  waiverContent: string | null
}

type Phase = "form" | "submitting" | "success" | "at_capacity"

export function EventSignupModal({
  event,
  open,
  onOpenChange,
  isWaitlist,
  intent = "paid",
  waiverContent,
}: EventSignupModalProps) {
  const [phase, setPhase] = useState<Phase>("form")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [forcedWaitlist, setForcedWaitlist] = useState(false)
  const [waiverAccepted, setWaiverAccepted] = useState(false)

  const isPaidFlow = intent === "paid" && !!event.stripe_price_id && !isWaitlist && !forcedWaitlist

  async function submit(e: React.FormEvent<HTMLFormElement>, waitlist: boolean) {
    e.preventDefault()
    setPhase("submitting")
    setFieldErrors({})
    setFormError(null)

    const form = new FormData(e.currentTarget)
    const website = form.get("website") // honeypot — we still send it; the server decides

    const body = {
      website: typeof website === "string" ? website : "",
      parent_name: String(form.get("parent_name") ?? ""),
      parent_email: String(form.get("parent_email") ?? ""),
      parent_phone: form.get("parent_phone") ? String(form.get("parent_phone")) : null,
      athlete_name: String(form.get("athlete_name") ?? ""),
      athlete_age: Number(form.get("athlete_age") ?? 0),
      sport: form.get("sport") ? String(form.get("sport")) : null,
      notes: form.get("notes") ? String(form.get("notes")) : null,
      waiver_accepted: waiverAccepted,
    }

    const query = waitlist || isWaitlist || forcedWaitlist ? "?waitlist=true" : ""
    const url = isPaidFlow && !query ? `/api/events/${event.id}/checkout` : `/api/events/${event.id}/signup${query}`

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data.error === "at_capacity") {
        setPhase("at_capacity")
        return
      }
      if (!res.ok) {
        const { message, fieldErrors: fe } = summarizeApiError(
          res,
          data,
          waitlist || isWaitlist || forcedWaitlist
            ? "We couldn't add you to the waitlist. Please try again."
            : "We couldn't submit your signup. Please try again.",
        )
        setFieldErrors(fe)
        setFormError(message)
        setPhase("form")
        return
      }

      // Paid flow: data.sessionUrl points at Stripe — redirect.
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl
        return
      }

      setPhase("success")
    } catch {
      setFormError("We couldn't reach our server. Please check your connection and try again.")
      setPhase("form")
    }
  }

  function resetAndClose() {
    setPhase("form")
    setFieldErrors({})
    setFormError(null)
    setForcedWaitlist(false)
    setWaiverAccepted(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isWaitlist || forcedWaitlist
              ? "Join the waitlist"
              : isPaidFlow
                ? "Reserve your spot"
                : "Register your interest"}
          </DialogTitle>
          <DialogDescription>
            {isWaitlist || forcedWaitlist
              ? `${event.title} is currently full. Leave your details and we'll reach out if a spot opens.`
              : isPaidFlow
                ? `${event.title} — fill in your details to proceed to secure payment.`
                : `${event.title} — tell us about the athlete and we'll follow up within 48 hours.`}
          </DialogDescription>
        </DialogHeader>

        {phase === "success" ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
            <p className="text-lg font-semibold">We'll be in touch within 48 hours.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Thanks for your interest. Darren reviews every signup personally.
            </p>
            <Button className="mt-6" onClick={resetAndClose}>
              Close
            </Button>
          </div>
        ) : phase === "at_capacity" ? (
          <div className="py-6 text-center">
            <p className="text-lg font-semibold">Sorry — this event just filled up.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Join the waitlist and we'll contact you if a spot opens.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" onClick={resetAndClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setForcedWaitlist(true)
                  setPhase("form")
                }}
              >
                Continue to waitlist
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => submit(e, false)} className="space-y-4">
            {/* Honeypot */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute opacity-0 pointer-events-none h-0 w-0"
            />

            <FormErrorBanner message={formError} fieldErrors={fieldErrors} labels={SIGNUP_FIELD_LABELS} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="parent_name">Parent full name</Label>
                <Input id="parent_name" name="parent_name" required maxLength={100} />
                {fieldErrors.parent_name && <p className="text-xs text-destructive">{fieldErrors.parent_name[0]}</p>}
              </div>
              <div>
                <Label htmlFor="parent_email">Parent email</Label>
                <Input id="parent_email" name="parent_email" type="email" required />
                {fieldErrors.parent_email && <p className="text-xs text-destructive">{fieldErrors.parent_email[0]}</p>}
              </div>
            </div>

            <div>
              <Label htmlFor="parent_phone">Parent phone (optional)</Label>
              <Input id="parent_phone" name="parent_phone" type="tel" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="athlete_name">Athlete full name</Label>
                <Input id="athlete_name" name="athlete_name" required maxLength={100} />
              </div>
              <div>
                <Label htmlFor="athlete_age">Athlete age</Label>
                <Input id="athlete_age" name="athlete_age" type="number" min={0} required />
                {fieldErrors.athlete_age && <p className="text-xs text-destructive">{fieldErrors.athlete_age[0]}</p>}
              </div>
            </div>

            <div>
              <Label htmlFor="sport">Sport (optional)</Label>
              <Input id="sport" name="sport" maxLength={60} />
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" name="notes" rows={3} maxLength={1000} />
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Liability Waiver & Disclaimer</p>
              </div>
              {waiverContent ? (
                <div
                  className="max-h-44 overflow-y-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground [&_h2]:mt-3 [&_h2]:font-heading [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-2 [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:list-disc [&_li]:ml-4 [&_p]:mt-2 [&_strong]:text-foreground"
                  dangerouslySetInnerHTML={{ __html: waiverContent }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Participation in DJP Athlete clinics and camps involves inherent physical risk. The parent or legal
                  guardian assumes responsibility for the athlete and confirms they are fit to participate. Read the
                  full{" "}
                  <Link href="/liability-waiver" target="_blank" className="text-primary underline">
                    Liability Waiver & Disclaimer
                  </Link>
                  .
                </p>
              )}
              <div className="mt-3 flex items-start gap-2">
                <Checkbox
                  id="waiver_accepted"
                  checked={waiverAccepted}
                  onCheckedChange={(v) => setWaiverAccepted(v === true)}
                  className="mt-0.5"
                  required
                />
                <Label htmlFor="waiver_accepted" className="text-xs leading-relaxed cursor-pointer">
                  As parent or legal guardian, I have read, understood, and agree to the Liability Waiver & Disclaimer
                  on behalf of the athlete named above.
                </Label>
              </div>
              {fieldErrors.waiver_accepted && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.waiver_accepted[0]}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={resetAndClose} disabled={phase === "submitting"}>
                Cancel
              </Button>
              <Button type="submit" disabled={phase === "submitting" || !waiverAccepted}>
                {phase === "submitting"
                  ? "Submitting..."
                  : isWaitlist || forcedWaitlist
                    ? "Join waitlist"
                    : isPaidFlow
                      ? "Continue to payment"
                      : "Submit"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
