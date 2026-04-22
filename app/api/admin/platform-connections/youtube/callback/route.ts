// app/api/admin/platform-connections/youtube/callback/route.ts
// Step 2 of the YouTube OAuth flow. Google redirects the admin back here with
// ?code=... — we verify the CSRF state cookie, exchange the code for access +
// refresh tokens, fetch the channel name for display, then persist the
// credentials to both the youtube and youtube_shorts rows (they share
// credentials; see lib/social/plugins/youtube-shorts.ts).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { connectPlatform } from "@/lib/db/platform-connections"

const STATE_COOKIE = "yt_oauth_state"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(reason: string, params: Record<string, string> = {}) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(reason, "youtube")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = NextResponse.redirect(url.toString())
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/admin/platform-connections/youtube" })
  return response
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const stateParam = url.searchParams.get("state")
  const errorParam = url.searchParams.get("error")
  const stateCookie = request.cookies.get(STATE_COOKIE)?.value

  if (errorParam) {
    return redirectHome("error", { reason: errorParam })
  }
  if (!code || !stateParam || !stateCookie || stateParam !== stateCookie) {
    return redirectHome("error", { reason: "state_mismatch" })
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET
  const base = siteUrl()
  if (!clientId || !clientSecret || !base) {
    return redirectHome("error", { reason: "env_missing" })
  }

  const redirectUri = `${base}/api/admin/platform-connections/youtube/callback`

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  })

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => "")
    console.error("[youtube/callback] token exchange failed", tokenResponse.status, text)
    return redirectHome("error", { reason: "token_exchange" })
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!tokenData.access_token || !tokenData.refresh_token) {
    return redirectHome("error", { reason: "missing_refresh_token" })
  }

  let accountHandle: string | null = null
  try {
    const channelResp = await fetch(CHANNEL_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (channelResp.ok) {
      const channelData = (await channelResp.json()) as {
        items?: Array<{ snippet?: { title?: string } }>
      }
      accountHandle = channelData.items?.[0]?.snippet?.title ?? null
    }
  } catch (err) {
    console.warn("[youtube/callback] channel lookup failed (non-fatal)", err)
  }

  const credentials = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  }

  try {
    await connectPlatform("youtube", {
      credentials,
      account_handle: accountHandle,
      connected_by: session.user.id,
    })
    await connectPlatform("youtube_shorts", {
      credentials,
      account_handle: accountHandle,
      connected_by: session.user.id,
    })
  } catch (err) {
    console.error("[youtube/callback] connectPlatform failed", err)
    return redirectHome("error", { reason: "db_write" })
  }

  return redirectHome("connected")
}
