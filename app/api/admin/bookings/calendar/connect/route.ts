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

import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { resolveCalendarAccess } from "@/lib/bookings/calendar-access"
import { buildAuthorizationUrl, createPkcePair, signState } from "@/lib/calendly/oauth"
import { readCalendlyConnectConfig } from "@/lib/calendly/connect-env"
import { CALENDAR_COOKIE_MAX_AGE_SECONDS, CALENDAR_COOKIE_PATH, NONCE_COOKIE, VERIFIER_COOKIE } from "../cookies"

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
  if (!config) {
    return NextResponse.json({ error: "Connecting Calendly is not configured on this server yet." }, { status: 500 })
  }

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Connecting Calendly is not configured on this server yet." }, { status: 500 })
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
