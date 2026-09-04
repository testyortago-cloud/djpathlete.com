import { encodeTracking, TRACKING_MEDIUM_PAGE } from "@/lib/calendly/tracking"

// lib/calendly/links.ts — builds the link a visitor clicks to book.
//
// PREFILL IS THE WHOLE POINT. The assistant already knows who it is talking
// to (the details card wrote a contact); Calendly's booking form accepts
// `?name=` and `?email=` and pre-populates its fields from them. Without that
// the visitor retypes, the email/phone match on the webhook misses, and the
// booking creates a DUPLICATE contact for the person who was just on the site.
// That failure is silent, which is why this file exists rather than a
// hand-built string in the tool.
//
// It works on BOTH kinds of URL Calendly hands us: the event type's public
// page (`https://calendly.com/<user>/<slug>`) and a per-slot `scheduling_url`
// from the availability endpoint, which already carries `?month=&date=`.
// Existing parameters are preserved; ours are added.
//
// UTM PARAMETERS COME BACK ON THE WEBHOOK under `payload.tracking`, which
// Calendly documents as the way to carry "custom data like user IDs" through a
// booking. lib/calendly/tracking.ts decides what goes in them.

export type Prefill = {
  name?: string | null
  email?: string | null
}

export type SchedulingLinkOptions = {
  prefill?: Prefill | null
  /** Already-encoded tracking parameters, e.g. from `encodeTracking`. */
  tracking?: Record<string, string> | null
}

/** `url` with prefill and tracking appended. Returns `url` unchanged if it is not an absolute https URL. */
export function schedulingLink(url: string, options: SchedulingLinkOptions = {}): string {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return url
  }
  if (target.protocol !== "https:") return url

  const name = options.prefill?.name?.trim()
  const email = options.prefill?.email?.trim()
  if (name) target.searchParams.set("name", name)
  if (email) target.searchParams.set("email", email)

  for (const [key, value] of Object.entries(options.tracking ?? {})) {
    if (value) target.searchParams.set(key, value)
  }

  return target.toString()
}

/**
 * The href for a "Book a call" control on a public page.
 *
 * WHY THIS EXISTS SEPARATELY from `schedulingLink`: a static page has no
 * conversation, so the tracking it can carry is only the click ids the visitor
 * arrived with. Packing them through `encodeTracking` — rather than pasting
 * `?gclid=` onto the URL — is what makes them survive: Calendly returns only
 * its own `utm_*` fields on the booking webhook, and `decodeTracking` unpacks
 * exactly the shape `encodeTracking` produced. A raw `gclid` query parameter
 * would reach Calendly and never come back, so the booking would look organic
 * and the ad that paid for it would go uncredited.
 *
 * Returns null when no scheduling page is configured, so a caller renders
 * nothing rather than a dead button.
 */
export function consultHref(
  schedulingUrl: string | null | undefined,
  tracking: Parameters<typeof encodeTracking>[0] = {},
  medium: string = TRACKING_MEDIUM_PAGE,
): string | null {
  const url = schedulingUrl?.trim()
  if (!url) return null
  // The medium says WHERE the booking started. Leaving it at the assistant's
  // default would have every contact-page booking reported as a chat booking,
  // crediting the assistant for work it did not do.
  return schedulingLink(url, { tracking: encodeTracking(tracking, medium) })
}
