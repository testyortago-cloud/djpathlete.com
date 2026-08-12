// lib/funnels/tree/element-def.ts — the load-bearing contract of this feature.
//
// The canvas shows React components. The published page renders FunnelNodes.
// Written as two independent implementations they drift, and the moment they
// drift "what you see is what you get" becomes false in the way nobody notices
// until a customer is looking at the page.
//
// So an element is defined ONCE, and `Render` and `compile` are two halves of
// that one definition. `__tests__/lib/funnels/tree/fidelity.test.tsx` renders
// both halves of every element and asserts identical markup. That test is the
// guarantee; this comment is only the explanation.

import type { ReactElement } from "react"
import type { z } from "zod"
import type { LucideIcon } from "lucide-react"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import type { BoxStyle, ElementKind, TypeStyle } from "./types"

/** How the inspector renders one editable prop. */
export interface FieldSpec {
  name: string
  label: string
  type: "text" | "richtext" | "number" | "checkbox" | "select" | "json" | "url"
  /** `select` only. `id` is the value written into props. */
  options?: { id: string; label: string }[]
}

export interface ElementRenderArgs<P> {
  props: P
  style: BoxStyle
  type?: TypeStyle
}

export interface ElementDef<P = Record<string, unknown>> {
  kind: ElementKind
  label: string
  icon: LucideIcon
  /** What dropping one onto the canvas gives you. Must satisfy `propsSchema`. */
  defaultProps: P
  propsSchema: z.ZodType<P>
  /**
   * The inspector's Content tab. Island elements do NOT declare these by hand —
   * they derive them from ISLAND_TRAITS, which is itself derived from the
   * schemas the compiler validates against, so an island can never offer a
   * setting that publish would reject.
   */
  fields: FieldSpec[]
  /** What the CANVAS shows. */
  Render: (args: ElementRenderArgs<P>) => ReactElement
  /** What gets PUBLISHED. */
  compile: (args: ElementRenderArgs<P>) => FunnelNode
}

/**
 * The registry is heterogeneous by nature — every entry has a different props
 * type — so it is stored at this erased type and narrowed by the caller that
 * knows which kind it is holding.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyElementDef = ElementDef<any>
