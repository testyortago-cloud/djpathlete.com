// lib/funnels/tree/craft-bridge.ts — PageTree <-> Craft.js serialized nodes.
//
// THE BOUNDARY. Craft owns the editing SESSION; PageTree owns the DOCUMENT.
// Everything Craft-shaped stops here, which is what makes the editor library a
// replaceable detail rather than the data format. If Craft is ever swapped out,
// this file is the only thing that changes.
//
// Both directions are pure functions over plain objects, so they are tested
// without a DOM, without React, and without mounting an editor — the parts that
// are hard to test are deliberately not in here.

import { emptyPageTree } from "./schema"
import { isElementKind } from "./kinds"
import { ROW_LAYOUTS, segmentsOf } from "./types"
import type {
  BoxStyle,
  Column,
  ElementNode,
  PageTree,
  Row,
  RowLayout,
  Section,
  TypeStyle,
} from "./types"

export const CRAFT_ROOT = "ROOT"

/**
 * The resolver names the canvas components register under.
 *
 * ROOT MUST BE A RESOLVER COMPONENT, not a bare tag name. Craft's deserializer
 * looks every `resolvedName` up in the resolver and destructures the result; a
 * name it cannot find yields `undefined` and the editor dies on mount with
 * "Cannot destructure property 'type'". `"div"` seemed harmless and was not.
 */
export const CRAFT_ROOT_COMPONENT = "CraftRoot"
export const CRAFT_SECTION = "CraftSection"
export const CRAFT_ROW = "CraftRow"
export const CRAFT_COLUMN = "CraftColumn"
export const CRAFT_ELEMENT = "CraftElement"

export interface CraftNode {
  type: { resolvedName: string }
  isCanvas: boolean
  props: Record<string, unknown>
  displayName: string
  custom: Record<string, unknown>
  parent: string | null
  hidden: boolean
  nodes: string[]
  linkedNodes: Record<string, string>
}

export type CraftNodes = Record<string, CraftNode>

function node(
  resolvedName: string,
  props: Record<string, unknown>,
  parent: string | null,
  children: string[],
  isCanvas: boolean,
): CraftNode {
  return {
    type: { resolvedName },
    isCanvas,
    props,
    displayName: resolvedName,
    custom: {},
    parent,
    hidden: false,
    nodes: children,
    linkedNodes: {},
  }
}

// ---------------------------------------------------------------------------
// PageTree -> Craft
// ---------------------------------------------------------------------------

/**
 * Craft node ids are derived from the document's own ids rather than generated,
 * so loading the same tree twice produces the same node ids. A generated id
 * would make every load look like a change to anything diffing the two.
 */
export function treeToCraft(tree: PageTree): CraftNodes {
  const nodes: CraftNodes = {}
  const sectionIds: string[] = []

  for (const section of tree.sections) {
    const sectionId = `s:${section.id}`
    const rowIds: string[] = []

    for (const row of section.rows) {
      const rowId = `r:${row.id}`
      const columnIds: string[] = []

      for (const column of row.columns) {
        const columnId = `c:${column.id}`
        const elementIds: string[] = []

        for (const element of column.elements) {
          const elementId = `e:${element.id}`
          nodes[elementId] = node(
            CRAFT_ELEMENT,
            {
              elementId: element.id,
              kind: element.kind,
              style: element.style,
              type: element.type,
              elementProps: element.props,
            },
            columnId,
            [],
            false,
          )
          elementIds.push(elementId)
        }

        nodes[columnId] = node(
          CRAFT_COLUMN,
          { columnId: column.id, style: column.style },
          rowId,
          elementIds,
          true,
        )
        columnIds.push(columnId)
      }

      nodes[rowId] = node(
        CRAFT_ROW,
        { rowId: row.id, style: row.style, layout: row.layout },
        sectionId,
        columnIds,
        true,
      )
      rowIds.push(rowId)
    }

    nodes[sectionId] = node(
      CRAFT_SECTION,
      { sectionId: section.id, style: section.style },
      CRAFT_ROOT,
      rowIds,
      true,
    )
    sectionIds.push(sectionId)
  }

  nodes[CRAFT_ROOT] = node(CRAFT_ROOT_COMPONENT, { theme: tree.theme }, null, sectionIds, true)
  return nodes
}

