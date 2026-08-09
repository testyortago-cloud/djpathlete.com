import { describe, it, expect } from "vitest"
import { scopeCss } from "@/lib/funnels/compile/css-scope"

/** Collapse whitespace so assertions aren't hostage to postcss formatting. */
function norm(css: string): string {
  return css.replace(/\s+/g, " ").trim()
}

describe("scopeCss", () => {
  it("prefixes a class selector with the funnel root", () => {
    expect(norm(scopeCss(".hero { color: red }"))).toBe("#djp-funnel-root .hero { color: red }")
  })

  it("collapses html, body and :root onto the root element itself", () => {
    expect(norm(scopeCss("body { margin: 0 }"))).toBe("#djp-funnel-root { margin: 0 }")
    expect(norm(scopeCss("html { font-size: 18px }"))).toBe("#djp-funnel-root { font-size: 18px }")
    expect(norm(scopeCss(":root { --x: 1 }"))).toBe("#djp-funnel-root { --x: 1 }")
  })

  it("rewrites a descendant selector rooted at body", () => {
    expect(norm(scopeCss("body .card { padding: 4px }"))).toBe(
      "#djp-funnel-root .card { padding: 4px }",
    )
  })

  it("prefixes every selector in a comma-separated list", () => {
    expect(norm(scopeCss(".a, .b { color: red }"))).toBe(
      "#djp-funnel-root .a, #djp-funnel-root .b { color: red }",
    )
  })

  it("scopes rules nested inside @media", () => {
    const out = norm(scopeCss("@media (max-width: 600px) { .a { display: none } }"))
    expect(out).toBe("@media (max-width: 600px) { #djp-funnel-root .a { display: none } }")
  })

  it("does NOT prefix keyframe steps, which would break the animation", () => {
    const out = norm(scopeCss("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"))
    expect(out).toBe("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }")
    expect(out).not.toContain("#djp-funnel-root from")
  })

  it("strips @import, which could pull in an off-site stylesheet", () => {
    const out = scopeCss('@import url("https://evil.example/x.css"); .a { color: red }')
    expect(out).not.toContain("@import")
    expect(norm(out)).toContain("#djp-funnel-root .a")
  })

  it("does not double-prefix a selector that is already scoped", () => {
    const out = norm(scopeCss("#djp-funnel-root .a { color: red }"))
    expect(out).toBe("#djp-funnel-root .a { color: red }")
  })

  it("leaves @font-face alone", () => {
    const out = norm(scopeCss('@font-face { font-family: "X"; src: url(/x.woff2) }'))
    expect(out).toBe('@font-face { font-family: "X"; src: url(/x.woff2) }')
  })

  it("accepts a custom root id", () => {
    expect(norm(scopeCss(".a { color: red }", "preview-root"))).toBe(
      "#preview-root .a { color: red }",
    )
  })

  it("returns an empty string for empty input", () => {
    expect(scopeCss("")).toBe("")
  })

  it("throws on unparseable css so publish fails loudly instead of shipping it", () => {
    // The orchestrator catches this and reports css_parse_failed, which is a
    // fatal compile code — a page with broken styles must not go live silently.
    expect(() => scopeCss(".a { color: red ")).toThrow(/unclosed/i)
    expect(() => scopeCss("@media {")).toThrow()
  })
})
