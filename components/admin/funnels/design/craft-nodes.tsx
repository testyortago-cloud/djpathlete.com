"use client"

// The four canvas components Craft resolves against. Each one is a thin wrapper
// that connects a DOM node to Craft and renders the document data it was handed
// through `craft-bridge` — they hold no document state of their own, because
// PageTree is the document and Craft is only the editing session.

import { useEditor, useNode, type UserComponent } from "@craftjs/core"
import type { ReactNode } from "react"
import { ELEMENT_REGISTRY } from "@/lib/funnels/tree/elements"
import { richtextField } from "@/lib/funnels/tree/capability"
import { InlineText } from "./InlineText"
import { styleToCss } from "@/lib/funnels/tree/style"
import { segmentsOf } from "@/lib/funnels/tree/types"
import type { BoxStyle, ElementKind, RowLayout, TypeStyle } from "@/lib/funnels/tree/types"
import { CanvasNodes } from "./CanvasNodes"

/** Inline style string -> React style object, for the container wrappers. */
function styleObject(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const declaration of css.split(";")) {
    const index = declaration.indexOf(":")
    if (index === -1) continue
    const property = declaration.slice(0, index).trim()
    const value = declaration.slice(index + 1).trim()
    if (!property || !value) continue
    out[property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  return out
}

/** The dashed outline that makes an empty container findable. */
const EMPTY_HINT = "min-h-[48px] outline outline-1 outline-dashed outline-border/60"

/**
 * The page itself. It exists as a resolver component because Craft looks every
 * `resolvedName` up in the resolver and destructures the result — a bare tag
 * name like "div" is not found, and the editor dies on mount.
 */
export const CraftRoot: UserComponent<{ children?: ReactNode }> = ({ children }) => {
  const {
    connectors: { connect },
  } = useNode()

  return (
    <div
      ref={(ref) => {
        if (ref) connect(ref)
      }}
      className="min-h-[240px]"
      data-craft="root"
    >
      {children}
    </div>
  )
}
CraftRoot.craft = { displayName: "CraftRoot" }

export const CraftSection: UserComponent<{ sectionId: string; style: BoxStyle; children?: ReactNode }> = ({
  style,
  children,
}) => {
  const {
    connectors: { connect, drag },
    hasChildren,
  } = useNode((node) => ({ hasChildren: node.data.nodes.length > 0 }))

  return (
    <section
      ref={(ref) => {
        if (ref) connect(drag(ref))
      }}
      style={styleObject(styleToCss(style))}
      className={hasChildren ? "relative" : `relative ${EMPTY_HINT}`}
      data-craft="section"
    >
      {children}
    </section>
  )
}
CraftSection.craft = { displayName: "CraftSection" }

export const CraftRow: UserComponent<{
  rowId: string
  style: BoxStyle
  layout: RowLayout
  children?: ReactNode
}> = ({ style, children }) => {
  const {
    connectors: { connect, drag },
  } = useNode()

  return (
    <div
      ref={(ref) => {
        if (ref) connect(drag(ref))
      }}
      style={{ ...styleObject(styleToCss(style)), display: "flex", gap: 16 }}
      data-craft="row"
    >
      {children}
    </div>
  )
}
CraftRow.craft = { displayName: "CraftRow" }

export const CraftColumn: UserComponent<{
  columnId: string
  style: BoxStyle
  children?: ReactNode
}> = ({ style, children }) => {
  const {
    connectors: { connect, drag },
    id,
    parentId,
    hasChildren,
  } = useNode((node) => ({
    id: node.id,
    parentId: node.data.parent,
    hasChildren: node.data.nodes.length > 0,
  }))

  // THE FLEX RATIO BELONGS TO THE ROW'S LAYOUT, not to the column. Storing a
  // width per column would be a second source of truth for how wide a column
  // is, and the two would disagree the first time the layout changed. So it is
  // read from the parent row and this column's position within it.
  const { flex } = useEditor((state) => {
    const parent = parentId ? state.nodes[parentId] : undefined
    if (!parent) return { flex: 1 }
    const ratios = segmentsOf((parent.data.props.layout as RowLayout) ?? "1")
    const index = parent.data.nodes.indexOf(id)
    return { flex: ratios[index] ?? 1 }
  })

  return (
    <div
      ref={(ref) => {
        if (ref) connect(drag(ref))
      }}
      style={{ ...styleObject(styleToCss(style)), flex }}
      className={hasChildren ? undefined : EMPTY_HINT}
      data-craft="column"
    >
      {children}
    </div>
  )
}
CraftColumn.craft = { displayName: "CraftColumn" }

export const CraftElement: UserComponent<{
  elementId: string
  kind: ElementKind
  style: BoxStyle
  type?: TypeStyle
  elementProps: Record<string, unknown>
  /**
   * Editing SESSION state, never document state. `craftToTree` reads five named
   * props and this is not one of them, so it cannot reach a saved page.
   */
  editing?: boolean
}> = ({ kind, style, type, elementProps, editing }) => {
  const {
    connectors: { connect, drag },
    selected,
    actions: { setProp },
  } = useNode((node) => ({ selected: node.events.selected }))

  const def = ELEMENT_REGISTRY[kind]
  const parsed = def?.propsSchema.safeParse(elementProps)
  // An element is inline-editable exactly when it declares a richtext field.
  // Nothing is declared twice to say so — see `capability.ts`.
  const inline = def ? richtextField(def) : null
  const isEditing = Boolean(editing) && inline !== null

  let body: ReactNode
  if (!def) {
    body = <span className="text-xs text-[var(--error)]">Unknown element: {kind}</span>
  } else if (!parsed?.success) {
    // The inspector can still repair it, so this must not be a crash.
    body = <span className="text-xs text-[var(--error)]">This {def.label.toLowerCase()} has settings we cannot read.</span>
  } else if (isEditing && inline) {
    body = (
      <InlineText
        html={String(elementProps[inline.name] ?? "")}
        onCommit={(html) => {
          setProp((props: Record<string, unknown>) => {
            const next = { ...((props.elementProps ?? {}) as Record<string, unknown>) }
            next[inline.name] = html
            props.elementProps = next
            props.editing = false
          })
        }}
      />
    )
  } else if (def.canvasFallback) {
    body = def.canvasFallback({ props: parsed.data, style, type })
  } else {
    // The canvas renders the compiler's OWN output, so what is on screen is
    // what will be published — not a second hand-written approximation of it.
    body = <CanvasNodes nodes={[def.compile({ props: parsed.data, style, type })]} />
  }

  return (
    <div
      // Remount when entering or leaving edit. Craft's `drag()` connector sets
      // draggable="true" on the node imperatively and does not take it back
      // when it stops being applied, so reusing the node would leave a block
      // that is still draggable while its own text is being selected. A fresh
      // node carries no stale attribute and no stale handler registration.
      key={isEditing ? "editing" : "idle"}
      ref={(ref) => {
        if (!ref) return
        // While the caret is in this block the drag connector must be OFF:
        // Craft drags on mousedown, so dragging across a word to select it
        // would otherwise pick the whole block up and drop it elsewhere.
        if (isEditing) connect(ref)
        else connect(drag(ref))
      }}
      data-craft="element"
      data-kind={kind}
      onDoubleClick={(event) => {
        if (!inline) return
        event.stopPropagation()
        setProp((props: Record<string, unknown>) => {
          props.editing = true
        })
      }}
      className={selected ? "outline outline-2 outline-primary" : "outline-none"}
    >
      {body}
    </div>
  )
}
CraftElement.craft = { displayName: "CraftElement" }

/** What Craft resolves `resolvedName` against. Must match craft-bridge's names. */
export const CRAFT_RESOLVER = {
  CraftRoot,
  CraftSection,
  CraftRow,
  CraftColumn,
  CraftElement,
}

export { segmentsOf }
