import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  exchangeCodeForTokens: vi.fn(),
  verifyState: vi.fn(),
  connectPlatform: vi.fn(),
  upsertGoogleAdsAccount: vi.fn(),
  listAccessibleCustomers: vi.fn(),
}))

vi.mock("@/lib/ads/oauth", () => ({
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
  verifyState: mocks.verifyState,
  signState: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  connectPlatform: mocks.connectPlatform,
}))
vi.mock("@/lib/db/google-ads-accounts", () => ({
  upsertGoogleAdsAccount: mocks.upsertGoogleAdsAccount,
}))
vi.mock("@/lib/ads/google-ads-client", () => ({
  listAccessibleCustomers: mocks.listAccessibleCustomers,
}))

import { GET } from "@/app/api/integrations/google-ads/callback/route"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_ADS_CLIENT_ID = "cid"
  process.env.GOOGLE_ADS_CLIENT_SECRET = "csec"
  process.env.GOOGLE_ADS_REDIRECT_URI = "http://localhost/cb"
  process.env.NEXTAUTH_SECRET = "secret"
})

function reqWith(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/integrations/google-ads/callback")
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe("GET /api/integrations/google-ads/callback", () => {
  it("400 when neither code nor error is present", async () => {
    const res = await GET(reqWith({}))
    expect(res.status).toBe(400)
  })

  it("redirects to settings with error when Google reports auth error", async () => {
    const res = await GET(reqWith({ error: "access_denied", error_description: "user denied" }))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/admin/ads/settings")
    expect(res.headers.get("location")).toContain("error=")
  })

  it("400 when state fails verification", async () => {
    mocks.verifyState.mockReturnValueOnce(null)
    const res = await GET(reqWith({ code: "abc", state: "bad" }))
    expect(res.status).toBe(400)
  })

  it("redirects to settings on success and persists tokens + account", async () => {
    mocks.verifyState.mockReturnValueOnce({ user_id: "u1" })
    mocks.exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "adwords",
    })
    mocks.listAccessibleCustomers.mockResolvedValueOnce([
      { customer_id: "1234567890", descriptive_name: null, currency_code: null, time_zone: null },
    ])
    mocks.upsertGoogleAdsAccount.mockResolvedValueOnce({})
    mocks.connectPlatform.mockResolvedValueOnce({})

    const res = await GET(reqWith({ code: "auth-code", state: "good" }))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/admin/ads/settings?connected=1")
    expect(mocks.connectPlatform).toHaveBeenCalledWith(
      "google_ads",
      expect.objectContaining({
        credentials: expect.objectContaining({ refresh_token: "rt" }),
        account_handle: "1234567890",
        connected_by: "u1",
      }),
    )
    expect(mocks.upsertGoogleAdsAccount).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "1234567890" }),
    )
  })

  it("still persists tokens when discovery returns zero accounts (no Developer Token yet)", async () => {
    mocks.verifyState.mockReturnValueOnce({ user_id: "u1" })
    mocks.exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "adwords",
    })
    mocks.listAccessibleCustomers.mockResolvedValueOnce([])
    mocks.connectPlatform.mockResolvedValueOnce({})

    const res = await GET(reqWith({ code: "auth-code", state: "good" }))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/admin/ads/settings?connected=1")
    expect(mocks.connectPlatform).toHaveBeenCalled()
    expect(mocks.upsertGoogleAdsAccount).not.toHaveBeenCalled()
  })
})
