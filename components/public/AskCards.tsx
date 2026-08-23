"use client"

// components/public/AskCards.tsx — the typed values the server sent, drawn.
//
// THIS FILE RENDERS; IT DOES NOT DERIVE. That is the client half of Layer 1
// (spec §4.1): prices, dates and availability reach the visitor as `Card`s the
// server built out of rows it actually read, so the common path never needs
// the model to type a digit and therefore cannot carry a fabricated one. The
// moment this file works something out — a weekly rate, a saving, a "from"
// price, a days-until countdown — that number is one nothing validated, and
// the whole chain of custody is gone.
//
// So there are exactly two transformations here, and both are formatting:
//
//   * MONEY. `Intl.NumberFormat` over the server's integer cents, through the
//     repo's one money formatter. `null` is "we have not published a price",
//     which is a different answer from "$0.00" and from "free".
//
//   * DATES. Through `lib/events/format.ts`, the same formatter /camps and
//     /clinics use — which pins `timeZone: "UTC"` because event datetimes are
//     stored as WALL-CLOCK UTC. Formatting them in the viewer's local zone
//     would show a camp starting at a time nobody typed, and sometimes on the
//     day before. Every digit would still have come from the database and the
//     answer would still be wrong.
//
// `Card` is IMPORTED from lib/lead-engine/chat/tools.ts, never re-declared. A
// parallel shape here is how "renders only values the server sent" quietly
// stops being checkable.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md
//       §4.1, §4.2, §5.1

import Link from "next/link"
import { useId, useState } from "react"
import { ArrowRight, CalendarDays, MapPin } from "lucide-react"

import { formatCents } from "@/lib/bookkeeping/money"
import { formatEventWhen } from "@/lib/events/format"
import {
  hasChatConsentDisplayName,
  renderChatContactWording,
  renderChatMarketingWording,
} from "@/lib/lead-engine/chat/consent-wording"
import type { Card } from "@/lib/lead-engine/chat/tools"
import type { EventType } from "@/types/database"

/**
 * Only tokens `.dark` actually redefines in app/globals.css are used for
 * colour here. `--surface`, `--success`, `--warning` and `--error` are declared
 * on `:root` only, so a panel painted with `bg-surface` would stay light-on-
 * light the moment the site is in dark mode.
 */
const CARD_SHELL = "rounded-xl border border-border bg-card text-card-foreground p-4 shadow-sm"

