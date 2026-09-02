// lib/calendly/env.ts — the four environment values Calendly needs, read once
// and typed, so every caller asks the same question and gets the same answer.
//
// THE ASSISTANT AND THE WEBHOOK ARE GATED SEPARATELY. Offering real times needs
// the token, the event type and the public booking page; receiving bookings
// needs the signing key. A half-configured install is common — the owner will
// paste the token before registering the webhook — and each half must degrade
// on its own: the assistant falls back to a plain link, the webhook answers
// 403 before reading the body.
//
// `CALENDLY_API_BASE` exists for one reason: the acceptance script points the
// running dev server at a local fixture server that answers the availability
// endpoint with recorded slots, so the end-to-end proof does not need a live
// Calendly account. It is not in .env.example on purpose — nothing but a test
// should ever set it.

export const CALENDLY_API_BASE_DEFAULT = "https://api.calendly.com"

export type CalendlyConfig = {
  apiToken: string
  /** `https://api.calendly.com/event_types/<uuid>` — the availability call's key. */
  eventTypeUri: string
  /** `https://calendly.com/<user>/<slug>` — the PUBLIC page a visitor can open. */
  schedulingUrl: string
  apiBase: string
}

type Env = Record<string, string | undefined>

function present(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

/** Everything the assistant needs to offer real times, or null if any of it is missing. */
export function readCalendlyConfig(env: Env = process.env): CalendlyConfig | null {
  const apiToken = present(env.CALENDLY_API_TOKEN)
  const eventTypeUri = present(env.CALENDLY_EVENT_TYPE_URI)
  const schedulingUrl = present(env.CALENDLY_SCHEDULING_URL)
  if (!apiToken || !eventTypeUri || !schedulingUrl) return null
  return {
    apiToken,
    eventTypeUri,
    schedulingUrl,
    apiBase: present(env.CALENDLY_API_BASE) ?? CALENDLY_API_BASE_DEFAULT,
  }
}

/** The public booking page alone — enough for a link, not for availability. */
export function readCalendlySchedulingUrl(env: Env = process.env): string | null {
  return present(env.CALENDLY_SCHEDULING_URL)
}

/** The webhook signing key, or null. The webhook route refuses everything without it. */
export function readCalendlySigningKey(env: Env = process.env): string | null {
  return present(env.CALENDLY_WEBHOOK_SIGNING_KEY)
}
