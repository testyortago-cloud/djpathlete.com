import { describe, it, expect } from "vitest"
import { assembleDraft, namespaceKeyframes } from "@/lib/funnels/ai/assemble"
import type { PageDraft } from "@/lib/funnels/ai/types"

function section(id: string, html: string, css = ""): PageDraft["sections"][number] {
  return { id, kind: "generic", title: id, summary: id, html, css }
}

describe("assembleDraft", () => {
  it("wraps each section in a <section> carrying its scope id, in order", () => {
    const out = assembleDraft({
      sections: [section("sec_a", "<h1>One</h1>"), section("sec_b", "<p>Two</p>")],
      pageCss: "",
    })
    expect(out.html).toBe(
      '<section id="djp-sec-sec_a"><h1>One</h1></section>\n' +
        '<section id="djp-sec-sec_b"><p>Two</p></section>',
    )
    expect(out.errors).toEqual([])
  })

  it("scopes each section's CSS under its own id, so one section cannot restyle another", () => {
    const out = assembleDraft({
      sections: [section("sec_a", "", ".title{color:red}"), section("sec_b", "", ".title{color:blue}")],
      pageCss: "",
    })
    expect(out.css).toContain("#djp-sec-sec_a .title")
    expect(out.css).toContain("#djp-sec-sec_b .title")
    // The bare selector must not survive — that is the collision we are preventing.
    expect(out.css).not.toMatch(/(^|\})\s*\.title\s*\{/)
  })

  it("emits page CSS first and unscoped by section", () => {
    const out = assembleDraft({ sections: [], pageCss: ":root{--brand:red}" })
    expect(out.css.trim()).toBe(":root{--brand:red}")
  })

  it("records an error and drops only the offending section's CSS when it will not parse", () => {
    const out = assembleDraft({
      sections: [section("sec_a", "", ".ok{color:red}"), section("sec_b", "", ".bad{color:")],
      pageCss: "",
    })
    expect(out.css).toContain("#djp-sec-sec_a .ok")
    expect(out.css).not.toContain("sec_b")
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0]).toContain("sec_b")
  })

  it("records an error and drops page CSS that will not parse, keeping sections", () => {
    const out = assembleDraft({ sections: [section("sec_a", "", ".ok{color:red}")], pageCss: "@media{" })
    expect(out.css).toContain("#djp-sec-sec_a .ok")
    expect(out.errors).toHaveLength(1)
  })
})

describe("namespaceKeyframes", () => {
  it("renames the animation so two sections defining the same name cannot collide", () => {
    const a = namespaceKeyframes("@keyframes fadeIn{from{opacity:0}}.x{animation:fadeIn 1s}", "sec_a")
    const b = namespaceKeyframes("@keyframes fadeIn{from{opacity:1}}.y{animation:fadeIn 2s}", "sec_b")
    expect(a).toContain("@keyframes sec_a-fadeIn")
    expect(a).toContain("animation:sec_a-fadeIn 1s")
    expect(b).toContain("@keyframes sec_b-fadeIn")
    expect(a).not.toContain("sec_b")
  })

  it("rewrites animation-name and vendor-prefixed at-rules", () => {
    const out = namespaceKeyframes("@-webkit-keyframes spin{}.x{animation-name:spin}", "sec_a")
    expect(out).toContain("@-webkit-keyframes sec_a-spin")
    expect(out).toContain("animation-name:sec_a-spin")
  })

  it("leaves an animation shorthand referencing an undefined name alone", () => {
    const out = namespaceKeyframes(".x{animation:notdefined 1s}", "sec_a")
    expect(out).toContain("animation:notdefined 1s")
  })

  it("returns the input unchanged when the CSS will not parse", () => {
    expect(namespaceKeyframes(".bad{color:", "sec_a")).toBe(".bad{color:")
  })
})

import { compileFunnelStep } from "@/lib/funnels/compile"

describe("assembleDraft composes with the publish compiler", () => {
  it("nests section scope inside the funnel root scope", () => {
    const assembled = assembleDraft({
      sections: [section("sec_a", "<h1>Hi</h1>", ".title{color:red}")],
      pageCss: "",
    })
    const compiled = compileFunnelStep({ html: assembled.html, css: assembled.css })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(compiled.css).toContain("#djp-funnel-root #djp-sec-sec_a .title")
    // The section wrapper's id survives the sanitiser allowlist.
    const root = compiled.nodes[0]
    expect(root).toMatchObject({ t: "el", tag: "section", attrs: { id: "djp-sec-sec_a" } })
  })
})
