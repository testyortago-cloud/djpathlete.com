"use client"

// A client-safe renderer for the FunnelNode trees the element compilers emit.
//
// WHY THIS IS NOT `components/funnels/NodeRenderer.tsx`. That one is the real
// published renderer and it imports `renderIsland`, which imports EventIsland /
// FaqIsland / TestimonialsIsland — async SERVER components that import
// `lib/db/*` and the service-role Supabase client. Importing it from a "use
// client" module would drag all of that into the browser bundle and break the
// build. There is no flag that makes that safe.
//
// So the canvas renders the same INPUT (the node tree `compile` produced) with
// a smaller renderer that handles `text` and `el` and refuses `island` — which
// is exactly the split the ElementDef contract already draws, because islands
// supply a `canvasFallback` and never reach here.
//
// The duplication is real and bounded: it is the attribute mapping, and
// `__tests__/components/admin/builder/canvas-nodes.test.tsx` pins it against
// the same expectations the published renderer meets.

import { createElement, Fragment, type CSSProperties, type ReactNode } from "react"
import type { FunnelNode } from "@/lib/funnels/compile/types"

const VOID_TAGS = new Set(["br", "hr", "img", "source"])

const PROP_NAME_MAP: Record<string, string> = {
  class: "className",
  srcset: "srcSet",
  playsinline: "playsInline",
  autoplay: "autoPlay",
  crossorigin: "crossOrigin",
}

const BOOLEAN_PROPS = new Set(["controls", "muted", "loop", "autoPlay", "playsInline"])

function toCamel(property: string): string {
  return property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function styleStringToObject(style: string): CSSProperties {
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
      props[propName] = value === "" || value === "true" || value === propName
      continue
    }
    props[propName] = value
  }
  return props
}

function renderNode(node: FunnelNode, index: number): ReactNode {
  if (node.t === "text") return node.v
  if (node.t === "island") {
    // Unreachable by contract: islands supply a canvasFallback and never get
    // here. Rendering nothing rather than throwing, because a canvas that
    // crashes is worse than a canvas with a gap.
    return null
  }

  const props = toReactProps(node.attrs)
  if (VOID_TAGS.has(node.tag)) return createElement(node.tag, { key: index, ...props })

  return createElement(
    node.tag,
    { key: index, ...props },
    node.children.map((child, childIndex) => renderNode(child, childIndex)),
  )
}

export function CanvasNodes({ nodes }: { nodes: FunnelNode[] }) {
  return <>{nodes.map((node, index) => renderNode(node, index))}</>
}
