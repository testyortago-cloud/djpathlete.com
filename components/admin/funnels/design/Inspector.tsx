"use client"

// The inspector. Its fields come from the selected element's own ElementDef —
// and for islands, from ISLAND_TRAITS via `fieldsForIsland` — so a control can
// never exist for a setting the compiler would reject, nor a setting exist with
// no control (a `form` once shipped a successMode default with no way to change
// it, which made the Redirect URL field below it purely decorative).

import { useEditor } from "@craftjs/core"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ELEMENT_REGISTRY, fieldsForIsland } from "@/lib/funnels/tree/elements"
import type { FieldSpec } from "@/lib/funnels/tree/element-def"
import type { BoxStyle, ElementKind } from "@/lib/funnels/tree/types"
import type { IslandName } from "@/lib/funnels/islands"

export function Inspector() {
  const { selectedId, kind, elementProps, style, actions } = useEditor((state, query) => {
    const id = Array.from(state.events.selected)[0]
    if (!id || !state.nodes[id]) return { selectedId: null }
    const props = state.nodes[id].data.props
    return {
      selectedId: id,
      kind: props.kind as ElementKind | undefined,
      elementProps: (props.elementProps ?? {}) as Record<string, unknown>,
      style: (props.style ?? {}) as BoxStyle,
      query,
    }
  })

  if (!selectedId) {
    return (
      <aside className="w-72 shrink-0 border-l border-border bg-surface/30 p-4">
        <p className="text-sm text-muted-foreground">Select something on the page to edit it.</p>
      </aside>
    )
  }

  const def = kind ? ELEMENT_REGISTRY[kind] : undefined

  // An island's real fields depend on WHICH island, so they are looked up per
  // selection rather than being static on the def.
  const fields: FieldSpec[] =
    def && kind === "island"
      ? [
          ...def.fields,
          ...fieldsForIsland((elementProps.name as IslandName) ?? "form"),
        ]
      : (def?.fields ?? [])

  function setElementProp(name: string, value: unknown) {
    actions.setProp(selectedId as string, (props: Record<string, unknown>) => {
      const next = { ...((props.elementProps ?? {}) as Record<string, unknown>) }
      next[name] = value
      props.elementProps = next
    })
  }

  function setIslandProp(name: string, value: unknown) {
    actions.setProp(selectedId as string, (props: Record<string, unknown>) => {
      const outer = { ...((props.elementProps ?? {}) as Record<string, unknown>) }
      const inner = { ...((outer.islandProps ?? {}) as Record<string, unknown>) }
      inner[name] = value
      outer.islandProps = inner
      props.elementProps = outer
    })
  }

  function setStyle(patch: Partial<BoxStyle>) {
    actions.setProp(selectedId as string, (props: Record<string, unknown>) => {
      props.style = { ...((props.style ?? {}) as BoxStyle), ...patch }
    })
  }

  const islandProps = (elementProps.islandProps ?? {}) as Record<string, unknown>

  return (
    <aside className="w-72 shrink-0 space-y-5 overflow-y-auto border-l border-border bg-surface/30 p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Content</p>
        <p className="mt-0.5 text-sm font-medium text-primary">{def?.label ?? "Block"}</p>
      </div>

      <div className="space-y-3">
        {fields.map((field) => {
          // The island picker writes to the element's own props; every other
          // island field writes inside `islandProps`.
          const isOuter = kind !== "island" || field.name === "name"
          const value = isOuter ? elementProps[field.name] : islandProps[field.name]
          const onChange = (next: unknown) =>
            isOuter ? setElementProp(field.name, next) : setIslandProp(field.name, next)

          return (
            <Field key={field.name} field={field} value={value} onChange={onChange} />
          )
        })}
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">This block has no content settings.</p>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Style</p>
        <div className="space-y-1.5">
          <Label htmlFor="insp-pad-top">Padding top</Label>
          <Input
            id="insp-pad-top"
            value={style.padding?.top ?? ""}
            placeholder="24px"
            onChange={(event) =>
              setStyle({ padding: { ...(style.padding ?? {}), top: event.target.value } })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insp-bg">Background colour</Label>
          <Input
            id="insp-bg"
            value={style.background?.color ?? ""}
            placeholder="#ffffff"
            onChange={(event) =>
              setStyle({ background: { ...(style.background ?? {}), color: event.target.value } })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insp-align">Align</Label>
          <select
            id="insp-align"
            value={style.align ?? "left"}
            onChange={(event) => setStyle({ align: event.target.value as BoxStyle["align"] })}
            className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Full spacing, borders and typography arrive with the style inspector.
        </p>
      </div>
    </aside>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldSpec
  value: unknown
  onChange: (next: unknown) => void
}) {
  const id = `insp-${field.name}`

  if (field.type === "select") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
        >
          {(field.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    )
  }

  if (field.type === "number") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <Input
          id={id}
          type="number"
          value={String(value ?? "")}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    )
  }

  if (field.type === "richtext" || field.type === "json") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <Textarea
          id={id}
          rows={field.type === "richtext" ? 4 : 3}
          value={
            field.type === "json"
              ? JSON.stringify(value ?? null, null, 2)
              : String(value ?? "")
          }
          onChange={(event) => {
            if (field.type !== "json") return onChange(event.target.value)
            try {
              onChange(JSON.parse(event.target.value))
            } catch {
              // Keep the keystroke; half-typed JSON is not an error yet.
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <Input id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
