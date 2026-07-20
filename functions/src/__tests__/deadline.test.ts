import { describe, it, expect, vi } from "vitest"
import { createDeadline, DeadlineExceededError, isAbortError } from "../lib/deadline.js"

/** Controllable clock so budget expiry is deterministic (no real waiting). */
function fakeClock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe("createDeadline", () => {
  it("reports the full budget as remaining before any time passes", () => {
    const clock = fakeClock()
    const d = createDeadline(60_000, "Week generation", clock.now)
    expect(d.remainingMs()).toBe(60_000)
    expect(d.expired()).toBe(false)
    d.dispose()
  })

  it("counts down as the clock advances", () => {
    const clock = fakeClock()
    const d = createDeadline(60_000, "Week generation", clock.now)
    clock.advance(25_000)
    expect(d.remainingMs()).toBe(35_000)
    expect(d.expired()).toBe(false)
    d.dispose()
  })

  it("floors remaining at 0 rather than going negative", () => {
    const clock = fakeClock()
    const d = createDeadline(10_000, "Week generation", clock.now)
    clock.advance(30_000)
    expect(d.remainingMs()).toBe(0)
    expect(d.expired()).toBe(true)
    d.dispose()
  })

  it("assertLive is a no-op while budget remains", () => {
    const clock = fakeClock()
    const d = createDeadline(10_000, "Week generation", clock.now)
    clock.advance(9_999)
    expect(() => d.assertLive("exercise selector")).not.toThrow()
    d.dispose()
  })

  it("assertLive throws DeadlineExceededError naming the stage once spent", () => {
    const clock = fakeClock()
    const d = createDeadline(10_000, "Week generation", clock.now)
    clock.advance(10_001)
    let caught: unknown
    try {
      d.assertLive("exercise selector")
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DeadlineExceededError)
    const err = caught as DeadlineExceededError
    expect(err.stage).toBe("exercise selector")
    expect(err.budgetMs).toBe(10_000)
    // The message is what lands in ai_jobs.error and in the coach's failure
    // email — it must say what happened and in what budget, not just "aborted".
    expect(err.message).toContain("Week generation")
    expect(err.message).toContain("10s")
    expect(err.message).toContain("exercise selector")
    d.dispose()
  })

  it("aborts its signal when the real timer fires", async () => {
    vi.useFakeTimers()
    try {
      const d = createDeadline(5_000, "Week generation")
      expect(d.signal.aborted).toBe(false)
      vi.advanceTimersByTime(5_000)
      expect(d.signal.aborted).toBe(true)
      d.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("dispose cancels the timer so the signal never aborts afterwards", () => {
    vi.useFakeTimers()
    try {
      const d = createDeadline(5_000, "Week generation")
      d.dispose()
      vi.advanceTimersByTime(60_000)
      // Work finished early; a late abort would be a phantom failure.
      expect(d.signal.aborted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("isAbortError", () => {
  it("recognizes the Anthropic SDK user-abort error by name", () => {
    const err = Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })
    expect(isAbortError(err)).toBe(true)
  })

  it("recognizes a raw DOMException-style AbortError", () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    expect(isAbortError(err)).toBe(true)
  })

  it("recognizes our own DeadlineExceededError", () => {
    expect(isAbortError(new DeadlineExceededError("Week generation", "architect", 1000))).toBe(true)
  })

  it("does NOT claim ordinary failures are aborts", () => {
    // Guards the retry path: a 529 must stay retryable.
    expect(isAbortError(Object.assign(new Error("overloaded"), { status: 529 }))).toBe(false)
    expect(isAbortError(new Error("boom"))).toBe(false)
    expect(isAbortError(new SyntaxError("bad json"))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})
