// app/api/integrations/google-ads/callback/route.ts
// Step 2 of the Google Ads OAuth flow. Google redirects the admin back here
// with ?code=... — we verify the HMAC-signed state, exchange the code for
// tokens, persist the encrypted refresh token via platform_connections, and
// upsert each accessible Customer ID into google_ads_accounts so the nightly
// sync (Plan 1.1 follow-up) has a worklist.
//
// If `GOOGLE_ADS_DEVELOPER_TOKEN` isn't provisioned yet (Darren's 1–2 week
// approval is in flight), `listAccessibleCustomers` returns an empty list and
// we still persist the refresh token so the connection isn't lost. The
// settings page surfaces "Connected, no accounts discovered yet" in that case.

import { NextRequest, NextResponse } from "next/server"
import { exchangeCodeForTokens, verifyState } from "@/lib/ads/oauth"
import { connectPlatform } from "@/lib/db/platform-connections"
import { upsertGoogleAdsAccount } from "@/lib/db/google-ads-accounts"
import { listAccessibleCustomers } from "@/lib/ads/google-ads-client"
import { oauthCallbackQuerySchema } from "@/lib/validators/ads"

function settingsRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/admin/ads/settings", request.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const params: Record<string, string> = {}
  request.nextUrl.searchParams.forEach((v, k) => (params[k] = v))
  const parsed = oauthCallbackQuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid callback params" }, { status: 400 })
  }
  const { code, state, error: googleError, error_description } = parsed.data

  if (googleError) {
    return settingsRedirect(request, { error: error_description ?? googleError })
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

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Google Ads OAuth not configured" }, { status: 500 })
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
    return settingsRedirect(request, {
      error: `Token exchange failed: ${(err as Error).message}`,
    })
  }

  // Discover Customer IDs first so we can use the first one as account_handle
  // on the platform_connections row (helps the admin UI show "Connected to X").
  let accounts: Awaited<ReturnType<typeof listAccessibleCustomers>> = []
  try {
    accounts = await listAccessibleCustomers(tokens.refresh_token)
  } catch (err) {
    return settingsRedirect(request, {
      error: `Customer discovery failed: ${(err as Error).message}`,
    })
  }

  const primaryHandle = accounts[0]?.customer_id ?? null

  await connectPlatform("google_ads", {
    credentials: {
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      authorized_user_id: claim.user_id,
      authorized_at: new Date().toISOString(),
    },
    account_handle: primaryHandle,
    connected_by: claim.user_id,
  })

  for (const acct of accounts) {
    await upsertGoogleAdsAccount({
      customer_id: acct.customer_id,
      descriptive_name: acct.descriptive_name,
      currency_code: acct.currency_code,
      time_zone: acct.time_zone,
    })
  }

  return settingsRedirect(request, { connected: "1" })
}
