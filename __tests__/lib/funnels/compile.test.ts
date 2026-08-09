import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { compileFunnelStep } from "@/lib/funnels/compile"
import { ALLOWED_IFRAME_HOSTS } from "@/lib/funnels/compile/sanitize"

const VALID_UUID = "11111111-1111-4111-8111-111111111111"

describe("compileFunnelStep", () => {
  it("compiles a page with an island and a stylesheet", () => {
    const props = { formKey: "optin", fields: [{ name: "email", label: "Email", type: "email" }] }
    const result = compileFunnelStep({
      html: `<section class="hero"><h1>Get faster</h1><div data-djp-island="form" data-djp-props='${JSON.stringify(props)}'></div></section>`,
      css: ".hero { padding: 40px }",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.css).toContain("#djp-funnel-root .hero")
    expect(result.warnings).toEqual([])
    expect(JSON.stringify(result.nodes)).toContain('"island"')
  })

  it("refuses to publish when an island is misconfigured", () => {
    const result = compileFunnelStep({
      html: `<div data-djp-island="checkout" data-djp-props='{"productKind":"program"}'></div>`,
      css: "",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0].code).toBe("island_props_invalid")
    // The message must name the field, or the owner cannot act on it.
    expect(result.errors[0].message).toContain("productId")
  })

  it("refuses to publish when the stylesheet cannot be parsed", () => {
    const result = compileFunnelStep({ html: "<p>hi</p>", css: ".a { color: red " })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.code === "css_parse_failed")).toBe(true)
  })

  it("publishes with a warning when an off-host embed is removed", () => {
    const result = compileFunnelStep({
      html: '<div><iframe src="https://evil.example/x"></iframe><p>copy</p></div>',
      css: "",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.code === "iframe_host_not_allowed")).toBe(true)
    expect(JSON.stringify(result.nodes)).toContain("copy")
  })

  it("accepts a valid checkout island", () => {
    const props = { productKind: "program", productId: VALID_UUID }
    const result = compileFunnelStep({
      html: `<div data-djp-island="checkout" data-djp-props='${JSON.stringify(props)}'></div>`,
      css: "",
    })
    expect(result.ok).toBe(true)
  })
})

describe("CSP frame-src covers every allowlisted embed host", () => {
  // jsdom does not enforce CSP, so no component test can catch a missing host —
  // the embed would simply be blank in production. Only this assertion does.
  it("lists each allowed iframe host in next.config.mjs", () => {
    const config = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8")
    const frameSrc = config.match(/"frame-src[^"]*"/)?.[0]
    expect(frameSrc, "frame-src directive not found in next.config.mjs").toBeDefined()

    for (const host of ALLOWED_IFRAME_HOSTS) {
      expect(frameSrc, `frame-src is missing https://${host}`).toContain(`https://${host}`)
    }
  })
})
