// lib/funnels/tree/schema.ts — what a legal PageTree is.
//
// Craft.js owns the editing SESSION; this owns the DOCUMENT. When the editor
// saves, its serialized state is converted to a PageTree and validated here —
// so the schema, not the editor library, decides what can be persisted and
// published. That boundary is what keeps a swap of editor engine from being a
// change to the data.

import { z } from "zod"
import { ROW_LAYOUTS, ELEMENT_KINDS, segmentsOf, type PageTree, type RowLayout } from "./types"

const cssLength = z.string().max(40)
const cssColor = z.string().max(60)

// `.strict()` everywhere on purpose: silently dropping a key the editor wrote
// is how a save appears to succeed and quietly loses the owner's work.
const sidesSchema = z
  .object({
    top: cssLength.optional(),
    right: cssLength.optional(),
    bottom: cssLength.optional(),
    left: cssLength.optional(),
  })
  .strict()

export const boxStyleSchema = z
  .object({
    padding: sidesSchema.optional(),
    margin: sidesSchema.optional(),
    background: z
      .object({ color: cssColor.optional(), image: z.string().max(600).optional() })
      .strict()
      .optional(),
    border: z
      .object({
        width: cssLength.optional(),
        style: z.enum(["solid", "dashed", "dotted"]).optional(),
        color: cssColor.optional(),
      })
      .strict()
      .optional(),
    radius: cssLength.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    maxWidth: cssLength.optional(),
  })
  .strict()

export const typeStyleSchema = z
  .object({
    fontSize: cssLength.optional(),
    fontWeight: z.string().max(20).optional(),
    lineHeight: z.string().max(20).optional(),
    color: cssColor.optional(),
    letterSpacing: cssLength.optional(),
  })
  .strict()

const idSchema = z.string().min(1).max(24)

export const elementSchema = z
  .object({
    id: idSchema,
    kind: z.enum(ELEMENT_KINDS),
    style: boxStyleSchema,
    type: typeStyleSchema.optional(),
    /**
     * Per-kind props are validated by the element registry, which owns the
     * schemas. Restating them here would create a second definition of what a
     * heading is, and this repo has shipped three bugs from restating a
     * validation rule instead of calling the one that decides.
     */
    props: z.record(z.string(), z.unknown()),
  })
  .strict()

export const columnSchema = z
  .object({ id: idSchema, style: boxStyleSchema, elements: z.array(elementSchema).max(50) })
  .strict()

export const rowSchema = z
  .object({
    id: idSchema,
    style: boxStyleSchema,
    layout: z.enum(ROW_LAYOUTS),
    columns: z.array(columnSchema).min(1).max(4),
  })
  .strict()
  .refine((row) => row.columns.length === segmentsOf(row.layout as RowLayout).length, {
    message: "A row's column count must match its layout",
    path: ["columns"],
  })

export const sectionSchema = z
  .object({ id: idSchema, style: boxStyleSchema, rows: z.array(rowSchema).max(30) })
  .strict()

export const pageThemeSchema = z
  .object({
    tone: z.enum(["light", "dark"]),
    accent: z.enum(["accent", "primary"]),
    radius: z.enum(["sharp", "soft", "round"]),
  })
  .strict()

export const pageTreeSchema = z
  .object({
    v: z.literal(1),
    engine: z.literal("tree"),
    theme: pageThemeSchema,
    sections: z.array(sectionSchema).max(30),
  })
  .strict()

/** The document a brand-new visual page opens with. Must satisfy the schema. */
export function emptyPageTree(): PageTree {
  return {
    v: 1,
    engine: "tree",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [],
  }
}
