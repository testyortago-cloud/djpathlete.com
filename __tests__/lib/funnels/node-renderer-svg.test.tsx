import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { NodeRenderer } from "@/components/funnels/NodeRenderer"
import type { FunnelNode } from "@/lib/funnels/compile/types"

const ctx = {
  funnelId: "f", funnelSlug: "f", stepId: "s", stepSlug: "s", isPreview: false,
}

describe("NodeRenderer SVG attribute casing", () => {
  it("renders viewBox with the casing React requires", () => {
    // The compiler lowercases every attribute name, so the tree carries
    // `viewbox`. React only honours `viewBox`; without the mapping the icon
    // renders at the wrong size with a DOM warning and nothing fails loudly.
    const nodes: FunnelNode[] = [
      { t: "el", tag: "svg", attrs: { viewbox: "0 0 24 24" }, children: [
        { t: "el", tag: "path", attrs: { d: "M5 13l4 4L19 7", "stroke-width": "2" }, children: [] },
      ] },
    ]
    const { container } = render(<NodeRenderer nodes={nodes} context={ctx} />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24")
    expect(container.querySelector("path")?.getAttribute("stroke-width")).toBe("2")
  })
})
