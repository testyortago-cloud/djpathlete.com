import { describe, it, expect } from "vitest"
import { ATTR_COOKIE_NAME, ATTR_COOKIE_MAX_AGE, parseAttrCookie, generateSessionId } from "@/lib/marketing/cookies"

describe("ATTR_COOKIE_NAME", () => {
  it("is djp_attr", () => {
    expect(ATTR_COOKIE_NAME).toBe("djp_attr")
  })
})

describe("ATTR_COOKIE_MAX_AGE", () => {
  it("is 1 year in seconds", () => {
    expect(ATTR_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365)
  })
})

describe("parseAttrCookie", () => {
  it("returns null when no cookie header", () => {
    expect(parseAttrCookie(undefined)).toBeNull()
    expect(parseAttrCookie("")).toBeNull()
  })

  it("returns null when djp_attr is not in the cookie header", () => {
    expect(parseAttrCookie("foo=bar; baz=qux")).toBeNull()
  })

  it("returns the session id when djp_attr is present", () => {
    expect(parseAttrCookie("djp_attr=abc123; foo=bar")).toBe("abc123")
    expect(parseAttrCookie("foo=bar; djp_attr=xyz789")).toBe("xyz789")
  })

  it("rejects values that do not match expected format", () => {
    // Cookie values containing illegal characters get rejected
    expect(parseAttrCookie("djp_attr=has spaces")).toBeNull()
    expect(parseAttrCookie('djp_attr=with"quote')).toBeNull()
  })
})

describe("generateSessionId", () => {
  it("returns a string between 16 and 64 chars", () => {
    const id = generateSessionId()
    expect(id.length).toBeGreaterThanOrEqual(16)
    expect(id.length).toBeLessThanOrEqual(64)
  })

  it("generates unique values across calls", () => {
    const ids = new Set([generateSessionId(), generateSessionId(), generateSessionId(), generateSessionId()])
    expect(ids.size).toBe(4)
  })

  it("contains only URL-safe characters", () => {
    const id = generateSessionId()
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
