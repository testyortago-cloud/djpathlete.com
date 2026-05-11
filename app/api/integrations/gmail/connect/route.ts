// app/api/integrations/gmail/connect/route.ts
// Step 1 of the Gmail OAuth flow. Admin-only. Redirects to Google's consent
// screen with offline access so we receive a refresh token, plus an
// HMAC-signed `state` claim that the callback verifies (no cookie needed).

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildGmailAuthorizationUrl, signState } from "@/lib/gmail/oauth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const clientId = process.env.GMAIL_CLIENT_ID
  const redirectUri = process.env.GMAIL_REDIRECT_URI
  const secret = process.env.NEXTAUTH_SECRET
  if (!clientId || !redirectUri || !secret) {
    return NextResponse.json(
      { error: "Gmail OAuth not configured (GMAIL_CLIENT_ID, GMAIL_REDIRECT_URI, NEXTAUTH_SECRET required)" },
      { status: 500 },
    )
  }

  const state = signState(
    { user_id: session.user.id, nonce: crypto.randomUUID(), iat: Date.now() },
    secret,
  )
  const url = buildGmailAuthorizationUrl({ client_id: clientId, redirect_uri: redirectUri, state })

  return NextResponse.redirect(url)
}
