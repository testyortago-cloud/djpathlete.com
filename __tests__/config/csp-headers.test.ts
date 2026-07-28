// @vitest-environment node
//
// CSP is invisible to the rest of the suite: jsdom does not enforce it, so a
// frame/connect/img host that the policy forbids still "works" in every
// component test and fails only in a real browser. These assertions are the
// only place a missing allow-list entry is caught before production.
import { describe, it, expect } from "vitest"
import nextConfig from "@/next.config.mjs"

async function cspFor(path: string): Promise<string> {
  const headerRules = await (nextConfig as {
    headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>
  }).headers()
  const match = headerRules.find(
    (rule) => rule.source === path && rule.headers.some((h) => h.key === "Content-Security-Policy"),
  )
  const value = match?.headers.find((h) => h.key === "Content-Security-Policy")?.value
  if (!value) throw new Error(`No Content-Security-Policy header for source ${path}`)
  return value
}

function directive(csp: string, name: string): string {
  const found = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `))
  if (!found) throw new Error(`CSP has no ${name} directive`)
  return found
}

describe("Content-Security-Policy", () => {
  it("allows framing signed private-bucket URLs for the PDF receipt viewer", async () => {
    // ReceiptRowEditor frames the signed URL from signStatementDownload so the
    // browser's native PDF viewer sits beside the editable fields. Drop this
    // host and the iframe goes blank in production with a console-only error.
    expect(directive(await cspFor("/(.*)"), "frame-src")).toContain("https://storage.googleapis.com")
  })

  it("keeps the pre-existing frame-src hosts", async () => {
    const frameSrc = directive(await cspFor("/(.*)"), "frame-src")
    for (const host of [
      "'self'",
      "https://js.stripe.com",
      "https://hooks.stripe.com",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
    ]) {
      expect(frameSrc).toContain(host)
    }
  })

  it("still locks down object-src and frame-ancestors", async () => {
    const csp = await cspFor("/(.*)")
    expect(directive(csp, "object-src")).toBe("object-src 'none'")
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'")
  })
})
