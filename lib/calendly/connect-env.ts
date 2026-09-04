// lib/calendly/connect-env.ts — the OAuth application a coach connects their
// OWN Calendly account through, read once and typed, so the connect route and
// the callback route can never disagree about the redirect URI.
//
// THE REDIRECT URI IS DERIVED, NOT CONFIGURED, AND THAT IS THE POINT. OAuth
// compares it byte-for-byte against what is registered on the Calendly app,
// and it is sent TWICE — once on the authorize redirect and again on the token
// exchange — where a mismatch between the two is rejected as
// `invalid_grant`. One derivation, one source (`NEXTAUTH_URL`), removes the
// class of bug entirely. It also means the value can never be attacker-chosen:
// deriving it from the request's own `Host` header would let a forged host
// point Calendly's redirect somewhere else.
//
// THESE ARE NOT lib/calendly/env.ts's FOUR VALUES. Those describe ONE Calendly
// account — the platform's own, still the ramp for the single live install.
// These describe the OAuth app every coach connects through, and they replace
// `CALENDLY_API_TOKEN` for each coach who does. Both sets coexist on purpose;
// see .env.example.

export const CALENDLY_CALLBACK_PATH = "/api/admin/bookings/calendar/callback"

/** Where Calendly delivers `invitee.created` / `invitee.canceled`. */
export const CALENDLY_WEBHOOK_PATH = "/api/webhooks/calendly"

export type CalendlyConnectConfig = {
  clientId: string
  clientSecret: string
  /** `<origin>/api/admin/bookings/calendar/callback`, exactly as registered on the Calendly app. */
  redirectUri: string
}

type Env = Record<string, string | undefined>

function present(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

/** The site's own origin, with no trailing slash. `null` when `NEXTAUTH_URL` is unset. */
export function siteOrigin(env: Env = process.env): string | null {
  const raw = present(env.NEXTAUTH_URL)
  return raw ? raw.replace(/\/+$/, "") : null
}

/** The webhook URL a coach's subscription is registered against, or null. */
export function calendlyWebhookCallbackUrl(env: Env = process.env): string | null {
  const origin = siteOrigin(env)
  return origin ? `${origin}${CALENDLY_WEBHOOK_PATH}` : null
}

/**
 * Everything the per-coach connect flow needs, or `null` if any of it is
 * missing. Null rather than a partial object: a half-configured OAuth app
 * cannot start a flow it could not finish, and the route says so plainly
 * instead of failing at Calendly's end with a redirect-uri mismatch.
 */
export function readCalendlyConnectConfig(env: Env = process.env): CalendlyConnectConfig | null {
  const clientId = present(env.CALENDLY_CLIENT_ID)
  const clientSecret = present(env.CALENDLY_CLIENT_SECRET)
  const origin = siteOrigin(env)
  if (!clientId || !clientSecret || !origin) return null
  return { clientId, clientSecret, redirectUri: `${origin}${CALENDLY_CALLBACK_PATH}` }
}
