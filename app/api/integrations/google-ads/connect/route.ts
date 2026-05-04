// app/api/integrations/google-ads/connect/route.ts
// Step 1 of the Google Ads OAuth flow. Admin-only. Redirects to Google's
// consent screen with `access_type=offline` and `prompt=consent` so we always
// receive a refresh token, plus an HMAC-signed `state` claim that the
// callback verifies (no cookie needed).

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildAuthorizationUrl, signState } from "@/lib/ads/oauth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI
  const secret = process.env.NEXTAUTH_SECRET
  if (!clientId || !redirectUri || !secret) {
    return NextResponse.json(
      { error: "Google Ads OAuth not configured (missing CLIENT_ID, REDIRECT_URI, or NEXTAUTH_SECRET)" },
      { status: 500 },
    )
  }

  const state = signState(
    { user_id: session.user.id, nonce: crypto.randomUUID(), iat: Date.now() },
    secret,
  )
  const url = buildAuthorizationUrl({ client_id: clientId, redirect_uri: redirectUri, state })

  return NextResponse.redirect(url)
}
