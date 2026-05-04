import { describe, it, expect } from "vitest"
import { buildAuthorizationUrl, signState, verifyState } from "@/lib/ads/oauth"

const TEST_SECRET = "test-secret-do-not-use-in-prod"

describe("signState / verifyState", () => {
  it("signs and verifies a payload round-trip", () => {
    const state = signState({ user_id: "u1", nonce: "abc" }, TEST_SECRET)
    expect(typeof state).toBe("string")
    const verified = verifyState<{ user_id: string; nonce: string }>(state, TEST_SECRET)
    expect(verified).toEqual({ user_id: "u1", nonce: "abc" })
  })

  it("rejects tampered state", () => {
    const state = signState({ user_id: "u1" }, TEST_SECRET)
    const tampered = state.slice(0, -2) + "xx"
    expect(verifyState(tampered, TEST_SECRET)).toBeNull()
  })

  it("rejects state signed with a different secret", () => {
    const state = signState({ user_id: "u1" }, TEST_SECRET)
    expect(verifyState(state, "different-secret")).toBeNull()
  })

  it("rejects malformed state with no separator", () => {
    expect(verifyState("not-a-state", TEST_SECRET)).toBeNull()
  })
})

describe("buildAuthorizationUrl", () => {
  it("includes required OAuth params with the adwords scope", () => {
    const url = buildAuthorizationUrl({
      client_id: "test-client-id",
      redirect_uri: "https://example.com/callback",
      state: "state-token",
    })
    const parsed = new URL(url)
    expect(parsed.host).toBe("accounts.google.com")
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id")
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback")
    expect(parsed.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/adwords")
    expect(parsed.searchParams.get("access_type")).toBe("offline")
    expect(parsed.searchParams.get("prompt")).toBe("consent")
    expect(parsed.searchParams.get("state")).toBe("state-token")
    expect(parsed.searchParams.get("response_type")).toBe("code")
  })
})
