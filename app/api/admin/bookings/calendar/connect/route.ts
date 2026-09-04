// app/api/admin/bookings/calendar/connect/route.ts
//
// Step 1 of a coach connecting THEIR OWN Calendly account: mint the PKCE pair
// and the signed state, drop both halves into httpOnly cookies, and send the
// coach to Calendly's consent screen.
//
// THE TENANT IS DECIDED HERE, ON THE SERVER, AND TRAVELS SIGNED. `business_id`
// and `host_id` are resolved from the session now and put inside the HMAC'd
// state, never onto a query parameter the callback would have to trust. A
// browser-editable tenant on an OAuth callback is a cross-tenant write.
//
// TWO COOKIES, TWO DIFFERENT JOBS.
//   * the verifier is PKCE: it proves the party redeeming the code is the
//     party that started the flow;
//   * the nonce is CSRF: the state's signature proves WE minted it, and only
//     a cookie proves THIS BROWSER asked for it. The callback requires and
//     compares both.
//
// Nothing is written to the database here. A coach who abandons the consent
// screen leaves no trace but two cookies that expire in ten minutes.
//
// A MISSING CONFIGURATION REDIRECTS; IT DOES NOT ANSWER JSON. "Connect
// Calendly" is an <a>, not a fetch, so a JSON body is a blank page of braces
// in the coach's browser — and an install with no CALENDLY_* variables is not
// a corner case, it is what production is today. The coach goes back to the
// screen they came from with `reason=config`, which that page already turns
// into a sentence naming what to do. The permission refusals stay JSON, the
// same way the callback's do: there is no screen that caller is entitled to.

import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { resolveCalendarAccess } from "@/lib/bookings/calendar-access"
import { buildAuthorizationUrl, createPkcePair, signState } from "@/lib/calendly/oauth"
import { readCalendlyConnectConfig } from "@/lib/calendly/connect-env"
import { CALENDAR_COOKIE_MAX_AGE_SECONDS, CALENDAR_COOKIE_PATH, NONCE_COOKIE, VERIFIER_COOKIE } from "../cookies"

/** The screen the coach clicked Connect on, and the only place this route sends them on a failure. */
const CALENDAR_SCREEN = "/admin/bookings/calendar"

/**
 * Back to the calendar screen, saying why. `reason=config` is the callback
 * route's own word for the same fault, and the page's `flashFor` already reads
 * it: "Connecting Calendly is not set up on this site yet. Ask the person who
 * set up your account to finish it."
 *
 * The target is built from the request's own URL rather than NEXTAUTH_URL,
 * because a missing NEXTAUTH_URL is one of the faults this answers.
 */
function misconfigured(request: Request): NextResponse {
  const url = new URL(CALENDAR_SCREEN, request.url)
  url.searchParams.set("calendar", "error")
  url.searchParams.set("reason", "config")
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const access = await resolveCalendarAccess(request)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (!access.hostId) {
    return NextResponse.json(
      { error: "This business has no calendar host yet, so there is nothing to connect a Calendly account to." },
      { status: 409 },
    )
  }

  const config = readCalendlyConnectConfig()
  const secret = process.env.NEXTAUTH_SECRET
  if (!config || !secret) {
    console.error(
      "[calendar/connect] CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET / NEXTAUTH_URL / NEXTAUTH_SECRET are not configured",
    )
    return misconfigured(request)
  }

  const { verifier, challenge } = createPkcePair()
  const nonce = randomBytes(16).toString("base64url")
  const state = signState(
    {
      business_id: access.businessId,
      host_id: access.hostId,
      user_id: access.userId,
      nonce,
      iat: Math.floor(Date.now() / 1000),
    },
    secret,
  )

  const response = NextResponse.redirect(
    buildAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      challenge,
    }),
  )

  for (const [name, value] of [
    [NONCE_COOKIE, nonce],
    [VERIFIER_COOKIE, verifier],
  ] as const) {
    response.cookies.set({
      name,
      value,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: CALENDAR_COOKIE_PATH,
      maxAge: CALENDAR_COOKIE_MAX_AGE_SECONDS,
    })
  }

  return response
}
