"use client"

import { useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

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
}

type Phase = "form" | "submitting" | "success" | "at_capacity"

export function EventSignupModal({ event, open, onOpenChange, isWaitlist }: EventSignupModalProps) {
  const [phase, setPhase] = useState<Phase>("form")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [forcedWaitlist, setForcedWaitlist] = useState(false)

  const isPaidFlow =
    event.type === "camp" &&
    !!event.stripe_price_id &&
    !isWaitlist &&
    !forcedWaitlist

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
    }

    const query = waitlist || isWaitlist || forcedWaitlist ? "?waitlist=true" : ""
    const url = isPaidFlow && !query
      ? `/api/events/${event.id}/checkout`
      : `/api/events/${event.id}/signup${query}`

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
        if (data.fieldErrors) setFieldErrors(data.fieldErrors)
        setFormError(data.error ?? "Something went wrong")
        setPhase("form")
        return
      }

      // Paid flow: data.sessionUrl points at Stripe — redirect.
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl
        return
      }

      setPhase("success")
    } catch (err) {
      setFormError((err as Error).message)
      setPhase("form")
    }
  }

  function resetAndClose() {
    setPhase("form")
    setFieldErrors({})
    setFormError(null)
    setForcedWaitlist(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isWaitlist || forcedWaitlist ? "Join the waitlist" : "Register your interest"}</DialogTitle>
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

            {formError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}

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
                <Input id="athlete_age" name="athlete_age" type="number" min={6} max={21} required />
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

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={resetAndClose} disabled={phase === "submitting"}>
                Cancel
              </Button>
              <Button type="submit" disabled={phase === "submitting"}>
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
