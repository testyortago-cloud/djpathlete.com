import { describe, expect, it, vi, beforeEach } from "vitest"

const getGscProperty = vi.fn()
const updateAccessToken = vi.fn()
const refreshAccessTokenLib = vi.fn()

vi.mock("@/lib/db/gsc-properties", () => ({
  getGscProperty,
  updateAccessToken,
}))
vi.mock("@/lib/gsc/oauth", () => ({
  refreshAccessToken: refreshAccessTokenLib,
}))

const { getValidAccessToken, searchAnalyticsQuery } = await import("@/lib/gsc/client")

beforeEach(() => {
  getGscProperty.mockReset()
  updateAccessToken.mockReset()
  refreshAccessTokenLib.mockReset()
  vi.restoreAllMocks()
  process.env.GOOGLE_CLIENT_ID = "cid"
  process.env.GOOGLE_CLIENT_SECRET = "secret"
})

describe("getValidAccessToken", () => {
  it("throws when no gsc_properties row exists", async () => {
    getGscProperty.mockResolvedValueOnce(null)
    await expect(getValidAccessToken()).rejects.toThrow(/not connected/i)
  })

  it("returns existing access_token when not near expiry", async () => {
    getGscProperty.mockResolvedValueOnce({
      id: "u1",
      access_token: "still-good",
      access_token_expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      refresh_token: "rt",
    })
    expect(await getValidAccessToken()).toBe("still-good")
    expect(refreshAccessTokenLib).not.toHaveBeenCalled()
  })

  it("refreshes when token expires within 60s and persists the new one", async () => {
    getGscProperty.mockResolvedValueOnce({
      id: "u1",
      access_token: "expiring",
      access_token_expires: new Date(Date.now() + 30 * 1000).toISOString(),
      refresh_token: "rt",
    })
    refreshAccessTokenLib.mockResolvedValueOnce({
      access_token: "fresh",
      expires_in: 3599,
      token_type: "Bearer",
      scope: "x",
    })
    expect(await getValidAccessToken()).toBe("fresh")
    expect(refreshAccessTokenLib).toHaveBeenCalledWith({
      refresh_token: "rt",
      client_id: "cid",
      client_secret: "secret",
    })
    expect(updateAccessToken).toHaveBeenCalledWith(
      "u1",
      "fresh",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    )
  })

  it("refreshes when access_token is null", async () => {
    getGscProperty.mockResolvedValueOnce({
      id: "u1",
      access_token: null,
      access_token_expires: null,
      refresh_token: "rt",
    })
    refreshAccessTokenLib.mockResolvedValueOnce({
      access_token: "first-ever",
      expires_in: 3599,
      token_type: "Bearer",
      scope: "x",
    })
    expect(await getValidAccessToken()).toBe("first-ever")
    expect(refreshAccessTokenLib).toHaveBeenCalledWith({
      refresh_token: "rt",
      client_id: "cid",
      client_secret: "secret",
    })
    expect(updateAccessToken).toHaveBeenCalled()
  })
})

describe("searchAnalyticsQuery", () => {
  it("POSTs to the right URL with Authorization: Bearer", async () => {
    getGscProperty.mockResolvedValueOnce({
      id: "u1",
      access_token: "at",
      access_token_expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      refresh_token: "rt",
    })
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [], rowCount: 0 }), { status: 200 }),
    )
    process.env.GSC_SITE_URL = "sc-domain:darrenjpaul.com"

    await searchAnalyticsQuery({
      startDate: "2026-05-12",
      endDate: "2026-05-12",
      dimensions: ["query", "page"],
      rowLimit: 25000,
    })

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Adarrenjpaul.com/searchAnalytics/query",
    )
    expect((init as RequestInit).method).toBe("POST")
    expect((init as Record<string, unknown>).headers).toMatchObject({
      Authorization: "Bearer at",
      "Content-Type": "application/json",
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      startDate: "2026-05-12",
      endDate: "2026-05-12",
      dimensions: ["query", "page"],
      rowLimit: 25000,
    })
  })

  it("throws OAuthBrokenError on 401", async () => {
    getGscProperty.mockResolvedValueOnce({
      id: "u1",
      access_token: "at",
      access_token_expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      refresh_token: "rt",
    })
    vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    process.env.GSC_SITE_URL = "sc-domain:darrenjpaul.com"

    await expect(
      searchAnalyticsQuery({
        startDate: "2026-05-12",
        endDate: "2026-05-12",
        dimensions: ["query", "page"],
        rowLimit: 25000,
      }),
    ).rejects.toMatchObject({ name: "OAuthBrokenError" })
  })
})
