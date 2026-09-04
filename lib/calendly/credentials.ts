// lib/calendly/credentials.ts — hands out a usable Calendly access token for
// one coach's connection, refreshing it when it is expired or about to be.
//
// CALENDLY REFRESH TOKENS ARE SINGLE-USE: revoked the instant a refresh
// succeeds. Two requests that both notice an expired access token at the same
// moment send the same refresh token, and the loser gets `invalid_grant` back
// from Calendly even though nothing is actually wrong with the connection.
// `fn_store_refreshed_calendar_credentials` (migration 00250) is the
// compare-and-swap that makes the loser recoverable: if the refresh token it
// started from is no longer the one on the row, the write is refused and the
// WINNER's credentials come back instead. The only correct move for the loser
// is to adopt those credentials and carry on — not to report an error, and
// not to retry its own now-revoked token.
//
// CLASSIFICATION ON FAILURE IS THE OTHER HALF OF THE JOB. Only
// `CalendlyOAuthError` with `kind === "invalid_grant"` means the grant is
// actually dead — that is the one case that may write `needs_reconnect`.
// Every other failure (`http`, `network`, `shape`) is transient until proven
// otherwise: a `last_error` is recorded, but the status is left exactly as it
// was. This repo already learned the cost of getting that wrong once, on
// `platform_connections` — see the comment on `clearConnectionError` in
// lib/db/platform-connections.ts. Marking a connection `needs_reconnect` off
// one 503 tells a coach whose calendar works fine that they need to
// reconnect it, and only a human can undo that.
//
// A CALLER THAT CANNOT GET A TOKEN GETS A THROW, NOT `null`.
// lib/calendly/client.ts's header is emphatic that `[]` and a throw are
// different answers; the same applies here — "could not authenticate" is a
// could-not-read, so this throws `CalendlyUnavailable`, the same class that
// module already raises for an unreachable availability read.

import { setCoachCalendarError, storeRefreshedCalendarCredentials } from "@/lib/db/coach-calendar-connections"
import { CalendlyOAuthError, refreshAccessToken, type CalendlyOAuthErrorKind } from "@/lib/calendly/oauth"
import { CalendlyUnavailable, type CalendlyUnavailableReason } from "@/lib/calendly/client"
import type { CoachCalendarConnection } from "@/types/database"

export type CalendlyCredentials = { access_token: string; refresh_token: string }

/**
 * Refresh proactively this many seconds before the stored expiry, so a call
 * never dies mid-flight. Calendly access tokens last about two hours, so this
 * is a small fraction of the token's life.
 */
export const REFRESH_SKEW_SECONDS = 120

/**
 * `expiresAt === null` returns true. An unknown expiry is not a valid token —
 * the alternative, assuming freshness, fails at the worst possible moment
 * (mid-call, with no expiry left to warn us). An unparseable `expiresAt`
 * (`""`, `"garbage"`, ...) gets the same treatment: `new Date(x).getTime()`
 * is `NaN` there, and every comparison against `NaN` is `false` — silently
 * returning "not expired" for a value that was never actually usable, which
 * is the exact inverse of what this function exists to guard against.
 */
export function needsRefresh(expiresAt: string | null, nowMs: number = Date.now()): boolean {
  if (expiresAt === null) return true
  const expiresMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresMs)) return true
  return expiresMs - nowMs <= REFRESH_SKEW_SECONDS * 1000
}

function unavailableReasonFor(kind: CalendlyOAuthErrorKind): CalendlyUnavailableReason {
  if (kind === "network") return "network"
  if (kind === "shape") return "shape"
  // "http" and "invalid_grant" are both HTTP-level rejections from Calendly's
  // token endpoint.
  return "http"
}

export type AccessTokenForConnectionDeps = {
  now?: () => number
}

/**
 * The usable access token for `connection`, refreshing first when the stored
 * one is missing, expired, or inside the skew window. Throws
 * `CalendlyUnavailable` — never returns a token it isn't confident is good.
 */
export async function accessTokenForConnection(
  connection: CoachCalendarConnection,
  deps: AccessTokenForConnectionDeps = {},
): Promise<string> {
  const now = deps.now ?? Date.now
  const credentials = connection.credentials as CalendlyCredentials | undefined

  if (!credentials?.access_token || !credentials?.refresh_token) {
    throw new CalendlyUnavailable(
      "shape",
      `coach calendar connection ${connection.id} has no stored Calendly credentials`,
    )
  }

  if (!needsRefresh(connection.access_token_expires_at, now())) {
    return credentials.access_token
  }

  const clientId = process.env.CALENDLY_CLIENT_ID
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new CalendlyUnavailable("shape", "CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET are not configured")
  }

  let refreshed
  try {
    refreshed = await refreshAccessToken({
      refreshToken: credentials.refresh_token,
      clientId,
      clientSecret,
    })
  } catch (err) {
    if (err instanceof CalendlyOAuthError) {
      // Guarded: a failed write here must never replace the refresh failure
      // we actually need to report with a raw DB error, losing the
      // diagnostic (lib/gmail/client.ts:138,142 follows the same pattern).
      if (err.kind === "invalid_grant") {
        // The grant is genuinely dead. Only the coach can fix this.
        await setCoachCalendarError(connection.id, "needs_reconnect", err.message).catch(() => {})
      } else {
        // Transient until proven otherwise -- record the reason, but leave
        // the status exactly as it was so a healthy connection stays healthy.
        await setCoachCalendarError(connection.id, connection.status, err.message).catch(() => {})
      }
      throw new CalendlyUnavailable(
        unavailableReasonFor(err.kind),
        `Calendly token refresh failed: ${err.message}`,
        err.status,
      )
    }
    throw err
  }

  const accessTokenExpiresAt = new Date(now() + refreshed.expires_in * 1000).toISOString()
  const swap = await storeRefreshedCalendarCredentials({
    connectionId: connection.id,
    expectedRefreshToken: credentials.refresh_token,
    credentials: { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token },
    accessTokenExpiresAt,
  })

  // `swap.stored === false` means somebody else already rotated the refresh
  // token first -- adopt THEIR credentials, the only ones still valid, rather
  // than the ones this call just obtained from a now-revoked grant.
  const winning = (swap.stored ? { access_token: refreshed.access_token } : swap.credentials) as CalendlyCredentials

  // The DB function returns `credentials: '{}'::jsonb` when it has no secret
  // to hand back (e.g. the connection was disconnected mid-race). An empty
  // object is not a usable token -- surface that as "could not authenticate"
  // rather than handing a caller `undefined` to use as a Bearer token.
  if (typeof winning?.access_token !== "string" || winning.access_token.length === 0) {
    throw new CalendlyUnavailable(
      "shape",
      `coach calendar connection ${connection.id}: no usable access token after refresh (swap.stored=${swap.stored})`,
    )
  }

  return winning.access_token
}
