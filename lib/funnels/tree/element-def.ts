// lib/funnels/tree/element-def.ts — the load-bearing contract of this feature.
//
// `compile` IS THE SINGLE SOURCE OF TRUTH for what an element is. The canvas
// does not re-implement it: it renders `compile`'s own output through the real
// published renderer, so for most elements what you see is what you get by
// CONSTRUCTION rather than by a test that compares two hand-written
// approximations of each other.
//
// The design first had `Render` and `compile` as twins kept in step by a
// fidelity test. That was worse: a test comparing two implementations is a test
// that starts passing the day someone edits both consistently-but-wrongly, and
// this repo's dominant defect is tests that cannot fail. Deriving the canvas
// from the compiler deletes the drift instead of watching for it.
//
// ONE EXCEPTION, and it is forced. `EventIsland`, `FaqIsland` and
// `TestimonialsIsland` are async SERVER components that query the database, so
// they cannot render inside a client-side editor at all. Those elements supply
// a `canvasFallback` placeholder, and for them WYSIWYG is explicitly not
// claimed — the `?preview=1` iframe remains the way to see the real thing.
// `__tests__/lib/funnels/tree/fidelity.test.tsx` asserts that the set of
// elements opting out is exactly the islands, so a static element cannot
// quietly acquire a fallback and start drifting.

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
  /** What gets published, and what the canvas renders when there is no fallback. */
  compile: (args: ElementRenderArgs<P>) => FunnelNode
  /**
   * Client-safe stand-in, ONLY for elements whose compiled node cannot render
   * in the browser (islands backed by async server components). Supplying this
   * for a static element reintroduces exactly the drift this contract removes,
   * and the fidelity test refuses it.
   */
  canvasFallback?: (args: ElementRenderArgs<P>) => ReactElement
}

/**
 * The registry is heterogeneous by nature — every entry has a different props
 * type — so it is stored at this erased type and narrowed by the caller that
 * knows which kind it is holding.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyElementDef = ElementDef<any>
