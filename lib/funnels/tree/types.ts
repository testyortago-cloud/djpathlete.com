// lib/funnels/tree/types.ts — the draft document a visual page is edited as.
//
// SectionDoc is a FLAT array of ten fixed section kinds. That is the right
// shape for a builder that writes whole sections at a time, and the wrong shape
// for one whose entire point is that the owner drags a button into the left
// half of a row. Hence a tree.
//
// The PUBLISHED format is unchanged: this compiles to FunnelNode, which
// components/funnels/NodeRenderer.tsx already renders.

export const ROW_LAYOUTS = ["1", "1-1", "1-1-1", "1-1-1-1", "1-2", "2-1"] as const
export type RowLayout = (typeof ROW_LAYOUTS)[number]

/**
 * The flex ratios a layout expands to.
 *
 * THE COLUMN COUNT IS DERIVED FROM HERE AND IS NEVER STORED BESIDE IT. A
 * `columns.length` that disagreed with `layout` would be a document that
 * renders differently from how it validates, and there is no correct way to
 * resolve that disagreement — you would be guessing whether the owner meant to
 * add a column or change the layout, and either guess loses content.
 */
export function segmentsOf(layout: RowLayout): number[] {
  return layout.split("-").map((segment) => Number(segment))
}

export interface Sides {
  top?: string
  right?: string
  bottom?: string
  left?: string
}

/** One style shape at every level of the tree — section, row, column, element. */
export interface BoxStyle {
  padding?: Sides
  margin?: Sides
  background?: { color?: string; image?: string }
  border?: { width?: string; style?: "solid" | "dashed" | "dotted"; color?: string }
  radius?: string
  align?: "left" | "center" | "right"
  maxWidth?: string
}

/** Additional style for text-bearing elements. */
export interface TypeStyle {
  fontSize?: string
  fontWeight?: string
  lineHeight?: string
  color?: string
  letterSpacing?: string
}

export const ELEMENT_KINDS = [
  "heading",
  "text",
  "image",
  "button",
  "divider",
  "spacer",
  "island",
] as const
export type ElementKind = (typeof ELEMENT_KINDS)[number]

export interface PageTheme {
  tone: "light" | "dark"
  accent: "accent" | "primary"
  radius: "sharp" | "soft" | "round"
}

export interface ElementNode {
  id: string
  kind: ElementKind
  style: BoxStyle
  type?: TypeStyle
  /** Validated by the element registry, which owns the per-kind schemas. */
  props: Record<string, unknown>
}

export interface Column {
  id: string
  style: BoxStyle
  elements: ElementNode[]
}

export interface Row {
  id: string
  style: BoxStyle
  layout: RowLayout
  columns: Column[]
}

export interface Section {
  id: string
  style: BoxStyle
  rows: Row[]
}

export interface PageTree {
  v: 1
  engine: "tree"
  theme: PageTheme
  sections: Section[]
}
