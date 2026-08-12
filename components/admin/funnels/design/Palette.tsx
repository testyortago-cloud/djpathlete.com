"use client"

// The palette. Driven entirely by ELEMENT_REGISTRY and ROW_LAYOUTS, so an
// element cannot exist in the builder without appearing here, and cannot appear
// here without a compiler behind it.

import { useEditor, Element } from "@craftjs/core"
import { Rows3, Square } from "lucide-react"
import { ROW_LAYOUTS, type RowLayout } from "@/lib/funnels/tree/types"
import { ELEMENT_LIST } from "@/lib/funnels/tree/elements"
import { CraftColumn, CraftElement, CraftRow, CraftSection } from "./craft-nodes"
import { newId } from "@/lib/funnels/tree/ids"
import { segmentsOf } from "@/lib/funnels/tree/types"

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  )
}

function Chip({
  label,
  icon: Icon,
  innerRef,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  innerRef: (ref: HTMLElement | null) => void
}) {
  return (
    <button
      type="button"
      ref={(ref) => innerRef(ref)}
      className="flex cursor-grab flex-col items-center gap-1 rounded-lg border border-border bg-white px-2 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
    >
      {Icon ? <Icon className="size-4" /> : null}
      {label}
    </button>
  )
}

export function Palette() {
  const { connectors } = useEditor()

  return (
    <div className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface/30 p-4">
      <Group title="Layout">
        <Chip
          label="Section"
          icon={Square}
          innerRef={(ref) =>
            ref &&
            connectors.create(
              ref,
              <Element canvas is={CraftSection} sectionId={newId("s")} style={{ padding: { top: "48px", bottom: "48px" } }} />,
            )
          }
        />
        {ROW_LAYOUTS.map((layout) => (
          <Chip
            key={layout}
            label={layout.replace(/-/g, " / ")}
            icon={Rows3}
            innerRef={(ref) =>
              ref && connectors.create(ref, <RowTemplate layout={layout} />)
            }
          />
        ))}
      </Group>

      <Group title="Elements">
        {ELEMENT_LIST.map((def) => (
          <Chip
            key={def.kind}
            label={def.label}
            icon={def.icon}
            innerRef={(ref) =>
              ref &&
              connectors.create(
                ref,
                <CraftElement
                  elementId={newId("e")}
                  kind={def.kind}
                  style={{}}
                  elementProps={def.defaultProps as Record<string, unknown>}
                />,
              )
            }
          />
        ))}
      </Group>
    </div>
  )
}

/**
 * A row arrives with exactly the columns its layout requires. Dropping a bare
 * row and letting the owner add columns would let the invariant be violated by
 * the normal way of working, rather than only by dragging one out.
 */
function RowTemplate({ layout }: { layout: RowLayout }) {
  return (
    <Element canvas is={CraftRow} rowId={newId("r")} style={{}} layout={layout}>
      {segmentsOf(layout).map((_, index) => (
        <Element key={index} canvas is={CraftColumn} columnId={newId("c")} style={{}} />
      ))}
    </Element>
  )
}
