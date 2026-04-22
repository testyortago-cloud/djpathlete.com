// app/api/admin/platform-connections/facebook/callback/route.ts
// Step 2 of the Meta OAuth flow. Meta redirects the admin back here with
// ?code=... — we verify the CSRF state cookie, exchange the code for a
// short-lived user token, upgrade to a long-lived user token, then call
// /me/accounts to pull the Page access token (which does not expire) + the
// linked Instagram Business account id. We persist the facebook row with
// { access_token: page_token, page_id } and the instagram row with
// { access_token: page_token, ig_user_id } — both plugins already expect
// exactly these credential shapes.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { connectPlatform } from "@/lib/db/platform-connections"

const STATE_COOKIE = "fb_oauth_state"
const GRAPH_VERSION = "v22.0"
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`
const TOKEN_URL = `${GRAPH_BASE}/oauth/access_token`

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(reason: string, params: Record<string, string> = {}) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(reason, "facebook")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = NextResponse.redirect(url.toString())
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/admin/platform-connections/facebook" })
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

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const base = siteUrl()
  if (!appId || !appSecret || !base) {
    return redirectHome("error", { reason: "env_missing" })
  }

  const redirectUri = `${base}/api/admin/platform-connections/facebook/callback`

  // 1. Short-lived user token
  const shortUrl = new URL(TOKEN_URL)
  shortUrl.searchParams.set("client_id", appId)
  shortUrl.searchParams.set("client_secret", appSecret)
  shortUrl.searchParams.set("redirect_uri", redirectUri)
  shortUrl.searchParams.set("code", code)

  const shortResp = await fetch(shortUrl.toString())
  if (!shortResp.ok) {
    const text = await shortResp.text().catch(() => "")
    console.error("[facebook/callback] token exchange failed", shortResp.status, text)
    return redirectHome("error", { reason: "token_exchange" })
  }
  const shortData = (await shortResp.json()) as { access_token?: string }
  const shortToken = shortData.access_token
  if (!shortToken) {
    return redirectHome("error", { reason: "token_exchange" })
  }

  // 2. Long-lived user token (60-day). Page tokens derived from this are
  //    long-lived and effectively do not expire.
  const longUrl = new URL(TOKEN_URL)
  longUrl.searchParams.set("grant_type", "fb_exchange_token")
  longUrl.searchParams.set("client_id", appId)
  longUrl.searchParams.set("client_secret", appSecret)
  longUrl.searchParams.set("fb_exchange_token", shortToken)

  const longResp = await fetch(longUrl.toString())
  if (!longResp.ok) {
    console.warn("[facebook/callback] long-lived exchange failed — falling back to short-lived", longResp.status)
  }
  const longData = longResp.ok ? ((await longResp.json()) as { access_token?: string }) : null
  const userToken = longData?.access_token ?? shortToken

  // 3. Fetch Pages the user manages, plus each Page's linked IG Business acct
  const pagesUrl = new URL(`${GRAPH_BASE}/me/accounts`)
  pagesUrl.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,username}",
  )
  pagesUrl.searchParams.set("access_token", userToken)

  const pagesResp = await fetch(pagesUrl.toString())
  if (!pagesResp.ok) {
    const text = await pagesResp.text().catch(() => "")
    console.error("[facebook/callback] /me/accounts failed", pagesResp.status, text)
    return redirectHome("error", { reason: "pages_lookup" })
  }
  const pagesData = (await pagesResp.json()) as {
    data?: Array<{
      id: string
      name: string
      access_token: string
      instagram_business_account?: { id: string; username?: string }
    }>
  }
  const page = pagesData.data?.[0]
  if (!page) {
    return redirectHome("error", { reason: "no_pages" })
  }

  try {
    await connectPlatform("facebook", {
      credentials: {
        access_token: page.access_token,
        page_id: page.id,
      },
      account_handle: page.name,
      connected_by: session.user.id,
    })

    if (page.instagram_business_account?.id) {
      await connectPlatform("instagram", {
        credentials: {
          access_token: page.access_token,
          ig_user_id: page.instagram_business_account.id,
        },
        account_handle: page.instagram_business_account.username
          ? `@${page.instagram_business_account.username}`
          : null,
        connected_by: session.user.id,
      })
    }
  } catch (err) {
    console.error("[facebook/callback] connectPlatform failed", err)
    return redirectHome("error", { reason: "db_write" })
  }

  return redirectHome("connected")
}
