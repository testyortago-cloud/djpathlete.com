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
import { recordAudit } from "@/lib/audit/record"
import { versionedHeaders } from "@/lib/social/plugins/linkedin"

const STATE_COOKIE = "li_oauth_state"
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
// Versioned /rest, never /v2: LinkedIn sunset the unversioned marketing
// endpoints on 2024-12-16, and a /v2 lookup here failed every connection at
// the last step, after the admin had already approved it.
// No role= filter: LinkedIn's "Content admin" is CONTENT_ADMINISTRATOR, which
// can post as the Page, and a role=ADMINISTRATOR query answers such a member
// with an empty list. The role is picked below instead.
const ORG_ACLS_URL = "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED"
const ORGANIZATIONS_URL = "https://api.linkedin.com/rest/organizations"
// Page roles that may publish as the Page, best first ("Super admin", then
// "Content admin"). Analysts, recruiters and the rest cannot.
const POSTING_ROLES = ["ADMINISTRATOR", "CONTENT_ADMINISTRATOR"]

interface OrgAcl {
  role?: string
  state?: string
  // The versioned API names the Page `organizationTarget` (its own docs also
  // show `organization`); `organizationalTarget` is the unversioned name.
  organizationTarget?: string
  organization?: string
  organizationalTarget?: string
}

function aclTarget(acl: OrgAcl): string | undefined {
  return acl.organizationTarget ?? acl.organization ?? acl.organizationalTarget
}

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
    // e.g. unauthorized_scope_error: 'Scope "w_organization_social" is not
    // authorized for your application' — the description names the missing
    // product, so it belongs in the logs.
    console.error("[linkedin/callback] authorization refused", errorParam, url.searchParams.get("error_description"))
    return redirectHome("error", { reason: errorParam })
  }
  // Every exit below logs. Vercel's request log does not keep the redirect's
  // query string, so an exit that logs nothing cannot be told apart from the
  // others after the fact: that is how three failed attempts went undiagnosed.
  if (!code || !stateParam || !stateCookie || stateParam !== stateCookie) {
    console.warn("[linkedin/callback] state_mismatch", {
      hasCode: Boolean(code),
      hasState: Boolean(stateParam),
      hasCookie: Boolean(stateCookie),
    })
    return redirectHome("error", { reason: "state_mismatch" })
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET
  const base = siteUrl()
  if (!clientId || !clientSecret || !base) {
    console.error("[linkedin/callback] env_missing", {
      LINKEDIN_CLIENT_ID: Boolean(clientId),
      LINKEDIN_CLIENT_SECRET: Boolean(clientSecret),
      NEXTAUTH_URL: Boolean(base),
    })
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
    console.error("[linkedin/callback] token response had no access_token", Object.keys(tokenData))
    return redirectHome("error", { reason: "token_exchange" })
  }

  // Find a Company Page this member can post as.
  const aclsResp = await fetch(ORG_ACLS_URL, { headers: versionedHeaders(tokenData.access_token) })
  if (!aclsResp.ok) {
    const text = await aclsResp.text().catch(() => "")
    console.error("[linkedin/callback] organizationAcls lookup failed", aclsResp.status, text)
    return redirectHome("error", { reason: "pages_lookup" })
  }
  const aclsData = (await aclsResp.json()) as { elements?: OrgAcl[] }
  const acls = aclsData.elements ?? []
  let organizationId: string | null = null
  for (const role of POSTING_ROLES) {
    const acl = acls.find((a) => a.role === role && parseOrgId(aclTarget(a)))
    if (acl) {
      organizationId = parseOrgId(aclTarget(acl))
      break
    }
  }
  if (!organizationId) {
    // Roles and Page URNs only — enough to say "Analyst, not admin" or
    // "a showcase page", with nothing secret in it.
    console.warn(
      "[linkedin/callback] no_pages",
      acls.map((a) => ({ role: a.role, state: a.state, target: aclTarget(a) })),
    )
    return redirectHome("error", { reason: "no_pages" })
  }

  // Best-effort: fetch the Page's localized name for display.
  let accountHandle: string | null = null
  try {
    const orgResp = await fetch(`${ORGANIZATIONS_URL}/${organizationId}`, {
      headers: versionedHeaders(tokenData.access_token),
    })
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
    await recordAudit({
      action: "integration.connected",
      category: "admin_write",
      target: { type: "integration", id: "linkedin", label: "linkedin" },
      request,
    })
  } catch (err) {
    console.error("[linkedin/callback] connectPlatform failed", err)
    return redirectHome("error", { reason: "db_write" })
  }

  return redirectHome("connected")
}
