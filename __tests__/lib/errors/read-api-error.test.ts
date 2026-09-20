import { describe, expect, it } from "vitest"
import { readApiError } from "@/lib/errors/humanize"

function res(status: number, body: string) {
  return { ok: false, status, text: async () => body }
}

describe("readApiError", () => {
  // Regression: the posting buttons used `await res.text()`, which put the
  // whole JSON envelope in the toast -- the operator saw
  // {"error":"Source video still needs editing — mark it ready to post."}
  it("unwraps the { error } envelope route handlers answer with", async () => {
    const gated = "Source video still needs editing — mark it ready to post."
    await expect(readApiError(res(409, JSON.stringify({ error: gated })))).resolves.toBe(gated)
  })

  it("unwraps a { message } envelope too", async () => {
    await expect(readApiError(res(400, JSON.stringify({ message: "Caption is too long" })))).resolves.toBe(
      "Caption is too long",
    )
  })

  it("falls back to status wording on an empty body", async () => {
    await expect(readApiError(res(403, ""))).resolves.toBe("You don't have permission to do that.")
  })

  it("falls back to status wording rather than dumping an HTML error page", async () => {
    const html = `<!DOCTYPE html><html><body>${"x".repeat(500)}</body></html>`
    await expect(readApiError(res(500, html))).resolves.toBe("Our server hit an error. Please try again in a moment.")
  })

  it("passes through a short non-JSON one-liner", async () => {
    await expect(readApiError(res(409, "Already scheduled"))).resolves.toBe("Already scheduled")
  })

  it("uses the caller's fallback when the status has no special wording", async () => {
    await expect(readApiError(res(418, ""), "Publish now failed")).resolves.toBe("Publish now failed")
  })
})
