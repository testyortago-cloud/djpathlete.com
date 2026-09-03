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
