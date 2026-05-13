import { describe, expect, it, vi } from "vitest"
import {
  buildAuthorizationUrl,
  signState,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
} from "@/lib/gsc/oauth"

describe("buildAuthorizationUrl", () => {
  it("includes the webmasters.readonly scope and offline access", () => {
    const url = new URL(
      buildAuthorizationUrl({
        client_id: "cid-123",
        redirect_uri: "https://example.com/cb",
        state: "signed-state",
      }),
    )
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(url.searchParams.get("client_id")).toBe("cid-123")
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/cb")
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    )
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toBe("consent")
    expect(url.searchParams.get("state")).toBe("signed-state")
    expect(url.searchParams.get("response_type")).toBe("code")
  })
})

describe("signState / verifyState", () => {
  const SECRET = "test-secret"

  it("round-trips a payload", () => {
    const signed = signState({ userId: "u1", t: 123 }, SECRET)
    expect(verifyState<{ userId: string; t: number }>(signed, SECRET)).toEqual({
      userId: "u1",
      t: 123,
    })
  })

  it("rejects tampered state", () => {
    const signed = signState({ userId: "u1" }, SECRET)
    const tampered = signed.replace(/\.[A-Za-z0-9_-]+$/, ".AAAAA")
    expect(verifyState(tampered, SECRET)).toBeNull()
  })

  it("rejects state signed with a different secret", () => {
    const signed = signState({ userId: "u1" }, SECRET)
    expect(verifyState(signed, "other-secret")).toBeNull()
  })

  it("returns null on malformed state", () => {
    expect(verifyState("not-dot-separated", SECRET)).toBeNull()
    expect(verifyState("a.b.c", SECRET)).toBeNull()
  })
})

describe("exchangeCodeForTokens", () => {
  it("POSTs form-urlencoded to Google and returns parsed JSON", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 3599,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/webmasters.readonly",
        }),
        { status: 200 },
      ),
    )

    const tokens = await exchangeCodeForTokens({
      code: "the-code",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: "https://example.com/cb",
    })

    expect(tokens).toEqual({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3599,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
    })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("https://oauth2.googleapis.com/token")
    expect((init as RequestInit).method).toBe("POST")
    const body = (init as RequestInit).body as string
    expect(body).toContain("code=the-code")
    expect(body).toContain("grant_type=authorization_code")
    mockFetch.mockRestore()
  })

  it("throws on non-2xx response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("bad code", { status: 400 }))
    await expect(
      exchangeCodeForTokens({
        code: "x",
        client_id: "c",
        client_secret: "s",
        redirect_uri: "https://x",
      }),
    ).rejects.toThrow(/HTTP 400/)
    vi.restoreAllMocks()
  })
})

describe("refreshAccessToken", () => {
  it("POSTs refresh_token grant and returns new access token", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "at-2", expires_in: 3599, token_type: "Bearer", scope: "x" }),
        { status: 200 },
      ),
    )
    const out = await refreshAccessToken({
      refresh_token: "rt-1",
      client_id: "c",
      client_secret: "s",
    })
    expect(out.access_token).toBe("at-2")
    expect(out.expires_in).toBe(3599)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("https://oauth2.googleapis.com/token")
    expect((init as RequestInit).method).toBe("POST")
    const body = (init as RequestInit).body as string
    expect(body).toContain("refresh_token=rt-1")
    expect(body).toContain("grant_type=refresh_token")
    mockFetch.mockRestore()
  })

  it("throws on non-2xx response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("invalid_grant", { status: 400 }),
    )
    await expect(
      refreshAccessToken({ refresh_token: "rt-1", client_id: "c", client_secret: "s" }),
    ).rejects.toThrow(/HTTP 400/)
    vi.restoreAllMocks()
  })
})
