// app/api/admin/platform-connections/linkedin/callback/route.ts
// Step 2 of the LinkedIn OAuth flow. LinkedIn redirects the admin back here
// with ?code=... — we verify the CSRF state cookie, exchange the code for an
// access token, look up the Company Pages the admin manages, and persist the
// first one (id + localized name) into the linkedin row.
//
// Credentials stored: { access_token, organization_id }. The LinkedIn plugin
// (lib/social/plugins/linkedin.ts) expects exactly this shape.
//
// LinkedIn access tokens live 60 days and are not auto-refreshed by default —
// when they expire, the admin just hits Reconnect.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { connectPlatform } from "@/lib/db/platform-connections"

const STATE_COOKIE = "li_oauth_state"
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
const ORG_ACLS_URL =
  "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED"

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(reason: string, params: Record<string, string> = {}) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(reason, "linkedin")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = NextResponse.redirect(url.toString())
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/admin/platform-connections/linkedin" })
  return response
}

function parseOrgId(urn: string | undefined): string | null {
  if (!urn) return null
  const match = urn.match(/urn:li:organization:(\d+)/)
  return match ? match[1] : null
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

  const clientId = process.env.LINKEDIN_CLIENT_ID
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET
  const base = siteUrl()
  if (!clientId || !clientSecret || !base) {
    return redirectHome("error", { reason: "env_missing" })
  }

  const redirectUri = `${base}/api/admin/platform-connections/linkedin/callback`

  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  })

  if (!tokenResp.ok) {
    const text = await tokenResp.text().catch(() => "")
    console.error("[linkedin/callback] token exchange failed", tokenResp.status, text)
    return redirectHome("error", { reason: "token_exchange" })
  }

  const tokenData = (await tokenResp.json()) as {
    access_token?: string
    expires_in?: number
    scope?: string
  }

  if (!tokenData.access_token) {
    return redirectHome("error", { reason: "token_exchange" })
  }

  // Find the first Company Page the admin manages.
  const aclsResp = await fetch(ORG_ACLS_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  })
  if (!aclsResp.ok) {
    const text = await aclsResp.text().catch(() => "")
    console.error("[linkedin/callback] organizationAcls lookup failed", aclsResp.status, text)
    return redirectHome("error", { reason: "pages_lookup" })
  }
  const aclsData = (await aclsResp.json()) as {
    elements?: Array<{ organizationalTarget?: string; role?: string; state?: string }>
  }
  const firstOrgUrn = aclsData.elements?.[0]?.organizationalTarget
  const organizationId = parseOrgId(firstOrgUrn)
  if (!organizationId) {
    return redirectHome("error", { reason: "no_pages" })
  }

  // Best-effort: fetch the Page's localized name for display.
  let accountHandle: string | null = null
  try {
    const orgResp = await fetch(
      `https://api.linkedin.com/v2/organizations/${organizationId}?projection=(localizedName,vanityName)`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    )
    if (orgResp.ok) {
      const orgData = (await orgResp.json()) as { localizedName?: string; vanityName?: string }
      accountHandle = orgData.localizedName ?? (orgData.vanityName ? `@${orgData.vanityName}` : null)
    }
  } catch (err) {
    console.warn("[linkedin/callback] organization name lookup failed (non-fatal)", err)
  }

  try {
    await connectPlatform("linkedin", {
      credentials: {
        access_token: tokenData.access_token,
        organization_id: organizationId,
      },
      account_handle: accountHandle,
      connected_by: session.user.id,
    })
  } catch (err) {
    console.error("[linkedin/callback] connectPlatform failed", err)
    return redirectHome("error", { reason: "db_write" })
  }

  return redirectHome("connected")
}
