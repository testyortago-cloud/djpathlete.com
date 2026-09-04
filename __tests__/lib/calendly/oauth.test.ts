// @vitest-environment node
//
// The state helper here is NOT the one in lib/ads/oauth.ts, and the difference
// is deliberate. That one validates the HMAC and nothing else, so a signed
// state stays valid forever -- a real, pre-existing weakness in three shipped
// flows (google-ads, gmail, gsc), named in the phase 2 spec §1.2 and left
// alone there. This one checks `iat` against a TTL, and the callback pairs it
// with a nonce cookie, because a signature proves WE minted the state, not
// that THIS BROWSER asked for it.
import { describe, it, expect, vi } from "vitest"
import {
  createPkcePair, signState, verifyState, buildAuthorizationUrl,
  exchangeCodeForTokens, refreshAccessToken, CalendlyOAuthError,
  CALENDLY_STATE_TTL_SECONDS,
} from "@/lib/calendly/oauth"

const SECRET = "test-secret"
const payload = { business_id: "biz-1", host_id: "host-1", user_id: "user-1", nonce: "n1", iat: 1_000_000 }

describe("state", () => {
  it("round-trips a payload inside the TTL", () => {
    const s = signState(payload, SECRET)
    expect(verifyState(s, SECRET, payload.iat + 10)).toEqual(payload)
  })

  it("REJECTS a state older than the TTL", () => {
    const s = signState(payload, SECRET)
    expect(verifyState(s, SECRET, payload.iat + CALENDLY_STATE_TTL_SECONDS + 1)).toBeNull()
  })

  it("rejects a state signed with a different secret", () => {
    expect(verifyState(signState(payload, "other"), SECRET, payload.iat + 10)).toBeNull()
  })

  it("rejects a tampered payload", () => {
    const s = signState(payload, SECRET)
    const [body, sig] = s.split(".")
    const evil = Buffer.from(JSON.stringify({ ...payload, business_id: "biz-2" }), "utf8").toString("base64url")
    expect(verifyState(`${evil}.${sig}`, SECRET, payload.iat + 10)).toBeNull()
  })

  it("rejects a state issued in the future beyond clock skew", () => {
    expect(verifyState(signState(payload, SECRET), SECRET, payload.iat - 120)).toBeNull()
  })
})

describe("PKCE", () => {
  it("produces a verifier and an S256 challenge that differ", () => {
    const { verifier, challenge } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge).not.toBe(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)  // base64url, no padding
  })

  it("produces a different pair each call", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier)
  })
})

describe("buildAuthorizationUrl", () => {
  it("sends S256 and the challenge, never the verifier", () => {
    const { verifier, challenge } = createPkcePair()
    const url = new URL(buildAuthorizationUrl({
      clientId: "cid", redirectUri: "https://x/cb", state: "st", challenge,
    }))
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBe(challenge)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.toString()).not.toContain(verifier)
  })
})

describe("refreshAccessToken", () => {
  it("classifies invalid_grant as its own kind — it is the one non-transient failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    await expect(refreshAccessToken({
      refreshToken: "r", clientId: "c", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: "invalid_grant" })
  })

  it("classifies a 503 as http, NOT invalid_grant — a transient fault must not retire a connection", async () => {
    const fetchImpl = vi.fn(async () => new Response("upstream", { status: 503 }))
    await expect(refreshAccessToken({
      refreshToken: "r", clientId: "c", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: "http", status: 503 })
  })

  it("returns the ROTATED refresh token, not the one it sent", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: "a2", refresh_token: "r2", expires_in: 7200, token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }))
    const out = await refreshAccessToken({
      refreshToken: "r1", clientId: "c", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out.refresh_token).toBe("r2")
  })
})

describe("exchangeCodeForTokens", () => {
  it("sends the code_verifier", async () => {
    let sentBody = ""
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      sentBody = String(init.body)
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 7200, token_type: "Bearer" }),
        { status: 200, headers: { "content-type": "application/json" } })
    })
    await exchangeCodeForTokens({
      code: "code-1", verifier: "ver-1", clientId: "c", clientSecret: "s",
      redirectUri: "https://x/cb", fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(sentBody).toContain("code_verifier=ver-1")
  })

  it("rejects a 200 whose body is not a token response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ hello: "world" }),
      { status: 200, headers: { "content-type": "application/json" } }))
    await expect(exchangeCodeForTokens({
      code: "c", verifier: "v", clientId: "c", clientSecret: "s", redirectUri: "https://x/cb",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: "shape" })
  })
})
