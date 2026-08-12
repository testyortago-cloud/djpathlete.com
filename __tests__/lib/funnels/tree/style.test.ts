// Styles are the one part of this document that is genuinely user-authored free
// text, so they are the one part that must go through the existing sanitiser
// rather than being trusted because we built the object it came from.

import { describe, it, expect } from "vitest"
import { styleToCss } from "@/lib/funnels/tree/style"

describe("styleToCss", () => {
  it("expands sides into longhand properties", () => {
    // MUTANT KILLED: emitting the `padding` shorthand, which would force all
    // four sides and silently overwrite the ones the owner left alone.
    const css = styleToCss({ padding: { top: "10px", bottom: "20px" } })
    expect(css).toContain("padding-top:10px")
    expect(css).toContain("padding-bottom:20px")
    expect(css).not.toContain("padding-left")
  })

  it("emits background colour and image", () => {
    const css = styleToCss({ background: { color: "#ff0000", image: "https://x.test/a.png" } })
    expect(css).toContain("background-color:#ff0000")
    expect(css).toContain("background-image:url(")
  })

  it("strips a declaration the sanitiser rejects", () => {
    // MUTANT KILLED: building the string by concatenation and trusting it
    // because we built it. `safeStyle` exists precisely because a colour field
    // is a text input, and a text input takes anything.
    const css = styleToCss({ background: { color: "url(javascript:alert(1))" } })
    expect(css).not.toContain("javascript:")
  })

  it("keeps the safe declarations when one is stripped", () => {
    // MUTANT KILLED: dropping the whole style when any one declaration is bad,
    // which would lose the owner's padding because they typed a bad colour.
    const css = styleToCss({
      padding: { top: "8px" },
      background: { color: "url(javascript:alert(1))" },
    })
    expect(css).toContain("padding-top:8px")
    expect(css).not.toContain("javascript:")
  })

  it("returns an empty string for an empty style", () => {
    expect(styleToCss({})).toBe("")
  })

  it("merges type styles for text elements", () => {
    const css = styleToCss({}, { fontSize: "32px", color: "#111" })
    expect(css).toContain("font-size:32px")
    expect(css).toContain("color:#111")
  })

  it("emits alignment as text-align", () => {
    expect(styleToCss({ align: "center" })).toContain("text-align:center")
  })
})
