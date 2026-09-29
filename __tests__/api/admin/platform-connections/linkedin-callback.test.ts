// @vitest-environment node
//
// The LinkedIn OAuth callback. Its Page lookup called the unversioned
// /v2/organizationAcls, which LinkedIn sunset on 2024-12-16, so every
// connection failed at the last step as "pages_lookup". The fake LinkedIn
// below answers ONLY the versioned /rest endpoints, the way the real one does
// now: a /v2 call gets a 426 here, as it would there.
//
// The success case is the positive control for the three refusals, which all
// assert zero writes and would pass just as well against a route that never
// writes at all.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "admin-1", role: "admin" } })),
}))

const connectCalls: Array<[string, Record<string, unknown>]> = []
vi.mock("@/lib/db/platform-connections", () => ({
  connectPlatform: vi.fn(async (name: string, input: Record<string, unknown>) => {
    connectCalls.push([name, input])
  }),
}))

vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn(async () => {}) }))

import { GET } from "@/app/api/admin/platform-connections/linkedin/callback/route"

const BASE = "https://www.example.test"
const STATE = "state-abc"

type AclElement = Record<string, string>
let aclStatus = 200
let aclElements: AclElement[] = []
const fetched: Array<{ url: string; headers: Record<string, string> }> = []

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function fakeLinkedIn(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  fetched.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
  if (url === "https://www.linkedin.com/oauth/v2/accessToken") {
    return Promise.resolve(json(200, { access_token: "li-token", expires_in: 5184000 }))
  }
  if (url.startsWith("https://api.linkedin.com/v2/")) {
    return Promise.resolve(json(426, { message: "Requested version  is not active" }))
  }
  if (url.startsWith("https://api.linkedin.com/rest/organizationAcls?")) {
    return Promise.resolve(
      aclStatus === 200 ? json(200, { elements: aclElements }) : json(aclStatus, { message: "denied" }),
    )
  }
  if (url === "https://api.linkedin.com/rest/organizations/2414183") {
    return Promise.resolve(json(200, { localizedName: "DJP Athlete" }))
  }
  return Promise.resolve(json(404, { message: `unexpected ${url}` }))
}

function callback(query: string, cookie = `li_oauth_state=${STATE}`) {
  return GET(
    new NextRequest(`${BASE}/api/admin/platform-connections/linkedin/callback?${query}`, {
      headers: { cookie },
    }),
  )
}

function redirectParams(res: Response): URLSearchParams {
  return new URL(res.headers.get("location") ?? "").searchParams
}

beforeEach(() => {
  connectCalls.length = 0
  fetched.length = 0
  aclStatus = 200
  aclElements = [{ role: "ADMINISTRATOR", state: "APPROVED", organizationTarget: "urn:li:organization:2414183" }]
  vi.stubEnv("NEXTAUTH_URL", BASE)
  vi.stubEnv("LINKEDIN_CLIENT_ID", "client-id")
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "client-secret")
  vi.stubGlobal("fetch", vi.fn(fakeLinkedIn))
})

describe("LinkedIn OAuth callback", () => {
  it("connects the Page through the versioned API and saves its id and name", async () => {
    const res = await callback(`code=auth-code&state=${STATE}`)

    expect(redirectParams(res).get("connected")).toBe("linkedin")
    expect(connectCalls).toEqual([
      [
        "linkedin",
        expect.objectContaining({
          credentials: { access_token: "li-token", organization_id: "2414183" },
          account_handle: "DJP Athlete",
        }),
      ],
    ])

    const apiCalls = fetched.filter((f) => f.url.startsWith("https://api.linkedin.com/"))
    expect(apiCalls.map((f) => new URL(f.url).pathname)).toEqual([
      "/rest/organizationAcls",
      "/rest/organizations/2414183",
    ])
    for (const call of apiCalls) {
      expect(call.headers["LinkedIn-Version"]).toMatch(/^\d{6}$/)
      expect(call.headers.Authorization).toBe("Bearer li-token")
    }
  })

  it("reads the Page from `organization` when LinkedIn names it that", async () => {
    aclElements = [{ role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:2414183" }]
    const res = await callback(`code=auth-code&state=${STATE}`)

    expect(redirectParams(res).get("connected")).toBe("linkedin")
    expect(connectCalls[0]?.[1]).toMatchObject({ credentials: { organization_id: "2414183" } })
  })

  it("reports pages_lookup and saves nothing when the Page lookup is refused", async () => {
    aclStatus = 403
    const res = await callback(`code=auth-code&state=${STATE}`)

    expect(Object.fromEntries(redirectParams(res))).toEqual({ error: "linkedin", reason: "pages_lookup" })
    expect(connectCalls).toHaveLength(0)
  })

  it("reports no_pages and saves nothing when the account administers no Page", async () => {
    aclElements = []
    const res = await callback(`code=auth-code&state=${STATE}`)

    expect(Object.fromEntries(redirectParams(res))).toEqual({ error: "linkedin", reason: "no_pages" })
    expect(connectCalls).toHaveLength(0)
  })

  it("passes LinkedIn's own refusal through as the reason, without calling the API", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await callback(
      `error=unauthorized_scope_error&error_description=${encodeURIComponent('Scope "w_organization_social" is not authorized')}&state=${STATE}`,
    )

    expect(Object.fromEntries(redirectParams(res))).toEqual({
      error: "linkedin",
      reason: "unauthorized_scope_error",
    })
    expect(fetched).toHaveLength(0)
    expect(connectCalls).toHaveLength(0)
  })
})
