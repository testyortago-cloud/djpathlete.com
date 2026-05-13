import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const exchangeCodeForTokens = vi.fn()
const upsertGscProperty = vi.fn()
const signState = (await import("@/lib/gsc/oauth")).signState

vi.mock("@/lib/gsc/oauth", async (orig) => {
  const actual = await (orig() as Promise<typeof import("@/lib/gsc/oauth")>)
  return {
    ...actual,
    exchangeCodeForTokens,
  }
})
vi.mock("@/lib/db/gsc-properties", () => ({ upsertGscProperty }))

beforeEach(() => {
  exchangeCodeForTokens.mockReset()
  upsertGscProperty.mockReset()
  process.env.GOOGLE_CLIENT_ID = "cid"
  process.env.GOOGLE_CLIENT_SECRET = "secret"
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
  process.env.GSC_SITE_URL = "sc-domain:darrenjpaul.com"
  // SITE_URL is read from lib/constants — assume it's set via NEXT_PUBLIC_SITE_URL in test env
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test"
})

async function callRoute(query: Record<string, string>) {
  const { GET } = await import("@/app/api/admin/integrations/gsc/callback/route")
  const url = new URL("https://example.test/api/admin/integrations/gsc/callback")
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v))
  return GET(new NextRequest(url))
}

describe("/api/admin/integrations/gsc/callback", () => {
  it("rejects when state is missing", async () => {
    const res = await callRoute({ code: "the-code" })
    expect(res.status).toBe(400)
  })

  it("rejects tampered state", async () => {
    const res = await callRoute({ code: "the-code", state: "garbage.signature" })
    expect(res.status).toBe(400)
  })

  it("rejects when the verified state.kind is not 'gsc'", async () => {
    const state = signState({ userId: "u1", ts: Date.now(), kind: "ads" }, "shared-secret")
    const res = await callRoute({ code: "the-code", state })
    expect(res.status).toBe(400)
  })

  it("happy path: exchanges code, fetches sites.list, upserts row, redirects to admin page", async () => {
    const state = signState({ userId: "u1", ts: Date.now(), kind: "gsc" }, "shared-secret")
    exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3599,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
    })
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          siteEntry: [
            { siteUrl: "sc-domain:darrenjpaul.com", permissionLevel: "siteOwner" },
            { siteUrl: "https://other.example/", permissionLevel: "siteFullUser" },
          ],
        }),
        { status: 200 },
      ),
    )
    upsertGscProperty.mockResolvedValueOnce({ id: "row-id" })

    const res = await callRoute({ code: "the-code", state })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("https://example.test/admin/integrations/gsc?connected=1")
    expect(upsertGscProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        site_url: "sc-domain:darrenjpaul.com",
        refresh_token: "rt",
        access_token: "at",
        connected_by_user_id: "u1",
      }),
    )
    mockFetch.mockRestore()
  })

  it("redirects with error when user lacks access to the configured site", async () => {
    const state = signState({ userId: "u1", ts: Date.now(), kind: "gsc" }, "shared-secret")
    exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3599,
      token_type: "Bearer",
      scope: "x",
    })
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ siteEntry: [{ siteUrl: "https://other.example/" }] }), { status: 200 }),
    )

    const res = await callRoute({ code: "the-code", state })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://example.test/admin/integrations/gsc?error=no_site_access",
    )
    expect(upsertGscProperty).not.toHaveBeenCalled()
  })
})
