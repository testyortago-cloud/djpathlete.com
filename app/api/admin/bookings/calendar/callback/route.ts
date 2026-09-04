// app/api/admin/bookings/calendar/callback/route.ts
//
// Step 2: Calendly sends the coach back here. Verify, exchange, read who the
// token belongs to, store, and land the coach back on the calendar screen.
//
// EVERY FAILURE PATH WRITES NOTHING AND LEAVES ANY EXISTING CONNECTION
// EXACTLY AS IT WAS. Reconnecting is the common case — a coach whose token
// went stale clicks Connect again — and a failed reconnect that wiped the row
// would turn a recoverable hiccup into a support ticket. The only write in
// this file is the last statement of the happy path.
//
// FOUR PROOFS, NOT ONE. Each answers a question the others cannot:
//   1. the HMAC + its TTL          — we minted this state, and recently;
//   2. the nonce cookie            — THIS BROWSER asked for it. A signature
//      alone is replayable by anyone who captured the redirect;
//   3. the session's user id       — the person finishing the flow is the
//      person who started it;
//   4. the caller's business list  — the business named in the state is still
//      one this caller may act on.
//
// THE TENANT COMES FROM THE SIGNED STATE, NEVER FROM THE RESOLVER. The
// resolver's `businessId` follows a browser cookie, so a coach with two
// businesses who switched tabs mid-flow would otherwise land their Calendly on
// the wrong one. `businessChoices` is still consulted — for whether the
// state's business is permitted, not for which business it is.
//
// BOTH COOKIES ARE DELETED ON EVERY EXIT PATH, success or failure. A verifier
// that outlives its exchange is a reusable one, so `finish()` is the only way
// out of this route.

import { NextResponse } from "next/server"

import { recordAudit } from "@/lib/audit/record"
import { resolveCalendarAccess } from "@/lib/bookings/calendar-access"
import { fetchIdentity } from "@/lib/calendly/account"
import { readCalendlyConnectConfig } from "@/lib/calendly/connect-env"
import { exchangeCodeForTokens, verifyState } from "@/lib/calendly/oauth"
import { connectCoachCalendar } from "@/lib/db/coach-calendar-connections"
import { CALENDAR_COOKIE_PATH, NONCE_COOKIE, VERIFIER_COOKIE } from "../cookies"

/** The screen the coach came from, and the only place this route sends them. */
const CALENDAR_SCREEN = "/admin/bookings/calendar"

/**
 * Cookies are read off the raw header rather than through `NextRequest` so the
 * handler's parameter stays a plain `Request` — the shape the repo's route
 * tests construct. Mirrors `resolveAdminTenantForRequest`.
 */
function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? ""
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * THE ONLY EXIT. Redirects to the calendar screen with a result, and clears
 * both flow cookies on the way out — including on success, where the verifier
 * has just been spent.
 */
function finish(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL(CALENDAR_SCREEN, request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = NextResponse.redirect(url)
  response.cookies.delete({ name: NONCE_COOKIE, path: CALENDAR_COOKIE_PATH })
  response.cookies.delete({ name: VERIFIER_COOKIE, path: CALENDAR_COOKIE_PATH })
  return response
}

const failed = (request: Request, reason: string) => finish(request, { calendar: "error", reason })

export async function GET(request: Request) {
  const access = await resolveCalendarAccess(request)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const errorParam = url.searchParams.get("error")
  const stateParam = url.searchParams.get("state")
  const code = url.searchParams.get("code")

  // Calendly refused to complete the connection. `access_denied` is the coach
  // clicking Cancel; the other OAuth error codes are not actionable by them
  // either, so all of them land on the same "you didn't finish connecting"
  // copy, with the raw code kept in the server log rather than the URL.
  if (errorParam) {
    if (errorParam !== "access_denied") {
      console.warn(`[calendar/callback] Calendly returned error=${errorParam}`)
    }
    return finish(request, { calendar: "declined", reason: "declined" })
  }

  const secret = process.env.NEXTAUTH_SECRET
  const config = readCalendlyConnectConfig()
  if (!secret || !config) {
    console.error("[calendar/callback] CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET / NEXTAUTH_URL are not configured")
    return failed(request, "config")
  }

  // 1. The signature and its 600s TTL.
  const claim = stateParam ? verifyState(stateParam, secret) : null
  if (!claim) return failed(request, "state")

  // 2. The nonce cookie. Required AND compared: without it a signed state
  //    captured from a redirect chain is replayable from any browser.
  const nonceCookie = readCookie(request, NONCE_COOKIE)
  if (!nonceCookie || nonceCookie !== claim.nonce) return failed(request, "state")

  // 3. The signed-in user is the one who started the flow.
  if (claim.user_id !== access.userId) return failed(request, "state")

  // 4. The state's business is still one this caller may act on. Note this
  //    checks the state's value against the allowed set — it does not adopt
  //    the resolver's currently-selected business.
  if (!access.isOperator && !access.businessChoices.includes(claim.business_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const verifier = readCookie(request, VERIFIER_COOKIE)
  if (!verifier) return failed(request, "pkce")

  if (!code) return failed(request, "exchange")

  let tokens
  try {
    tokens = await exchangeCodeForTokens({
      code,
      verifier,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    })
  } catch (err) {
    console.error("[calendar/callback] token exchange failed", err)
    return failed(request, "exchange")
  }

  let identity
  try {
    identity = await fetchIdentity({ accessToken: tokens.access_token })
  } catch (err) {
    console.error("[calendar/callback] GET /users/me failed", err)
    return failed(request, "identity")
  }

  try {
    await connectCoachCalendar({
      businessId: claim.business_id,
      hostId: claim.host_id,
      provider: "calendly",
      // The minimum a later call needs. lib/calendly/credentials.ts reads
      // exactly these two, and a vault secret should hold nothing more.
      credentials: { access_token: tokens.access_token, refresh_token: tokens.refresh_token },
      calendlyUserUri: identity.uri,
      calendlyOrganizationUri: identity.organizationUri,
      // GET /users/me does not carry the org role — it lives on
      // /organization_memberships, which nothing here needs yet. Left null
      // rather than guessed.
      calendlyRole: null,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connectedBy: claim.user_id,
    })
  } catch (err) {
    console.error("[calendar/callback] connectCoachCalendar failed", err)
    return failed(request, "save")
  }

  // Inline rather than withAudit(): this route answers a 307, which the
  // wrapper's status classifier would file as a failure on the one path that
  // actually succeeded.
  await recordAudit({
    action: "calendar.connected",
    category: "admin_write",
    target: { type: "coach_calendar_connection", id: claim.host_id, label: identity.email },
    request,
    metadata: { business_id: claim.business_id, provider: "calendly" },
  }).catch(() => {})

  return finish(request, { calendar: "connected" })
}
