// lib/calendly/tracking.ts — how the click ids get from the chat to the booking.
//
// THE GAP THIS CLOSES. The GoHighLevel webhook learns a booking's gclid either
// from its own payload or from `findAttributionByEmail`, which joins
// `marketing_attribution → users` — so it only ever matches somebody with a
// `users` row, which a chat visitor is not. Calendly's payload has no click-id
// field at all. Without a path, every booking made through the assistant
// would fire ZERO ads conversions, silently, and nothing on screen would look
// wrong.
//
// THE PATH IS THE ONE CALENDLY DOCUMENTS: UTM parameters on the scheduling link
// come back on the webhook under `payload.tracking`, and the docs say outright
// they "can be used to track custom data like user IDs". So the click ids ride
// in `utm_content` and the conversation id in `utm_term`, and the webhook
// decodes them off the invitee. `utm_source`/`utm_medium` are fixed so the
// bookings Calendly's own reports attribute to the assistant are identifiable.
//
// VALUES ARE ALLOWLISTED, NOT ESCAPED. A click id is `[A-Za-z0-9_-]`; anything
// else is dropped rather than encoded, because these strings end up in a URL
// the visitor clicks and in a webhook body we later trust.

export type ClickTracking = {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
  conversationId: string | null
}

export const TRACKING_SOURCE = "website-assistant"
export const TRACKING_MEDIUM = "chat"

const CLICK_ID_RE = /^[A-Za-z0-9_-]{1,200}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLICK_KEYS = ["gclid", "gbraid", "wbraid", "fbclid"] as const

export const EMPTY_TRACKING: ClickTracking = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  conversationId: null,
}

function clean(value: string | null | undefined, re: RegExp): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return re.test(trimmed) ? trimmed : null
}

/** The UTM parameters to put on a scheduling link so the webhook can give them back. */
export function encodeTracking(tracking: Partial<ClickTracking>): Record<string, string> {
  const params: Record<string, string> = { utm_source: TRACKING_SOURCE, utm_medium: TRACKING_MEDIUM }

  const clicks = CLICK_KEYS.map((key) => [key, clean(tracking[key], CLICK_ID_RE)] as const)
    .filter((pair): pair is readonly [(typeof CLICK_KEYS)[number], string] => pair[1] !== null)
    .map(([key, value]) => `${key}:${value}`)
  if (clicks.length > 0) params.utm_content = clicks.join(";")

  const conversationId = clean(tracking.conversationId, UUID_RE)
  if (conversationId) params.utm_term = `conv:${conversationId}`

  return params
}

/**
 * The click ids and conversation id back out of a webhook's `payload.tracking`.
 * Anything that is not ours — a booking made from a Google Ads landing page
 * carrying its own UTMs — decodes to all-null rather than to garbage.
 */
export function decodeTracking(tracking: unknown): ClickTracking {
  const out: ClickTracking = { ...EMPTY_TRACKING }
  if (!tracking || typeof tracking !== "object") return out
  const rec = tracking as Record<string, unknown>

  const content = typeof rec.utm_content === "string" ? rec.utm_content : ""
  for (const part of content.split(";")) {
    const idx = part.indexOf(":")
    if (idx <= 0) continue
    const key = part.slice(0, idx) as (typeof CLICK_KEYS)[number]
    if (!CLICK_KEYS.includes(key)) continue
    const value = clean(part.slice(idx + 1), CLICK_ID_RE)
    if (value) out[key] = value
  }

  const term = typeof rec.utm_term === "string" ? rec.utm_term : ""
  if (term.startsWith("conv:")) out.conversationId = clean(term.slice(5), UUID_RE)

  return out
}
