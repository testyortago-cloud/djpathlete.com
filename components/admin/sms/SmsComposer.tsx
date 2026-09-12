"use client"

// components/admin/sms/SmsComposer.tsx — the box you type a text into.
//
// THREE DECISIONS ARE ENCODED HERE, and each is a rule whose opposite looks
// like a simplification:
//
// 1. QUIET HOURS WARN, THEY NEVER BLOCK. If it is late where the CONTACT is,
//    the first click asks and does not send; the second sends and passes
//    `confirmQuietHours: true`, which the route records on the audit row
//    ("the admin was warned and sent anyway" is a real business event). It
//    does not queue the message for the morning and it does not refuse it:
//    the coach knows things this box does not, and a text that had to wait
//    eight hours is frequently worse than a text sent at 11pm.
//
// 2. A SUPPRESSED NUMBER CAN NEVER BE TEXTED. The box is disabled and says
//    why. THE ROUTE REFUSES TOO — that is deliberate defence in depth, not
//    duplication, and neither half may be removed on the grounds that the
//    other exists. "A guard on the client path is not a guard": this
//    component is what a person sees, `assertSmsSendable` is what actually
//    stops the send.
//
// 3. THE OPT-OUT SENTENCE IS THE SERVER'S DECISION. `sendManualSms` appends
//    it on the first outbound to a number in a rolling 30 days. This box
//    never appends it and never shows it in the draft — a box that appended
//    it client-side would double it up the moment the server did too, and
//    would get the 30-day question wrong besides, because it cannot see the
//    history.
//
// The segment counter comes from `@/lib/lead-engine/sms-segments`, which is
// the same function the route bills against — split out of sms.ts precisely
// so a client component can import it without dragging lib/supabase (and
// therefore next/headers) into the browser bundle.
//
// Light-only, like the rest of the admin.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { countSmsSegments } from "@/lib/lead-engine/sms-segments"

/** What the box hands to whoever is doing the sending. */
export type SmsComposeSubmission = {
  body: string
  /** True only after the admin was warned about the hour and clicked again. */
  confirmQuietHours: boolean
}

export interface SmsComposerProps {
  phone: string
  contactId: string | null
  /** For the warning copy — falls back to the number when nobody matches. */
  contactName?: string | null
  /** They replied STOP, or are otherwise on the suppression list. */
  suppressed: boolean
  /**
   * The hour (0-23) where the CONTACT is, as of the server render. Computed
   * on the server so it agrees with the timezone the sequence engine would
   * have used (`resolveTimezone`: the contact's own, else the business's).
   *
   * It does not tick. A page left open past midnight keeps the hour it was
   * rendered with, which at worst means the warning appears or does not
   * appear one hour late — the warning is advisory and the send is never
   * blocked either way, so a stale hour costs nothing a refresh does not fix.
   */
  contactLocalHour: number
  contactTimezone: string
  /** The tenant's allowed window, matching `business_settings`. */
  quietHoursStart?: number
  quietHoursEnd?: number
  /** No Twilio sender on this business — the route answers 503. */
  notConfigured?: boolean
  /** Injected by tests; production uses the internal POST below. */
  onSend?: (submission: SmsComposeSubmission) => void | Promise<void>
}

/**
 * Is `hour` OUTSIDE the allowed window `[start, end)`?
 *
 * Same window semantics as `quietHoursDefer` (lib/lead-engine/guardrails.ts),
 * including a window where `start >= end` wrapping midnight. Re-expressed on a
 * bare hour rather than imported because that function answers a different
 * question — "when does the window next open", which needs a Date and a
 * timezone database — and this one only has to colour a button.
 */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  const wraps = start >= end
  const allowed = wraps ? hour >= start || hour < end : hour >= start && hour < end
  return !allowed
}

