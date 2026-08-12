// lib/funnels/tree/compile.ts — PageTree -> the published node format.
//
// This deliberately does NOT route through `compileFunnelStep`. That function's
// job is parsing an untrusted HTML STRING into a sanitised tree, and a typed
// PageTree has no HTML to parse — every tag it emits is chosen here, not by a
// document someone pasted. The two untrusted inputs that do exist (rich text,
// URLs) are sanitised inside the element compilers by the same primitives
// `compileFunnelStep` uses.
//
// NEVER THROWS. A page with one broken element must still publish the other
// twenty and name the broken one: "publish failed" with no element name is
// unactionable, and this is the last place that knows which element it was.

import { ELEMENT_REGISTRY } from "./elements"
import { styleToCss, styleAttrs } from "./style"
import { segmentsOf, type Column, type ElementNode, type PageTree, type Row, type Section } from "./types"
import { isElementKind } from "./kinds"
import type { FunnelNode } from "@/lib/funnels/compile/types"

export interface CompiledTree {
  nodes: FunnelNode[]
  /** Human-readable, element-identifying. Surfaced before publish, never thrown. */
  problems: string[]
}

function el(tag: string, css: string, children: FunnelNode[]): FunnelNode {
  return { t: "el", tag, attrs: styleAttrs(css), children }
}

function compileElement(node: ElementNode, problems: string[]): FunnelNode | null {
  if (!isElementKind(node.kind)) {
    problems.push(`Unknown element "${node.kind}" (${node.id}) — it was skipped.`)
    return null
  }

  const def = ELEMENT_REGISTRY[node.kind]
  // Stored props are validated, not trusted: a tree can be written by an older
  // or newer client than the one compiling it.
  const parsed = def.propsSchema.safeParse(node.props)
  if (!parsed.success) {
    problems.push(
      `The ${def.label.toLowerCase()} "${node.id}" has settings this version cannot read — it was skipped.`,
    )
    return null
  }

  try {
    return def.compile({ props: parsed.data, style: node.style, type: node.type })
  } catch (error) {
    problems.push(`The ${def.label.toLowerCase()} "${node.id}" could not be built: ${(error as Error).message}`)
    return null
  }
}

function compileColumn(column: Column, flex: number, problems: string[]): FunnelNode {
  const children = column.elements
    .map((element) => compileElement(element, problems))
    .filter((node): node is FunnelNode => node !== null)

  // The flex ratio comes from the ROW's layout, never from a stored per-column
  // width — one source of truth for how wide a column is.
  const own = `flex:${flex}`
  const box = styleToCss(column.style)
  return el("div", box ? `${box};${own}` : own, children)
}

function compileRow(row: Row, problems: string[]): FunnelNode {
  const ratios = segmentsOf(row.layout)
  const columns = row.columns.map((column, index) =>
    compileColumn(column, ratios[index] ?? 1, problems),
  )
  const box = styleToCss(row.style)
  return el("div", box ? `${box};display:flex;gap:16px` : "display:flex;gap:16px", columns)
}

function compileSection(section: Section, problems: string[]): FunnelNode {
  const rows = section.rows.map((row) => compileRow(row, problems))
  return el("section", styleToCss(section.style), rows)
}

export function compilePageTree(tree: PageTree): CompiledTree {
  const problems: string[] = []
  const nodes = tree.sections.map((section) => compileSection(section, problems))
  return { nodes, problems }
}
