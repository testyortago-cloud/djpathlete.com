import { describe, it, expect } from "vitest"
import { scrubMetadata } from "@/lib/audit/scrub"

describe("scrubMetadata", () => {
  it("redacts password-like keys at any depth", () => {
    const input = {
      email: "x@example.com",
      password: "hunter2",
      nested: { api_key: "sk_live_123", Token: "t", innocent: "ok" },
    }
    const out = scrubMetadata(input)
    expect(out.password).toBe("[REDACTED]")
    expect((out.nested as Record<string, unknown>).api_key).toBe("[REDACTED]")
    expect((out.nested as Record<string, unknown>).Token).toBe("[REDACTED]")
    expect((out.nested as Record<string, unknown>).innocent).toBe("ok")
    expect(out.email).toBe("x@example.com")
  })

  it("redacts keys regardless of case", () => {
    const out = scrubMetadata({ PASSWORD: "x", Password_Hash: "y", SECRET: "z" })
    expect(out.PASSWORD).toBe("[REDACTED]")
    expect(out.Password_Hash).toBe("[REDACTED]")
    expect(out.SECRET).toBe("[REDACTED]")
  })

  it("truncates oversized payloads to a sample", () => {
    const big = { huge: "x".repeat(20_000) }
    const out = scrubMetadata(big)
    expect(out.truncated).toBe(true)
    expect(typeof out.sample).toBe("string")
    expect((out.sample as string).length).toBeLessThanOrEqual(1100)
  })

  it("returns {} for null/undefined input", () => {
    expect(scrubMetadata(null)).toEqual({})
    expect(scrubMetadata(undefined)).toEqual({})
  })

  it("redacts camelCase secret keys", () => {
    const out = scrubMetadata({
      accessToken: "ya29.xxx",
      refreshToken: "1//xxx",
      bearerToken: "xxx",
      apiKey: "sk_live_yyy",
      apiSecret: "zzz",
      innocent: "ok",
    })
    expect(out.accessToken).toBe("[REDACTED]")
    expect(out.refreshToken).toBe("[REDACTED]")
    expect(out.bearerToken).toBe("[REDACTED]")
    expect(out.apiKey).toBe("[REDACTED]")
    expect(out.apiSecret).toBe("[REDACTED]")
    expect(out.innocent).toBe("ok")
  })

  it("does NOT redact substrings that aren't secret keys", () => {
    const out = scrubMetadata({
      mypassword_field: "ok", // 'password' substring inside a longer word with no underscore boundary on the left
      username: "alice",
      description: "contains the word token in prose",
    })
    // mypassword_field has no boundary before 'password' (m-y-p) → should NOT match
    expect(out.mypassword_field).toBe("ok")
    expect(out.username).toBe("alice")
    expect(out.description).toBe("contains the word token in prose")
  })

  it("redacts secrets inside arrays", () => {
    const out = scrubMetadata({
      items: [
        { name: "x", password: "p1" },
        { name: "y", api_key: "k2" },
      ],
    })
    const items = out.items as Array<Record<string, unknown>>
    expect(items[0].password).toBe("[REDACTED]")
    expect(items[1].api_key).toBe("[REDACTED]")
    expect(items[0].name).toBe("x")
  })

  it("returns {} for primitive inputs (string, number, boolean)", () => {
    expect(scrubMetadata("hello")).toEqual({})
    expect(scrubMetadata(42)).toEqual({})
    expect(scrubMetadata(true)).toEqual({})
  })

  it("handles unserializable inputs (circular refs)", () => {
    const circular: Record<string, unknown> = { name: "ok" }
    circular.self = circular
    const out = scrubMetadata(circular)
    expect(out.truncated).toBe(true)
    expect(out.sample).toBe("[unserializable]")
  })
})
