import { describe, it, expect } from "vitest"
import { htmlToNodes, SVG_TAGS, FORBIDDEN_SVG_TAGS } from "@/lib/funnels/compile/sanitize"
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

  it("REPORTS what it removed instead of removing it silently", () => {
    // A generator cannot see the rendered result, so a page that quietly lost
    // its canvas or its form must not look like a clean publish.
    //
    // NOTE: this used to exercise <svg> as the dropped tag; svg is now allowed
    // (see the "inline SVG" suite below), so <canvas> stands in as a tag that
    // is still unconditionally removed.
    const { errors } = htmlToNodes("<div><canvas></canvas><form><input/></form></div>")
    const removed = errors.filter((e) => e.code === "content_removed")
    expect(removed.length).toBeGreaterThanOrEqual(2)
    expect(removed.map((e) => e.message).join(" ")).toContain("<canvas>")
    expect(removed.map((e) => e.message).join(" ")).toContain("<form>")
  })

  it("does not report anything for a clean page", () => {
    const { errors } = htmlToNodes('<section class="hero"><h1>Hi</h1><p>Copy</p></section>')
    expect(errors).toEqual([])
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

describe("inline SVG", () => {
  it("keeps a plain icon with its geometry attributes", () => {
    const { nodes } = htmlToNodes(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M5 13l4 4L19 7"/></svg>',
    )
    expect(tags(nodes)).toEqual(["svg", "path"])
    const svg = findEl(nodes, "svg")
    // Lowercased by attrMap; NodeRenderer maps it back to viewBox for React.
    expect(svg?.attrs.viewbox).toBe("0 0 24 24")
    expect(svg?.attrs["stroke-width"]).toBe("2")
    expect(findEl(nodes, "path")?.attrs.d).toBe("M5 13l4 4L19 7")
  })

  it("keeps circle, rect, line, polyline, polygon, ellipse and g", () => {
    const { nodes } = htmlToNodes(
      "<svg><g><circle cx='1' cy='2' r='3'/><rect x='0' y='0' width='4' height='4'/>" +
        "<line x1='0' y1='0' x2='1' y2='1'/><polyline points='0,0 1,1'/>" +
        "<polygon points='0,0 1,1 2,0'/><ellipse cx='1' cy='1' rx='2' ry='3'/></g></svg>",
    )
    expect(tags(nodes)).toEqual([
      "svg", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse",
    ])
  })

  it.each(FORBIDDEN_SVG_TAGS)("drops <%s> inside an svg", (tag) => {
    const { nodes } = htmlToNodes(`<svg><${tag}></${tag}><path d="M0 0"/></svg>`)
    expect(tags(nodes)).not.toContain(tag)
    expect(tags(nodes)).toContain("path")
  })

  it("strips an href from an svg child so <use> cannot be smuggled back in", () => {
    const { nodes } = htmlToNodes('<svg><path d="M0 0" href="https://evil.example/x"/></svg>')
    expect(findEl(nodes, "path")?.attrs.href).toBeUndefined()
  })

  it("strips event handlers from svg elements", () => {
    const { nodes } = htmlToNodes('<svg onload="alert(1)"><path d="M0 0" onclick="alert(2)"/></svg>')
    expect(findEl(nodes, "svg")?.attrs.onload).toBeUndefined()
    expect(findEl(nodes, "path")?.attrs.onclick).toBeUndefined()
  })

  it("runs an svg style attribute through safeStyle", () => {
    const { nodes } = htmlToNodes('<svg style="color:red;background:url(javascript:alert(1))"></svg>')
    const style = findEl(nodes, "svg")?.attrs.style ?? ""
    expect(style).toContain("color:red")
    expect(style).not.toContain("javascript:")
  })

  it("INVARIANT: no forbidden svg tag is in the allowlist", () => {
    for (const tag of FORBIDDEN_SVG_TAGS) {
      expect(SVG_TAGS.has(tag)).toBe(false)
    }
  })

  it("warns rather than silently deleting a forbidden svg child", () => {
    const { nodes, errors } = htmlToNodes('<svg><foreignObject><b>hi</b></foreignObject></svg>')
    expect(tags(nodes)).toEqual(["svg"])
    expect(errors.map((e) => e.code)).toContain("content_removed")
    expect(errors[0].message).toContain("foreignobject")
  })

  it("does not drop an ordinary <a> outside an svg", () => {
    const { nodes } = htmlToNodes('<a href="/contact">Contact</a>')
    expect(tags(nodes)).toEqual(["a"])
  })
})

describe("details / summary", () => {
  it("keeps a no-JS accordion including the open attribute", () => {
    const { nodes } = htmlToNodes("<details open><summary>Q</summary><p>A</p></details>")
    expect(tags(nodes)).toEqual(["details", "summary", "p"])
    expect(findEl(nodes, "details")?.attrs.open).toBe("")
  })
})