/** `null` means no published price. Never "$0.00", never "free". */
function priceLabel(priceCents: number | null): string | null {
  return priceCents === null ? null : formatCents(priceCents)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * `programs.payment_type` is a three-value enum (`PaymentType`), widened to
 * `string` on the way through the facts layer. An unrecognised value falls
 * through as itself rather than being guessed at — a wrong billing label is a
 * fabricated fact even though it carries no digits.
 */
const PAYMENT_LABELS: Record<string, string> = {
  free: "No charge",
  one_time: "One-time payment",
  subscription: "Subscription",
}

function ProgrammeCard({ card }: { card: Extract<Card, { kind: "programme" }> }) {
  const price = priceLabel(card.priceCents)

  return (
    <div className={CARD_SHELL}>
      <p className="font-heading text-base font-semibold">{card.name}</p>
      <p className="mt-1 text-2xl font-semibold text-primary">
        {price ?? <span className="text-base font-normal text-muted-foreground">The price isn&apos;t published.</span>}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted-foreground">
        <div>
          <dt className="sr-only">Length</dt>
          <dd>{plural(card.durationWeeks, "week", "weeks")}</dd>
        </div>
        <div>
          <dt className="sr-only">Frequency</dt>
          <dd>{plural(card.sessionsPerWeek, "session a week", "sessions a week")}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">{PAYMENT_LABELS[card.paymentType] ?? card.paymentType}</p>
    </div>
  )
}

function EventCard({ card }: { card: Extract<Card, { kind: "event" }> }) {
  const price = priceLabel(card.priceCents)
  // `events.type` is CHECK-constrained to exactly these two in migration
  // 00062; the facts layer widened it to `string` on the way past.
  const type: EventType = card.type === "clinic" ? "clinic" : "camp"

  return (
    <div className={CARD_SHELL}>
      <p className="font-heading text-base font-semibold">{card.title}</p>
      <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
        <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{formatEventWhen({ type, start_date: card.startDate, end_date: card.endDate })}</span>
      </p>
      <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{card.locationName}</span>
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-xl font-semibold text-primary">
          {price ?? (
            <span className="text-base font-normal text-muted-foreground">The price isn&apos;t published.</span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          {card.soldOut ? "No places left" : `${plural(card.spotsLeft, "place", "places")} left`}
        </span>
      </div>
    </div>
  )
}

function ConsultCard({ card }: { card: Extract<Card, { kind: "consult" }> }) {
  return (
    <div className={CARD_SHELL}>
      <p className="text-sm text-muted-foreground">
        Nothing is booked yet. This is the page where a consultation is arranged.
      </p>
      <Link
        href={card.href}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Book a consultation
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  )
}

type CaptureState = "idle" | "sending" | "saved"

/**
 * The details form — the ONE thing on this surface that can write anything,
 * and only when the visitor themselves submits it. `capture_lead` put this on
 * screen and saved nothing; `POST /api/ask/capture` is the only path in the
 * feature that creates a contact.
 *
 * THE MARKETING TICK IS GATED ON `hasChatConsentDisplayName`, which is the
 * same function `/api/ask/capture` asks before it will file a
 * `contact_consents` row. `business_settings.display_name` is `''` in
 * production and in the dev clone, so NO TICK is the default state, not an
 * edge case: consent to hear from a business the sentence cannot name is
 * consent to nothing. One function on both sides means the sentence shown and
 * the sentence filed can never disagree.
 *
 * The untouched inputs post `""`, and that is deliberate. `blankToUndefined`
 * in lib/validators/chat.ts already treats blank as ABSENT, so stripping them
 * here would be a second copy of a rule that already exists — and two copies
 * of a rule are two things that can drift.
 */
function CaptureCard({
  card,
  conversationId,
  displayName,
}: {
  card: Extract<Card, { kind: "capture" }>
  conversationId: string | null
  displayName: string
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [state, setState] = useState<CaptureState>("idle")
  const [notice, setNotice] = useState<string | null>(null)
  const [marketingRecorded, setMarketingRecorded] = useState(false)
  // Unique per card instance: a conversation can in principle carry more than
  // one details card, and two inputs sharing an id makes the second label
  // point at the first checkbox.
  const consentId = useId()

  const named = hasChatConsentDisplayName(displayName)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (state === "sending" || state === "saved" || !conversationId) return

    setState("sending")
    setNotice(null)
    try {
      const response = await fetch("/api/ask/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, name, email, phone, marketingConsent }),
      })
      const body = (await response.json()) as { error?: string; marketingConsentRecorded?: boolean }

      if (!response.ok) {
        // The route's own copy, written for someone who has just typed their
        // name in. Never a status code and never a field name.
        setNotice(typeof body.error === "string" ? body.error : "Please try that again in a moment.")
        setState("idle")
        return
      }

      // What ACTUALLY happened, not what was asked for. A tick that filed no
      // row must not turn into a promise of email.
      setMarketingRecorded(body.marketingConsentRecorded === true)
      setState("saved")
    } catch {
      setNotice("I couldn't send that just then. Try again in a moment.")
      setState("idle")
    }
  }

  if (state === "saved") {
    return (
      <div className={CARD_SHELL}>
        <p className="text-sm font-medium">Thanks — someone has your details now.</p>
        {marketingRecorded ? (
          <p className="mt-1 text-sm text-muted-foreground">
            You&apos;ll also hear about coaching, camps and clinics. You can unsubscribe at any time.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className={CARD_SHELL}>
      <p className="text-sm font-medium">Leave your details</p>
      {/* `card.reason` is DELIBERATELY NOT RENDERED. It is the one model-authored
          string on any card, and the output validator never sees card fields —
          only the assistant's text. The route already redacts it via
          visitorSafeCards(); this is the second lock, so a future change to the
          response shape cannot quietly put model prose back on the screen. */}
      <p className="mt-1 text-sm text-muted-foreground">
        Leave your name and a way to reach you, and someone will get back to you.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          <span className="text-muted-foreground">Your name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            autoComplete="name"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Email address</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Phone number</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
            autoComplete="tel"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {named
          ? renderChatContactWording(displayName)
          : "Sending this asks for someone to get in touch with you about your question."}
      </p>

      {/* No name, no tick — the same verdict /api/ask/capture reaches before
          it will file a consent row. */}
      {named ? (
        <label
          htmlFor={consentId}
          className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground"
        >
          <input
            id={consentId}
            name="ask-marketing-consent"
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>{renderChatMarketingWording(displayName)}</span>
        </label>
      ) : null}

      {notice ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-4 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        Send my details
      </button>
    </form>
  )
}

/** One renderer per kind. The switch is exhaustive, so a new kind is a compile error. */
export function AskCard({
  card,
  conversationId,
  displayName,
}: {
  card: Card
  conversationId: string | null
  displayName: string
}) {
  switch (card.kind) {
    case "programme":
      return <ProgrammeCard card={card} />
    case "event":
      return <EventCard card={card} />
    case "consult":
      return <ConsultCard card={card} />
    case "capture":
      return <CaptureCard card={card} conversationId={conversationId} displayName={displayName} />
  }
}
