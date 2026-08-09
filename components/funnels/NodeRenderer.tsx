// components/funnels/NodeRenderer.tsx — FunnelNode tree -> React elements.
//
// Server component. Because the tree was allowlisted at publish time, every
// element here is constructed with createElement rather than injected as
// markup: there is no dangerouslySetInnerHTML in a funnel page body, so there
// is no render-time XSS surface to police.

import { createElement, Fragment, type CSSProperties, type ReactNode } from "react"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import { renderIsland, type FunnelRenderContext } from "./islands"

/** Tags that must never be given children. */
const VOID_TAGS = new Set(["br", "hr", "img", "source"])

/** HTML attribute -> React prop, where they differ. */
const PROP_NAME_MAP: Record<string, string> = {
  class: "className",
  srcset: "srcSet",
  playsinline: "playsInline",
  autoplay: "autoPlay",
  crossorigin: "crossOrigin",
  // The compiler lowercases attribute names, but React special-cases these two
  // SVG attributes and silently ignores the lowercase spelling — the icon then
  // renders at the wrong size with only a console warning.
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
}

/** Attributes React expects as booleans, not strings. */
const BOOLEAN_PROPS = new Set(["controls", "muted", "loop", "autoPlay", "playsInline"])

function toCamel(property: string): string {
  return property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** Inline style string -> React style object. Custom properties pass through. */
export function styleStringToObject(style: string): CSSProperties {
  const out: Record<string, string> = {}
  for (const declaration of style.split(";")) {
    const index = declaration.indexOf(":")
    if (index === -1) continue
    const property = declaration.slice(0, index).trim()
    const value = declaration.slice(index + 1).trim()
    if (property.length === 0 || value.length === 0) continue
    out[property.startsWith("--") ? property : toCamel(property)] = value
  }
  return out as CSSProperties
}

function toReactProps(attrs: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(attrs)) {
    const propName = PROP_NAME_MAP[name] ?? name
    if (propName === "style") {
      props.style = styleStringToObject(value)
      continue
    }
    if (BOOLEAN_PROPS.has(propName)) {
      // HTML boolean attributes arrive as "" or "true"; React needs a boolean,
      // and "" would otherwise read as falsy and drop the attribute entirely.
      props[propName] = value === "" || value === "true" || value === propName
      continue
    }
    props[propName] = value
  }
  return props
}

interface NodeRendererProps {
  nodes: FunnelNode[]
  context: FunnelRenderContext
}

export function NodeRenderer({ nodes, context }: NodeRendererProps) {
  return <>{nodes.map((node, index) => renderNode(node, index, context))}</>
}

function renderNode(node: FunnelNode, index: number, context: FunnelRenderContext): ReactNode {
  if (node.t === "text") return node.v
  if (node.t === "island") {
    return <Fragment key={index}>{renderIsland(node.name, node.props, context)}</Fragment>
  }

  const props = toReactProps(node.attrs)
  props.key = index

  if (VOID_TAGS.has(node.tag)) return createElement(node.tag, props)

  return createElement(
    node.tag,
    props,
    node.children.map((child, childIndex) => renderNode(child, childIndex, context)),
  )
}
