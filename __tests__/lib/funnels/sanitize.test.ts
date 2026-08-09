import { describe, it, expect } from "vitest"
import { htmlToNodes } from "@/lib/funnels/compile/sanitize"
import type { FunnelNode } from "@/lib/funnels/compile/types"

/** Depth-first walk, so nesting assertions don't depend on tree shape. */
function walk(nodes: FunnelNode[], visit: (n: FunnelNode) => void): void {
  for (const n of nodes) {
    visit(n)
    if (n.t === "el") walk(n.children, visit)
  }
}

function tags(nodes: FunnelNode[]): string[] {
  const out: string[] = []
  walk(nodes, (n) => {
    if (n.t === "el") out.push(n.tag)
  })
  return out
}

function islands(nodes: FunnelNode[]): Extract<FunnelNode, { t: "island" }>[] {
  const out: Extract<FunnelNode, { t: "island" }>[] = []
  walk(nodes, (n) => {
    if (n.t === "island") out.push(n)
  })
  return out
}

function text(nodes: FunnelNode[]): string {
  let out = ""
  walk(nodes, (n) => {
    if (n.t === "text") out += n.v
  })
  return out
}

function findEl(nodes: FunnelNode[], tag: string): Extract<FunnelNode, { t: "el" }> | undefined {
  let found: Extract<FunnelNode, { t: "el" }> | undefined
  walk(nodes, (n) => {
    if (!found && n.t === "el" && n.tag === tag) found = n
  })
  return found
}

describe("htmlToNodes — structure", () => {
  it("preserves allowlisted elements, their text and their classes", () => {
    const { nodes } = htmlToNodes('<section class="hero"><h1>Get faster</h1><p>Now</p></section>')
    expect(tags(nodes)).toEqual(["section", "h1", "p"])
    expect(text(nodes)).toBe("Get fasterNow")
    expect(findEl(nodes, "section")?.attrs.class).toBe("hero")
  })

  it("unwraps an unknown tag but keeps its children", () => {
    const { nodes } = htmlToNodes("<marquee><p>kept</p></marquee>")
    expect(tags(nodes)).toEqual(["p"])
    expect(text(nodes)).toBe("kept")
  })
})

describe("htmlToNodes — rejection rules", () => {
  it("drops a script element and its contents", () => {
    const { nodes } = htmlToNodes('<div><script>alert("xss")</script><p>safe</p></div>')
    expect(tags(nodes)).not.toContain("script")
    expect(text(nodes)).toBe("safe")
    expect(text(nodes)).not.toContain("alert")
  })

  it("drops native form controls, which would shadow the form island", () => {
    const { nodes } = htmlToNodes("<div><form><input name='x'><button>go</button></form></div>")
    expect(tags(nodes)).not.toContain("form")
    expect(tags(nodes)).not.toContain("input")
  })

  it("drops on* event handler attributes", () => {
    const { nodes } = htmlToNodes('<div onclick="steal()" onmouseover="x()" class="k">hi</div>')
    const div = findEl(nodes, "div")
    expect(div?.attrs.onclick).toBeUndefined()
    expect(div?.attrs.onmouseover).toBeUndefined()
    expect(div?.attrs.class).toBe("k")
  })

  it("drops a javascript: href but keeps the element", () => {
    const { nodes } = htmlToNodes('<a href="javascript:alert(1)">click</a>')
    const a = findEl(nodes, "a")
    expect(a).toBeDefined()
    expect(a?.attrs.href).toBeUndefined()
  })

  it("keeps https, mailto, tel and root-relative hrefs", () => {
    const { nodes } = htmlToNodes(
      '<div><a href="https://x.example/a">a</a><a href="mailto:c@x.example">b</a>' +
        '<a href="tel:+15551234">c</a><a href="/go/camp">d</a></div>',
    )
    const hrefs: string[] = []
    walk(nodes, (n) => {
      if (n.t === "el" && n.tag === "a" && n.attrs.href) hrefs.push(n.attrs.href)
    })
    expect(hrefs).toEqual([
      "https://x.example/a",
      "mailto:c@x.example",
      "tel:+15551234",
      "/go/camp",
    ])
  })

  it("strips expression() and javascript: out of inline styles", () => {
    const { nodes } = htmlToNodes(
      '<div style="color:red;background:url(javascript:alert(1));width:expression(alert(1))">x</div>',
    )
    const style = findEl(nodes, "div")?.attrs.style ?? ""
    expect(style).toContain("color:red")
    expect(style).not.toContain("javascript:")
    expect(style).not.toContain("expression(")
  })

  it("keeps a data:image src but drops a data:text/html src", () => {
    const ok = htmlToNodes('<img src="data:image/png;base64,iVBORw0KGgo=" alt="a">')
    expect(findEl(ok.nodes, "img")?.attrs.src).toContain("data:image/png")

    const bad = htmlToNodes('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="a">')
    expect(findEl(bad.nodes, "img")?.attrs.src).toBeUndefined()
  })
})

