import { describe, it, expect, vi, afterEach } from "vitest"
import { withTimeout } from "@/lib/with-timeout"

afterEach(() => {
  vi.useRealTimers()
})

describe("withTimeout", () => {
  it("resolves with the promise value when it beats the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 5000, "too slow")).resolves.toBe("ok")
  })

  it("rejects with the timeout message when the promise never settles", async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise<never>(() => {}), 5000, "too slow")
    const assertion = expect(p).rejects.toThrow("too slow")
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
  })

  it("clears its timer once the promise settles — no dangling timeout", async () => {
    vi.useFakeTimers()
    await expect(withTimeout(Promise.resolve("ok"), 60_000, "too slow")).resolves.toBe("ok")
    expect(vi.getTimerCount()).toBe(0) // finally { clearTimeout } — a leaked timer would leave 1
  })

  it("propagates the promise's own rejection, not the timeout message", async () => {
    await expect(withTimeout(Promise.reject(new Error("real failure")), 5000, "too slow")).rejects.toThrow(
      "real failure",
    )
  })
})
