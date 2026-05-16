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
})
