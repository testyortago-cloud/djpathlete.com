// app/api/admin/platform-connections/youtube/connect/route.ts
// Step 1 of the YouTube OAuth flow. Admin clicks Connect → we redirect them to
// Google's consent screen with the scopes we need, plus a CSRF state cookie
// that the callback route verifies.

import crypto from "crypto"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
]

const STATE_COOKIE = "yt_oauth_state"
const STATE_TTL_SECONDS = 60 * 10 // 10 minutes

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID
  const base = siteUrl()
  if (!clientId || !base) {
    return NextResponse.json(
      { error: "YOUTUBE_CLIENT_ID or NEXTAUTH_URL is not set." },
      { status: 500 },
    )
  }

  const state = crypto.randomBytes(32).toString("hex")
  const redirectUri = `${base}/api/admin/platform-connections/youtube/callback`

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  googleUrl.searchParams.set("client_id", clientId)
  googleUrl.searchParams.set("redirect_uri", redirectUri)
  googleUrl.searchParams.set("response_type", "code")
  googleUrl.searchParams.set("scope", SCOPES.join(" "))
  // access_type=offline + prompt=consent is what gets us a refresh_token every time
  googleUrl.searchParams.set("access_type", "offline")
  googleUrl.searchParams.set("prompt", "consent")
  googleUrl.searchParams.set("include_granted_scopes", "true")
  googleUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(googleUrl.toString())
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/platform-connections/youtube",
    maxAge: STATE_TTL_SECONDS,
  })
  return response
}
