// app/api/admin/platform-connections/tiktok/connect/route.ts
// Step 1 of the TikTok OAuth flow. Redirects the admin to TikTok's consent
// screen with the scopes we need plus a CSRF state cookie that the callback
// route verifies.

import crypto from "crypto"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

const SCOPES = ["user.info.basic", "user.info.profile", "user.info.stats", "video.publish", "video.list"]

const STATE_COOKIE = "tk_oauth_state"
const STATE_TTL_SECONDS = 60 * 10 // 10 minutes

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const base = siteUrl()
  if (!clientKey || !base) {
    return NextResponse.json(
      { error: "TIKTOK_CLIENT_KEY or NEXTAUTH_URL is not set." },
      { status: 500 },
    )
  }

  const state = crypto.randomBytes(32).toString("hex")
  const redirectUri = `${base}/api/admin/platform-connections/tiktok/callback`

  // TikTok auth lives on www.tiktok.com, not open.tiktokapis.com.
  const tiktokUrl = new URL("https://www.tiktok.com/v2/auth/authorize/")
  tiktokUrl.searchParams.set("client_key", clientKey)
  tiktokUrl.searchParams.set("redirect_uri", redirectUri)
  tiktokUrl.searchParams.set("response_type", "code")
  tiktokUrl.searchParams.set("scope", SCOPES.join(","))
  tiktokUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(tiktokUrl.toString())
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/platform-connections/tiktok",
    maxAge: STATE_TTL_SECONDS,
  })
  return response
}