describe("htmlToNodes — iframe host allowlist", () => {
  it("keeps a YouTube embed", () => {
    const { nodes } = htmlToNodes('<iframe src="https://www.youtube.com/embed/abc123"></iframe>')
    expect(findEl(nodes, "iframe")?.attrs.src).toBe("https://www.youtube.com/embed/abc123")
  })

  it("keeps a Vimeo embed", () => {
    const { nodes } = htmlToNodes('<iframe src="https://player.vimeo.com/video/12345"></iframe>')
    expect(findEl(nodes, "iframe")).toBeDefined()
  })

  it("drops an iframe pointing at a non-allowlisted host", () => {
    const { nodes, errors } = htmlToNodes('<iframe src="https://evil.example/pwn"></iframe>')
    expect(findEl(nodes, "iframe")).toBeUndefined()
    expect(errors.some((e) => e.code === "iframe_host_not_allowed")).toBe(true)
  })

  it("drops an iframe with no src at all", () => {
    const { nodes } = htmlToNodes("<iframe></iframe>")
    expect(findEl(nodes, "iframe")).toBeUndefined()
  })
})

describe("htmlToNodes — islands", () => {
  it("extracts an island and applies schema defaults", () => {
    const props = {
      formKey: "optin",
      fields: [{ name: "email", label: "Email", type: "email", required: true }],
    }
    const { nodes, errors } = htmlToNodes(
      `<div data-djp-island="form" data-djp-props='${JSON.stringify(props)}'></div>`,
    )
    expect(errors).toEqual([])
    const found = islands(nodes)
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe("form")
    // submitLabel is not supplied above — the schema default must be applied.
    expect(found[0].props.submitLabel).toBe("Submit")
  })

  it("extracts an island nested several levels deep inside styled containers", () => {
    const props = { productKind: "program", productId: "11111111-1111-4111-8111-111111111111" }
    const { nodes } = htmlToNodes(
      `<section class="a"><div class="b"><div class="c">` +
        `<div data-djp-island="checkout" data-djp-props='${JSON.stringify(props)}'></div>` +
        `</div></div></section>`,
    )
    const found = islands(nodes)
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe("checkout")
    // and the wrapping structure survives, so the owner's layout is intact
    expect(tags(nodes)).toEqual(["section", "div", "div"])
  })

  it("reports an error and drops the island when its props are invalid", () => {
    const { nodes, errors } = htmlToNodes(
      `<div data-djp-island="form" data-djp-props='{"formKey":"optin","fields":[]}'></div>`,
    )
    expect(islands(nodes)).toHaveLength(0)
    expect(errors.some((e) => e.code === "island_props_invalid")).toBe(true)
  })

  it("reports an error for an unknown island name", () => {
    const { nodes, errors } = htmlToNodes(`<div data-djp-island="wat" data-djp-props='{}'></div>`)
    expect(islands(nodes)).toHaveLength(0)
    expect(errors.some((e) => e.code === "island_unknown")).toBe(true)
  })

  it("reports an error when the props attribute is not valid JSON", () => {
    const { nodes, errors } = htmlToNodes(
      `<div data-djp-island="faq" data-djp-props='{not json}'></div>`,
    )
    expect(islands(nodes)).toHaveLength(0)
    expect(errors.some((e) => e.code === "island_props_unparseable")).toBe(true)
  })

  it("does not leak the reserved data-djp-* attributes onto ordinary elements", () => {
    const { nodes } = htmlToNodes('<div data-djp-props=\'{"a":1}\' data-track="ok">x</div>')
    const div = findEl(nodes, "div")
    expect(div?.attrs["data-djp-props"]).toBeUndefined()
    expect(div?.attrs["data-track"]).toBe("ok")
  })
})