// ---------------------------------------------------------------------------
// Craft -> PageTree
// ---------------------------------------------------------------------------

function asBoxStyle(value: unknown): BoxStyle {
  return value && typeof value === "object" ? (value as BoxStyle) : {}
}

function asTypeStyle(value: unknown): TypeStyle | undefined {
  return value && typeof value === "object" ? (value as TypeStyle) : undefined
}

function asLayout(value: unknown): RowLayout {
  return (ROW_LAYOUTS as readonly string[]).includes(value as string)
    ? (value as RowLayout)
    : "1"
}

/**
 * Walks Craft's node map back into a PageTree.
 *
 * DEFENSIVE BY DESIGN. Craft's state is mutated by drag interactions, and a
 * user can drop things into places this document model has no room for. Rather
 * than throwing — which would lose the whole page on one stray node — anything
 * unrecognised is skipped, and the ROW/COLUMN invariant is repaired by padding
 * or trimming columns to what the layout requires. The schema is still the
 * gate: `savePageTree` re-validates, so a repair that got it wrong is refused
 * rather than persisted.
 */
export function craftToTree(nodes: CraftNodes, theme?: PageTree["theme"]): PageTree {
  const root = nodes[CRAFT_ROOT]
  const base = emptyPageTree()
  if (!root) return base

  const rootTheme = (root.props?.theme ?? theme) as PageTree["theme"] | undefined

  const sections: Section[] = []
  for (const sectionNodeId of root.nodes ?? []) {
    const sectionNode = nodes[sectionNodeId]
    if (!sectionNode || sectionNode.type.resolvedName !== CRAFT_SECTION) continue

    const rows: Row[] = []
    for (const rowNodeId of sectionNode.nodes ?? []) {
      const rowNode = nodes[rowNodeId]
      if (!rowNode || rowNode.type.resolvedName !== CRAFT_ROW) continue

      const layout = asLayout(rowNode.props.layout)
      const wanted = segmentsOf(layout).length

      const columns: Column[] = []
      for (const columnNodeId of rowNode.nodes ?? []) {
        const columnNode = nodes[columnNodeId]
        if (!columnNode || columnNode.type.resolvedName !== CRAFT_COLUMN) continue

        const elements: ElementNode[] = []
        for (const elementNodeId of columnNode.nodes ?? []) {
          const elementNode = nodes[elementNodeId]
          if (!elementNode || elementNode.type.resolvedName !== CRAFT_ELEMENT) continue
          const kind = elementNode.props.kind
          if (!isElementKind(kind)) continue

          elements.push({
            id: String(elementNode.props.elementId ?? elementNodeId.replace(/^e:/, "")),
            kind,
            style: asBoxStyle(elementNode.props.style),
            type: asTypeStyle(elementNode.props.type),
            props: (elementNode.props.elementProps ?? {}) as Record<string, unknown>,
          })
        }

        columns.push({
          id: String(columnNode.props.columnId ?? columnNodeId.replace(/^c:/, "")),
          style: asBoxStyle(columnNode.props.style),
          elements,
        })
      }

      // Repair the one invariant with no correct resolution, rather than
      // emitting a document the schema will refuse. Trimming drops the
      // last-added columns; padding adds empty ones.
      while (columns.length < wanted) {
        columns.push({ id: `c${columns.length + 1}`, style: {}, elements: [] })
      }
      columns.length = wanted

      rows.push({
        id: String(rowNode.props.rowId ?? rowNodeId.replace(/^r:/, "")),
        style: asBoxStyle(rowNode.props.style),
        layout,
        columns,
      })
    }

    sections.push({
      id: String(sectionNode.props.sectionId ?? sectionNodeId.replace(/^s:/, "")),
      style: asBoxStyle(sectionNode.props.style),
      rows,
    })
  }

  return { v: 1, engine: "tree", theme: rootTheme ?? base.theme, sections }
}
