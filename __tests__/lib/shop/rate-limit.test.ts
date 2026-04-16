import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { rateLimit } from "@/lib/shop/rate-limit"

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows the first request and returns correct remaining count", () => {
    const result = rateLimit("test-first", 5, 60_000)
    expect(result.ok).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it("allows up to max requests within the window", () => {
    const key = "test-max"
    const max = 3
    for (let i = 0; i < max; i++) {
      const result = rateLimit(key, max, 60_000)
      expect(result.ok).toBe(true)
    }
  })

  it("blocks the request after max is exceeded", () => {
    const key = "test-block"
    const max = 3
    for (let i = 0; i < max; i++) {
      rateLimit(key, max, 60_000)
    }
    const result = rateLimit(key, max, 60_000)
    expect(result.ok).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it("resets the counter after the window expires", () => {
    const key = "test-reset"
    const max = 2
    const windowMs = 60_000

    // Exhaust the limit
    for (let i = 0; i < max; i++) {
      rateLimit(key, max, windowMs)
    }
    const blocked = rateLimit(key, max, windowMs)
    expect(blocked.ok).toBe(false)

    // Advance time past the window
    vi.advanceTimersByTime(windowMs + 1)

    // Should be allowed again
    const result = rateLimit(key, max, windowMs)
    expect(result.ok).toBe(true)
    expect(result.remaining).toBe(max - 1)
  })

  it("uses separate buckets per key", () => {
    const max = 2
    const windowMs = 60_000

    // Exhaust key A
    for (let i = 0; i < max; i++) {
      rateLimit("key-a", max, windowMs)
    }
    rateLimit("key-a", max, windowMs) // blocked

    // key B should still be fresh
    const result = rateLimit("key-b", max, windowMs)
    expect(result.ok).toBe(true)
  })
})
