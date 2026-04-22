// app/api/admin/platform-connections/linkedin/connect/route.ts
// Step 1 of the LinkedIn OAuth flow. Redirects the admin to LinkedIn's consent
// screen with the scopes we need for Company Page posting plus a CSRF state
// cookie that the callback route verifies.

import crypto from "crypto"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

// w_organization_social  → post UGC on behalf of the Company Page
// r_organization_social  → read the Page's social actions (for analytics)
// rw_organization_admin  → list organizations the user administers (to pick the right Page)
const SCOPES = ["w_organization_social", "r_organization_social", "rw_organization_admin"]

const STATE_COOKIE = "li_oauth_state"
const STATE_TTL_SECONDS = 60 * 10 // 10 minutes

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID
  const base = siteUrl()
  if (!clientId || !base) {
    return NextResponse.json(
      { error: "LINKEDIN_CLIENT_ID or NEXTAUTH_URL is not set." },
      { status: 500 },
    )
  }

  const state = crypto.randomBytes(32).toString("hex")
  const redirectUri = `${base}/api/admin/platform-connections/linkedin/callback`

  const linkedInUrl = new URL("https://www.linkedin.com/oauth/v2/authorization")
  linkedInUrl.searchParams.set("response_type", "code")
  linkedInUrl.searchParams.set("client_id", clientId)
  linkedInUrl.searchParams.set("redirect_uri", redirectUri)
  linkedInUrl.searchParams.set("scope", SCOPES.join(" "))
  linkedInUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(linkedInUrl.toString())
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/platform-connections/linkedin",
    maxAge: STATE_TTL_SECONDS,
  })
  return response
}
