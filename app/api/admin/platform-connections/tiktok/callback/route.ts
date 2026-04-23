// app/api/admin/platform-connections/tiktok/callback/route.ts
// Step 2 of the TikTok OAuth flow. TikTok redirects the admin back here with
// ?code=... — we verify the CSRF state cookie, exchange the code for an
// access + refresh token, fetch the user's TikTok username for display, and
// persist everything into the tiktok row.
//
// Credentials stored: access_token, refresh_token, open_id, client_key,
// client_secret. The plugin refreshes the access token on 401 using these.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { connectPlatform } from "@/lib/db/platform-connections"

const STATE_COOKIE = "tk_oauth_state"
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
const USER_INFO_URL =
  "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url"

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(reason: string, params: Record<string, string> = {}) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(reason, "tiktok")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = NextResponse.redirect(url.toString())
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/admin/platform-connections/tiktok" })
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

  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const base = siteUrl()
  if (!clientKey || !clientSecret || !base) {
    return redirectHome("error", { reason: "env_missing" })
  }

  const redirectUri = `${base}/api/admin/platform-connections/tiktok/callback`

  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  })

  if (!tokenResp.ok) {
    const text = await tokenResp.text().catch(() => "")
    console.error("[tiktok/callback] token exchange failed", tokenResp.status, text)
    return redirectHome("error", { reason: "token_exchange" })
  }

  const tokenData = (await tokenResp.json()) as {
    access_token?: string
    refresh_token?: string
    open_id?: string
    scope?: string
    expires_in?: number
  }

  if (!tokenData.access_token || !tokenData.refresh_token) {
    return redirectHome("error", { reason: "missing_refresh_token" })
  }

  let accountHandle: string | null = null
  try {
    const userResp = await fetch(USER_INFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (userResp.ok) {
      const userData = (await userResp.json()) as {
        data?: { user?: { display_name?: string } }
      }
      const user = userData.data?.user
      accountHandle = user?.display_name ?? null
    }
  } catch (err) {
    console.warn("[tiktok/callback] user info lookup failed (non-fatal)", err)
  }

  try {
    await connectPlatform("tiktok", {
      credentials: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        open_id: tokenData.open_id ?? null,
        client_key: clientKey,
        client_secret: clientSecret,
      },
      account_handle: accountHandle,
      connected_by: session.user.id,
    })
  } catch (err) {
    console.error("[tiktok/callback] connectPlatform failed", err)
    return redirectHome("error", { reason: "db_write" })
  }

  return redirectHome("connected")
}