/** 23 -> "11pm", 0 -> "12am", 14 -> "2pm". */
function formatHour(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm"
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${suffix}`
}

export function SmsComposer({
  phone,
  contactId,
  contactName,
  suppressed,
  contactLocalHour,
  contactTimezone,
  quietHoursStart = 8,
  quietHoursEnd = 21,
  notConfigured = false,
  onSend,
}: SmsComposerProps) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [warned, setWarned] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set only when the route reports `warning`: the text DID send, but the
  // post-send record write failed, so it may not show up below. Distinct
  // from `error` — this is not a failed send, and must not read as one.
  const [warning, setWarning] = useState<string | null>(null)

  const who = contactName ?? phone
  const counted = countSmsSegments(body)
  const quiet = isQuietHour(contactLocalHour, quietHoursStart, quietHoursEnd)
  const blocked = suppressed || notConfigured
  const canSend = !blocked && !sending && body.trim().length > 0

  async function post(submission: SmsComposeSubmission): Promise<{ warning?: string }> {
    const response = await fetch("/api/admin/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        body: submission.body,
        ...(contactId ? { contactId } : {}),
        confirmQuietHours: submission.confirmQuietHours,
      }),
    })
    const payload = (await response.json().catch(() => null)) as { error?: string; warning?: string } | null
    if (!response.ok) {
      throw new Error(payload?.error ?? "That text did not send. Try again in a moment.")
    }
    return { warning: payload?.warning }
  }

  async function handleSend() {
    if (!canSend) return

    // Decision 1. The FIRST click during quiet hours warns and returns
    // without sending. Moving the send above this check is the whole bug.
    if (quiet && !warned) {
      setWarned(true)
      return
    }

    setSending(true)
    setError(null)
    setWarning(null)
    try {
      if (onSend) {
        await onSend({ body, confirmQuietHours: warned })
      } else {
        const result = await post({ body, confirmQuietHours: warned })
        if (result.warning) setWarning(result.warning)
      }
      setBody("")
      setWarned(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "That text did not send.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      {suppressed ? (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {who} has opted out of texts from you. You cannot message this number. They can start again by texting
            START.
          </span>
        </p>
      ) : null}

      {notConfigured && !suppressed ? (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/10 p-3 text-sm text-accent">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Texting is not set up for this business yet. Add a text sender in Settings and this box will switch on.
          </span>
        </p>
      ) : null}

      <label htmlFor="sms-compose-body" className="sr-only">
        Your message
      </label>
      <Textarea
        id="sms-compose-body"
        value={body}
        disabled={blocked}
        onChange={(event) => {
          setBody(event.target.value)
          // A rewritten message has not been warned about yet. Re-arming the
          // warning is the honest behaviour: the second click confirms the
          // message the admin actually read the warning for.
          setWarned(false)
          setError(null)
          setWarning(null)
        }}
        placeholder={blocked ? "" : `Write a text to ${who}…`}
        rows={3}
        className="resize-y"
      />

      <p className="mt-2 text-xs text-muted-foreground">
        {counted.characters} characters · {counted.segments} {counted.segments === 1 ? "segment" : "segments"}
      </p>

      {counted.encoding === "UCS-2" ? (
        <p className="mt-1 text-xs text-accent">
          An emoji or special character switched this to UCS-2, so each text now holds {counted.perSegment} characters
          instead of 160.
        </p>
      ) : null}

      {warned && quiet && !blocked ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/10 p-3 text-sm text-accent">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            It is {formatHour(contactLocalHour)} for {who} ({contactTimezone}). That is late for a text. Click again to
            send it regardless.
          </span>
        </p>
      ) : null}

      {warning ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/10 p-3 text-sm text-accent">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{warning}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button type="button" onClick={handleSend} disabled={!canSend}>
          {sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
          {/* The two states carry DIFFERENT names on purpose: a test cannot
              tell two controls with the same accessible name apart, and more
              to the point neither can a screen reader user being asked to
              confirm something. */}
          {warned && quiet ? "Send anyway" : "Send"}
        </Button>
        {warned && quiet && !blocked ? (
          <Button type="button" variant="ghost" onClick={() => setWarned(false)}>
            Not now
          </Button>
        ) : null}
      </div>
    </div>
  )
}
