// app/api/integrations/gmail/callback/route.ts
// Step 2 of the Gmail OAuth flow. Verifies the HMAC-signed state, exchanges
// the code for tokens, fetches the connected email address, and persists
// the refresh token through platform_connections (vault-encrypted). On
// failure, redirects back to /admin/inbox with an `error` query param so
// the UI can toast it.

import { NextRequest, NextResponse } from "next/server"
import { exchangeCodeForTokens, verifyState } from "@/lib/gmail/oauth"
import { persistGmailConnection, getProfile } from "@/lib/gmail/client"

function inboxRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/admin/inbox", request.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const googleError = request.nextUrl.searchParams.get("error")
  const errorDescription = request.nextUrl.searchParams.get("error_description")

  if (googleError) {
    return inboxRedirect(request, { error: errorDescription ?? googleError })
  }
  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 })
  }

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })

  const claim = verifyState<{ user_id: string }>(state, secret)
  if (!claim) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 })
  }

  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const redirectUri = process.env.GMAIL_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Gmail OAuth not configured" }, { status: 500 })
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    })
  } catch (err) {
    return inboxRedirect(request, { error: `Token exchange failed: ${(err as Error).message}` })
  }

  if (!tokens.refresh_token) {
    return inboxRedirect(request, {
      error: "Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions and try again.",
    })
  }

  let emailAddress = ""
  try {
    const profile = await getProfile(tokens.access_token)
    emailAddress = profile.emailAddress
  } catch (err) {
    return inboxRedirect(request, { error: `Profile lookup failed: ${(err as Error).message}` })
  }

  await persistGmailConnection({
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    emailAddress,
    authorized_user_id: claim.user_id,
  })

  return inboxRedirect(request, { connected: "1" })
}
