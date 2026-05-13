// GET /api/admin/integrations/gsc/callback?code=…&state=…
// Verifies state, exchanges code for tokens, confirms user has access to
// the configured GSC site, upserts the gsc_properties row, redirects to
// the admin UI.

import { NextRequest, NextResponse } from "next/server"
import { exchangeCodeForTokens, verifyState } from "@/lib/gsc/oauth"
import { upsertGscProperty } from "@/lib/db/gsc-properties"
import { setSetting } from "@/lib/db/system-settings"

interface GscState {
  userId: string
  ts: number
  kind: "gsc"
}

export async function GET(req: NextRequest) {
  // Origin from the request — matches whatever origin the /authorize route
  // used to send Google. Localhost in dev, prod in prod.
  const origin = req.nextUrl.origin
  const siteUrl = (): string => origin
  const code = req.nextUrl.searchParams.get("code")
  const state = req.nextUrl.searchParams.get("state")

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 })
  }

  const secret = process.env.INTERNAL_CRON_TOKEN
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const verified = verifyState<GscState>(state, secret)
  if (!verified || verified.kind !== "gsc") {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const targetSite = process.env.GSC_SITE_URL
  if (!clientId || !clientSecret || !targetSite) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GSC_SITE_URL missing" },
      { status: 500 },
    )
  }

  const callbackRedirectUri = `${siteUrl()}/api/admin/integrations/gsc/callback`
  console.log(
    `[gsc-callback] exchanging code: redirect_uri=${JSON.stringify(callbackRedirectUri)} code_prefix=${code.slice(0, 12)}… code_len=${code.length} client_id_suffix=…${clientId.slice(-8)} secret_len=${clientSecret.length}`,
  )
  let tokens
  try {
    tokens = await exchangeCodeForTokens({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackRedirectUri,
    })
  } catch (err) {
    console.error("[gsc-callback] code exchange failed:", err)
    return NextResponse.redirect(
      `${siteUrl()}/admin/integrations/gsc?error=token_exchange_failed`,
      { status: 302 },
    )
  }

  // Confirm the connecting user has access to the configured site.
  const listRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!listRes.ok) {
    return NextResponse.redirect(`${siteUrl()}/admin/integrations/gsc?error=sites_list_failed`, {
      status: 302,
    })
  }
  const sitesBody = (await listRes.json()) as { siteEntry?: Array<{ siteUrl: string }> }
  const hasAccess = (sitesBody.siteEntry ?? []).some((s) => s.siteUrl === targetSite)
  if (!hasAccess) {
    return NextResponse.redirect(`${siteUrl()}/admin/integrations/gsc?error=no_site_access`, {
      status: 302,
    })
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await upsertGscProperty({
    site_url: targetSite,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    access_token_expires: expiresAt,
    connected_by_user_id: verified.userId,
  })

  // Clear the OAuth-broken flag set by a previous failed sync, if any.
  await setSetting("gsc_oauth_broken", false)

  return NextResponse.redirect(`${siteUrl()}/admin/integrations/gsc?connected=1`, { status: 302 })
}
