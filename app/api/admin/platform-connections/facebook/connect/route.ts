// app/api/admin/platform-connections/facebook/connect/route.ts
// Step 1 of the Meta OAuth flow. A single consent screen grants access for
// BOTH the Facebook Page and the linked Instagram Business account — the
// callback stores one row per platform using the same page access token.

import crypto from "crypto"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

const SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
]

const STATE_COOKIE = "fb_oauth_state"
const STATE_TTL_SECONDS = 60 * 10 // 10 minutes

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  const appId = process.env.META_APP_ID
  const base = siteUrl()
  if (!appId || !base) {
    return NextResponse.json(
      { error: "META_APP_ID or NEXTAUTH_URL is not set." },
      { status: 500 },
    )
  }

  const state = crypto.randomBytes(32).toString("hex")
  const redirectUri = `${base}/api/admin/platform-connections/facebook/callback`

  const metaUrl = new URL("https://www.facebook.com/v22.0/dialog/oauth")
  metaUrl.searchParams.set("client_id", appId)
  metaUrl.searchParams.set("redirect_uri", redirectUri)
  metaUrl.searchParams.set("response_type", "code")
  metaUrl.searchParams.set("scope", SCOPES.join(","))
  metaUrl.searchParams.set("state", state)
  // auth_type=rerequest forces Meta to re-prompt for scopes the user previously
  // declined, which is what we want on a fresh Connect click.
  metaUrl.searchParams.set("auth_type", "rerequest")

  const response = NextResponse.redirect(metaUrl.toString())
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/platform-connections/facebook",
    maxAge: STATE_TTL_SECONDS,
  })
  return response
}
